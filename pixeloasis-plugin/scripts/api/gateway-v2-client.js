/* gateway-v2-client.js — v2 HTTP client for PixelOasis model gateway
 *
 * Unified client for all v2 endpoints.  Auto-adds X-Correlation-Id,
 * handles JSON parsing, timeouts, and AbortSignal passthrough.
 *
 * URL construction: all endpoints built from validated loopback base URL.
 * Rejects file://, user:pass@, and non-HTTP(S) schemes.
 *
 * Provides:
 *   requestJson(method, path, options) → parsed JSON response
 *   getHealth() / getCapabilities()
 *   uploadAsset(formData, signal) / headAsset(assetId)
 *   createJob(payload) / getJob(jobId) / listJobs(clientId) / cancelJob(jobId)
 *   retryJob(jobId) / downloadArtifact(artifactId)
 *   subscribeJobEvents(jobId) → EventSource | null
 */

window.PO = window.PO || {};

window.PO.GatewayV2Client = (function () {
  "use strict";

  var DEFAULT_URL = "http://127.0.0.1:8787";
  var DEFAULT_TIMEOUT_MS = 30000;
  var UPLOAD_TIMEOUT_MS = 120000;
  var CLIENT_ID_STORAGE_KEY = "po.clientId.v2";
  var _sessionClientId = null;

  /* ── URL validation ── */
  function getBaseUrl() {
    var url = (window.PO.state && window.PO.state.gateway && window.PO.state.gateway.baseUrl) ||
              (window.PO.state && window.PO.state.gatewayUrl) ||
              DEFAULT_URL;

    /* Validate: reject file://, user:pass@, non-http schemes */
    var lower = String(url).toLowerCase();
    if (lower.indexOf("file:") === 0) {
      window.PO.Logger && window.PO.Logger.warn("gateway.invalid_url", {
        component: "gateway-v2-client",
        data: { reason: "file:// scheme rejected" },
      });
      return DEFAULT_URL;
    }
    if (lower.indexOf("@") !== -1 && lower.indexOf("://") < lower.indexOf("@")) {
      window.PO.Logger && window.PO.Logger.warn("gateway.invalid_url", {
        component: "gateway-v2-client",
        data: { reason: "user:password in URL rejected" },
      });
      return DEFAULT_URL;
    }
    if (lower.indexOf("http://") !== 0 && lower.indexOf("https://") !== 0) {
      return DEFAULT_URL;
    }

    /* Strip trailing slash */
    return url.replace(/\/+$/, "");
  }

  /* ── Generate trace ID (once per operation, persisted across retries) ── */
  function createTraceId() {
    var ts = Date.now().toString(36);
    var rnd = Math.floor(Math.random() * 100000).toString(36);
    return "tr_" + ts + "_" + rnd;
  }

  /* ── Generate correlation ID ── */
  function _correlationId() {
    var ts = Date.now().toString(36);
    var rnd = Math.floor(Math.random() * 100000).toString(36);
    return "po-" + ts + "-" + rnd;
  }

  function _createClientId() {
    var randomPart = "";
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      randomPart = window.crypto.randomUUID().replace(/-/g, "");
    } else if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      var values = new Uint32Array(4);
      window.crypto.getRandomValues(values);
      randomPart = Array.prototype.map.call(values, function (value) {
        return value.toString(36);
      }).join("");
    } else {
      randomPart = Date.now().toString(36) + Math.random().toString(36).slice(2);
    }
    return "po-client-" + randomPart;
  }

  /* A stable local identifier scopes assets, jobs, and artifacts at the
     loopback gateway. It is not an authentication credential. */
  function getClientId() {
    if (_sessionClientId) return _sessionClientId;
    try {
      var stored = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
      if (stored && /^[A-Za-z0-9_-]{8,128}$/.test(stored)) {
        _sessionClientId = stored;
        return _sessionClientId;
      }
    } catch (_) { /* Use this panel session when localStorage is unavailable. */ }

    _sessionClientId = _createClientId();
    try { localStorage.setItem(CLIENT_ID_STORAGE_KEY, _sessionClientId); } catch (_) { /* ignore */ }
    return _sessionClientId;
  }

  /* ═══════════════════════════════════════════════════════════════════
   * requestJson(method, path, options) → response
   * ═══════════════════════════════════════════════════════════════════ */

  async function requestJson(method, path, options) {
    options = options || {};
    var baseUrl = getBaseUrl();
    var url = baseUrl + path;
    var corrId = options.correlationId || _correlationId();
    var timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    var signal = options.signal || null;

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);

    /* If external signal provided, forward abort */
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        throw new Error("Request aborted");
      }
      signal.addEventListener("abort", function () { controller.abort(); });
    }

    var startTime = Date.now();

    try {
      var traceId = options.traceId || corrId;
      var fetchOpts = {
        method: method,
        headers: Object.assign({
          "X-Trace-Id": traceId,
          "X-Correlation-Id": corrId,
          "X-Client-Id": getClientId(),
          "Accept": "application/json",
        }, options.headers || {}),
        signal: controller.signal,
      };

      if (options.body) {
        fetchOpts.body = options.body;
        /* Don't set Content-Type for FormData — browser sets with boundary */
        if (!(options.body instanceof FormData)) {
          fetchOpts.headers["Content-Type"] = "application/json";
        }
      }

      var resp = await fetch(url, fetchOpts);

      clearTimeout(timer);

      /* Handle non-JSON responses (204, etc.) */
      if (resp.status === 204) {
        return { ok: true, status: 204, data: null, correlationId: corrId };
      }

      var contentType = resp.headers.get("Content-Type") || "";

      if (contentType.indexOf("application/json") !== -1) {
        var data = await resp.json();
        if (!resp.ok) {
          throw _normalizeError(resp.status, data, corrId);
        }
        return { ok: true, status: resp.status, data: data, correlationId: corrId };
      }

      /* Non-JSON response */
      if (!resp.ok) {
        var errorText = "";
        try { errorText = await resp.text(); } catch (e) { /* ignore */ }
        throw _normalizeError(resp.status, { message: errorText }, corrId);
      }

      /* Binary/blob response — return raw */
      var blob = await resp.blob();
      return { ok: true, status: resp.status, data: blob, correlationId: corrId, contentType: contentType };

    } catch (e) {
      clearTimeout(timer);
      if (e._normalized) throw e;

      var errCode = "NETWORK_ERROR";
      var errMsg = e instanceof Error ? e.message : String(e);

      if (e && e.name === "AbortError") {
        errCode = "TIMEOUT";
        errMsg = "请求超时";
      }

      window.PO.Logger && window.PO.Logger.error("gateway_v2.request_failed", {
        component: "gateway-v2-client",
        correlationId: corrId,
        durationMs: Date.now() - startTime,
        error: { code: errCode, message: errMsg },
        data: { method: method, path: path },
      });

      throw window.PO.ApiErrors.normalizeApiError({
        code: errCode,
        message: errMsg,
        correlationId: corrId,
      });
    }
  }

  /* ── Normalize HTTP error ── */
  function _normalizeError(status, body, corrId) {
    var payload = (body && body.error) || body || {};
    var code = payload.code || "HTTP_" + status;
    var message = payload.message || ("HTTP " + status);

    /* Map status to standard codes */
    switch (status) {
      case 400: code = payload.code || "REQUEST_SCHEMA_INVALID"; break;
      case 404: code = payload.code || "NOT_FOUND"; break;
      case 409: code = payload.code || "DOCUMENT_STATE_CONFLICT"; break;
      case 422: code = payload.code || "INPUT_MASK_REQUIRED"; break;
      case 424: code = payload.code || "MODEL_MISSING"; break;
      case 429: code = payload.code || "QUEUE_LIMIT_EXCEEDED"; break;
      case 500: code = payload.code || "PIPELINE_FAILED"; break;
      case 502: code = payload.code || "COMFYUI_UNAVAILABLE"; break;
      case 507: code = payload.code || "DISK_SPACE_LOW"; break;
    }

    var err = window.PO.ApiErrors.normalizeApiError({
      code: code,
      message: message,
      status: status,
      correlationId: corrId,
    });
    err._normalized = true;
    return err;
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Named API methods
   * ═══════════════════════════════════════════════════════════════════ */

  /* Health */
  async function getHealth(depth) {
    var qs = depth === "full" ? "?depth=full" : "";
    return requestJson("GET", "/v2/health" + qs, { timeoutMs: 10000 });
  }

  /* Capabilities */
  async function getCapabilities(locale) {
    var qs = locale ? "?locale=" + encodeURIComponent(locale) : "";
    return requestJson("GET", "/v2/capabilities" + qs);
  }

  /* Upload asset (multipart) */
  async function uploadAsset(formData, signal) {
    return requestJson("POST", "/v2/assets", {
      body: formData,
      signal: signal,
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  }

  /* Head asset (check if still valid) */
  async function headAsset(assetId) {
    if (!_validateId(assetId)) throw new Error("Invalid assetId");
    try {
      var baseUrl = getBaseUrl();
      var resp = await fetch(baseUrl + "/v2/assets/" + encodeURIComponent(assetId), {
        method: "HEAD",
        headers: { "X-Client-Id": getClientId() },
      });
      return { exists: resp.ok, status: resp.status };
    } catch (e) {
      return { exists: false, error: e.message };
    }
  }

  /* Create job */
  async function createJob(payload) {
    var body = JSON.stringify(payload);
    return requestJson("POST", "/v2/jobs", {
      body: body,
      correlationId: payload.correlationId,
      timeoutMs: 60000,
    });
  }

  /* Get job status */
  async function getJob(jobId) {
    if (!_validateId(jobId)) throw new Error("Invalid jobId");
    return requestJson("GET", "/v2/jobs/" + encodeURIComponent(jobId));
  }

  /* List jobs */
  async function listJobs(clientId) {
    return requestJson("GET", "/v2/jobs");
  }

  /* Cancel job */
  async function cancelJob(jobId) {
    if (!_validateId(jobId)) throw new Error("Invalid jobId");
    return requestJson("DELETE", "/v2/jobs/" + encodeURIComponent(jobId));
  }

  /* Retry job */
  async function retryJob(jobId) {
    if (!_validateId(jobId)) throw new Error("Invalid jobId");
    return requestJson("POST", "/v2/jobs/" + encodeURIComponent(jobId) + "/retry");
  }

  /* Download artifact */
  async function downloadArtifact(artifactId) {
    if (!_validateId(artifactId)) throw new Error("Invalid artifactId");
    return requestJson("GET", "/v2/artifacts/" + encodeURIComponent(artifactId), {
      timeoutMs: 60000,
    });
  }

  /* Subscribe to job events (returns EventSource or null) */
  function subscribeJobEvents(jobId) {
    if (!_validateId(jobId)) return null;
    try {
      var baseUrl = getBaseUrl();
      var url = baseUrl + "/v2/jobs/" + encodeURIComponent(jobId) + "/events?clientId=" + encodeURIComponent(getClientId());
      var es = new EventSource(url);
      return es;
    } catch (e) {
      window.PO.Logger && window.PO.Logger.warn("gateway_v2.sse_failed", {
        component: "gateway-v2-client",
        error: e,
        data: { jobId: jobId },
      });
      return null;
    }
  }

  /* ── Validate ID format ── */
  function _validateId(id) {
    if (!id || typeof id !== "string") return false;
    /* Only accept alphanumeric, hyphens, underscores */
    return /^[A-Za-z0-9_-]+$/.test(id);
  }

  return {
    requestJson:         requestJson,
    createTraceId:       createTraceId,
    getClientId:         getClientId,
    getHealth:           getHealth,
    getCapabilities:     getCapabilities,
    uploadAsset:         uploadAsset,
    headAsset:           headAsset,
    createJob:           createJob,
    getJob:              getJob,
    listJobs:            listJobs,
    cancelJob:           cancelJob,
    retryJob:            retryJob,
    downloadArtifact:    downloadArtifact,
    subscribeJobEvents:  subscribeJobEvents,
  };
})();
