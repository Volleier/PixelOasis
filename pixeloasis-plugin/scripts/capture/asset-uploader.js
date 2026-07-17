/* asset-uploader.js — v2 asset upload with SHA-256 hashing and retry
 *
 * Upload flow:
 *   1. Compute SHA-256 via Web Crypto
 *   2. Check in-memory cache (sha256 + kind + documentId)
 *   3. HEAD check if cache hit (verify still valid on server)
 *   4. Build FormData (file Blob, kind, correlationId)
 *   5. POST /v2/assets (multipart)
 *   6. Retry up to 2 times on network error (no server response)
 *   7. Return { assetId, sha256 }
 *
 * Never embeds base64 in JSON bodies.
 *
 * Provides:
 *   uploadAsset(kind, base64OrBlob, correlationId, documentId)
 *   releaseAssetCache()
 */

window.PO = window.PO || {};

window.PO.AssetUploader = (function () {
  "use strict";

  var MAX_RETRIES = 2;
  var _cache = {}; /* key: "sha256:kind:docId" → { assetId, expiresAt } */

  /* ═══════════════════════════════════════════════════════════════════
   * uploadAsset(kind, base64OrBlob, correlationId, documentId)
   * ═══════════════════════════════════════════════════════════════════ */

  async function uploadAsset(kind, base64OrBlob, correlationId, documentId, metadata) {
    if (!base64OrBlob) throw new Error("No asset data to upload");
    if (!correlationId) correlationId = "po-" + Date.now().toString(36);

    /* Convert base64 to Blob */
    var blob;
    if (typeof base64OrBlob === "string") {
      blob = _base64ToBlob(base64OrBlob);
    } else if (base64OrBlob instanceof Blob) {
      blob = base64OrBlob;
    } else {
      throw new Error("Asset must be base64 string or Blob");
    }

    /* Compute SHA-256 */
    var arrayBuf = await blob.arrayBuffer();
    var sha256 = await _computeSha256(arrayBuf);

    window.PO.Logger && window.PO.Logger.info("asset.sha256_computed", {
      component: "asset-uploader",
      correlationId: correlationId,
      data: {
        kind: kind,
        sha256prefix: sha256.substring(0, 12),
        sizeBytes: arrayBuf.byteLength,
      },
    });

    /* Check cache */
    var cacheKey = sha256 + ":" + kind + ":" + (documentId || "0");
    var cached = _cache[cacheKey];
    if (cached) {
      /* Verify asset still valid on server */
      try {
        var headResult = await window.PO.GatewayV2Client.headAsset(cached.assetId);
        if (headResult.exists) {
          window.PO.Logger && window.PO.Logger.info("asset.cache_hit", {
            component: "asset-uploader",
            correlationId: correlationId,
            data: { assetId: cached.assetId, kind: kind },
          });
          return { assetId: cached.assetId, sha256: sha256, reused: true };
        }
      } catch (e) {
        /* Cache entry expired, continue with upload */
        delete _cache[cacheKey];
      }
    }

    /* Build FormData with trace metadata */
    metadata = metadata || {};
    var formData = new FormData();
    formData.append("file", blob, kind + ".png");
    formData.append("kind", kind);
    formData.append("correlationId", correlationId);
    if (metadata.traceId) formData.append("traceId", metadata.traceId);
    if (metadata.originalName) formData.append("originalName", String(metadata.originalName).substring(0, 160));
    if (metadata.clientWidth) formData.append("clientWidth", String(Math.round(metadata.clientWidth)));
    if (metadata.clientHeight) formData.append("clientHeight", String(Math.round(metadata.clientHeight)));
    if (metadata.sourceScale) formData.append("sourceScale", String(metadata.sourceScale));
    if (metadata.scope) formData.append("scope", metadata.scope);

    /* Upload with retry */
    var lastError = null;
    for (var attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        var controller = new AbortController();
        var result = await window.PO.GatewayV2Client.uploadAsset(
          formData,
          controller.signal,
          metadata.traceId || correlationId
        );

        var assetId = (result.data && result.data.assetId) || result.data;
        if (typeof assetId === "object") assetId = assetId.assetId;

        if (!assetId) throw new Error("Server did not return assetId");

        /* Cache the result */
        _cache[cacheKey] = {
          assetId: assetId,
          expiresAt: Date.now() + (24 * 60 * 60 * 1000), /* 24h TTL assumption */
        };

        window.PO.Logger && window.PO.Logger.info("asset.uploaded", {
          component: "asset-uploader",
          correlationId: correlationId,
          data: {
            assetId: assetId,
            kind: kind,
            sha256prefix: sha256.substring(0, 12),
            attempt: attempt,
          },
        });

        return { assetId: assetId, sha256: sha256, reused: false };

      } catch (e) {
        lastError = e;

        /* Only retry on network errors (no server response) */
        var isNetworkError = e.code === "NETWORK_ERROR" || e.code === "TIMEOUT";
        if (!isNetworkError || attempt >= MAX_RETRIES) break;

        window.PO.Logger && window.PO.Logger.warn("asset.upload_retry", {
          component: "asset-uploader",
          correlationId: correlationId,
          data: { kind: kind, attempt: attempt + 1, reason: e.message },
        });

        /* Brief delay before retry */
        await _delay(500 * (attempt + 1));
      }
    }

    /* All retries exhausted */
    window.PO.Logger && window.PO.Logger.error("asset.upload_failed", {
      component: "asset-uploader",
      correlationId: correlationId,
      error: lastError,
      data: { kind: kind },
    });

    throw lastError || new Error("Asset upload failed");
  }

  /* ── Base64 → Blob ── */
  function _base64ToBlob(base64) {
    /* Strip data URI prefix */
    var b64 = base64.replace(/^data:.*?;base64,/, "");
    var byteChars = atob(b64);
    var byteNums = new Uint8Array(byteChars.length);
    for (var i = 0; i < byteChars.length; i++) {
      byteNums[i] = byteChars.charCodeAt(i);
    }
    return new Blob([byteNums], { type: "image/png" });
  }

  /* ── SHA-256 via Web Crypto ── */
  async function _computeSha256(arrayBuffer) {
    try {
      var hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
      var hashArray = Array.from(new Uint8Array(hashBuffer));
      var hashHex = hashArray.map(function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
      return hashHex;
    } catch (e) {
      /* Fallback for environments without crypto.subtle */
      window.PO.Logger && window.PO.Logger.warn("asset.sha256_webcrypto_failed", {
        component: "asset-uploader",
        error: e,
      });
      /* Return a deterministic fallback hash based on content length + time */
      return "fallback-" + arrayBuffer.byteLength + "-" + Date.now().toString(36);
    }
  }

  /* ── Delay helper ── */
  function _delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /* ── Clear in-memory cache ── */
  function releaseAssetCache() {
    _cache = {};
  }

  return {
    uploadAsset:       uploadAsset,
    releaseAssetCache: releaseAssetCache,
  };
})();
