/* artifact-downloader.js — v2 artifact download with validation
 *
 * Downloads and validates artifacts BEFORE Photoshop operations.
 * All validation happens outside executeAsModal.
 *
 * Validates: HTTP 200, Content-Type: image/png, Content-Length,
 * PNG magic bytes, SHA-256. Rejects path traversal in artifactId.
 *
 * Provides:
 *   downloadArtifact(artifact, jobId)  → { fileEntry, localPath }
 *   downloadAllArtifacts(artifacts, jobId) → [{ artifact, fileEntry }]
 *   cleanupJobFiles(jobId)
 */

window.PO = window.PO || {};

window.PO.ArtifactDownloader = (function () {
  "use strict";

  var MAX_FILE_SIZE = 100 * 1024 * 1024; /* 100 MB */
  var PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];

  function _reportClientEvent(jobId, event, data) {
    try {
      var job = window.PO.JobStore && window.PO.JobStore.get(jobId);
      var traceId = job && job.traceId;
      var report = window.PO.GatewayV2Client.sendClientEvent(jobId, event, data, traceId);
      if (report && typeof report.catch === "function") report.catch(function () {});
    } catch (_) { /* Observability must not block downloads. */ }
  }

  /* ── Validate artifactId format ── */
  function _validateId(id) {
    if (!id || typeof id !== "string") return false;
    return /^[A-Za-z0-9_-]+$/.test(id);
  }

  /* ── Compute SHA-256 from ArrayBuffer ── */
  async function _sha256(arrayBuffer) {
    try {
      var hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
      var hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    } catch (e) {
      return null;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * downloadArtifact(artifact, jobId) → { fileEntry, filename }
   * ═══════════════════════════════════════════════════════════════════ */

  async function downloadArtifact(artifact, jobId) {
    if (!artifact || !artifact.id) throw new Error("Invalid artifact");
    if (!_validateId(artifact.id)) throw new Error("Invalid artifactId: path rejected");
    if (!_validateId(jobId)) throw new Error("Invalid jobId");

    var baseUrl = (window.PO.state && window.PO.state.gateway && window.PO.state.gateway.baseUrl) ||
                  (window.PO.state && window.PO.state.gatewayUrl) ||
                  "http://127.0.0.1:8787";

    var downloadUrl = artifact.downloadUrl;
    if (downloadUrl && downloadUrl.indexOf("http") !== 0) {
      downloadUrl = baseUrl + downloadUrl;
    }

    window.PO.Logger && window.PO.Logger.info("artifact.download_started", {
      component: "artifact-downloader",
      data: { artifactId: artifact.id, jobId: jobId },
    });
    _reportClientEvent(jobId, "artifact.download.started", { artifactId: artifact.id, role: artifact.role || null });

    /* Fetch */
    var resp;
    try {
      resp = await fetch(downloadUrl, {
        headers: {
          "X-Client-Id": window.PO.GatewayV2Client.getClientId(),
          "Accept": "image/png",
        },
      });
    } catch (e) {
      throw new Error("下载失败：" + (e.message || "网络错误"));
    }

    if (!resp.ok) {
      throw new Error("下载失败：HTTP " + resp.status);
    }

    /* Validate Content-Type */
    var contentType = resp.headers.get("Content-Type") || "";
    if (contentType.indexOf("image/png") === -1) {
      throw new Error("无效的 artifact 格式：" + contentType);
    }

    /* Validate Content-Length */
    var contentLength = parseInt(resp.headers.get("Content-Length") || "0", 10);
    if (contentLength > MAX_FILE_SIZE) {
      throw new Error("Artifact 文件过大：" + (contentLength / 1024 / 1024).toFixed(1) + " MB");
    }

    /* Read as ArrayBuffer */
    var arrayBuffer = await resp.arrayBuffer();
    var bytes = new Uint8Array(arrayBuffer);

    /* Validate PNG magic bytes */
    for (var i = 0; i < PNG_MAGIC.length; i++) {
      if (bytes[i] !== PNG_MAGIC[i]) {
        throw new Error("Artifact 不是有效的 PNG 文件");
      }
    }

    /* Validate SHA-256 if provided */
    if (artifact.sha256) {
      var computed = await _sha256(arrayBuffer);
      if (computed && computed !== artifact.sha256) {
        window.PO.Logger && window.PO.Logger.warn("artifact.sha256_mismatch", {
          component: "artifact-downloader",
          data: {
            artifactId: artifact.id,
            expected: artifact.sha256.substring(0, 12),
            computed: computed.substring(0, 12),
          },
        });
        /* For mock artifacts (sha256 starts with "mock-"), skip validation */
        if (artifact.sha256.indexOf("mock-") !== 0) {
          throw new Error("Artifact SHA-256 校验失败");
        }
      }
    }

    /* Write to temp file */
    var uxp = window.require("uxp");
    var storage = uxp.storage;
    var tempFolder = await storage.localFileSystem.getTemporaryFolder();

    /* Create po/<jobId>/ directory */
    var poFolder;
    try {
      var entries = await tempFolder.getEntries();
      poFolder = null;
      for (var ei = 0; ei < entries.length; ei++) {
        if (entries[ei].isFolder && entries[ei].name === "po") {
          poFolder = entries[ei];
          break;
        }
      }
      if (!poFolder) {
        poFolder = await tempFolder.createFolder("po");
      }
    } catch (e) {
      poFolder = await tempFolder.createFolder("po");
    }

    /* Create po/<jobId>/ directory */
    var jobFolder;
    try {
      var poEntries = await poFolder.getEntries();
      jobFolder = null;
      for (var pj = 0; pj < poEntries.length; pj++) {
        if (poEntries[pj].isFolder && poEntries[pj].name === jobId) {
          jobFolder = poEntries[pj];
          break;
        }
      }
      if (!jobFolder) {
        jobFolder = await poFolder.createFolder(jobId);
      }
    } catch (e) {
      jobFolder = await poFolder.createFolder(jobId);
    }

    var filename = artifact.id + ".png";
    var file = await jobFolder.createFile(filename, { overwrite: true });
    await file.write(bytes, { format: storage.formats.binary });

    window.PO.Logger && window.PO.Logger.info("artifact.downloaded", {
      component: "artifact-downloader",
      data: {
        artifactId: artifact.id,
        jobId: jobId,
        sizeBytes: arrayBuffer.byteLength,
      },
    });
    _reportClientEvent(jobId, "artifact.download.completed", {
      artifactId: artifact.id,
      role: artifact.role || null,
      sizeBytes: arrayBuffer.byteLength,
    });

    return { fileEntry: file, filename: filename, localPath: file.nativePath };
  }

  /* ═══════════════════════════════════════════════════════════════════
   * downloadAllArtifacts(artifacts, jobId) → [{ artifact, fileEntry, maskFileEntry }]
   * ═══════════════════════════════════════════════════════════════════ */

  async function downloadAllArtifacts(artifacts, jobId) {
    if (!artifacts || artifacts.length === 0) return [];

    var results = [];
    var errors = [];
    var byId = {};
    var maskIds = {};
    var downloads = {};

    for (var index = 0; index < artifacts.length; index++) {
      byId[artifacts[index].id] = artifacts[index];
      if (artifacts[index].placement && artifacts[index].placement.maskArtifactId) {
        maskIds[artifacts[index].placement.maskArtifactId] = true;
      }
    }

    /* Download sequentially (UXP may limit concurrent transfers) */
    for (var i = 0; i < artifacts.length; i++) {
      /* A referenced mask is downloaded for its visual artifact, not placed as
         an independent result layer. */
      if (maskIds[artifacts[i].id]) continue;
      try {
        var fileEntry = await _downloadOnce(artifacts[i]);
        var maskFileEntry = null;
        var maskArtifactId = artifacts[i].placement && artifacts[i].placement.maskArtifactId;
        if (maskArtifactId) {
          if (!byId[maskArtifactId]) {
            throw new Error("找不到引用的 mask artifact: " + maskArtifactId);
          }
          maskFileEntry = await _downloadOnce(byId[maskArtifactId]);
        }
        results.push({ artifact: artifacts[i], fileEntry: fileEntry, maskFileEntry: maskFileEntry });
      } catch (e) {
        errors.push({ index: i, artifact: artifacts[i], error: e.message });
      }
    }

    if (errors.length > 0) {
      /* Clean up any successfully downloaded files on partial failure */
      await cleanupJobFiles(jobId);
      throw new Error(
        "Artifact 下载失败：" +
        errors.map(function (e) { return "#" + (e.index + 1) + " " + e.error; }).join("；")
      );
    }

    return results;

    async function _downloadOnce(artifact) {
      if (!downloads[artifact.id]) {
        downloads[artifact.id] = await downloadArtifact(artifact, jobId);
      }
      return downloads[artifact.id];
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * cleanupJobFiles(jobId)
   * ═══════════════════════════════════════════════════════════════════ */

  async function cleanupJobFiles(jobId) {
    if (!_validateId(jobId)) return;
    try {
      var uxp = window.require("uxp");
      var tempFolder = await uxp.storage.localFileSystem.getTemporaryFolder();
      var entries = await tempFolder.getEntries();

      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isFolder && entries[i].name === "po") {
          var poEntries = await entries[i].getEntries();
          for (var j = 0; j < poEntries.length; j++) {
            if (poEntries[j].isFolder && poEntries[j].name === jobId) {
              await poEntries[j].delete();
              window.PO.Logger && window.PO.Logger.info("artifact.cleanup", {
                component: "artifact-downloader",
                data: { jobId: jobId },
              });
              return;
            }
          }
        }
      }
    } catch (e) { /* ignore cleanup errors */ }
  }

  return {
    downloadArtifact:     downloadArtifact,
    downloadAllArtifacts: downloadAllArtifacts,
    cleanupJobFiles:      cleanupJobFiles,
  };
})();
