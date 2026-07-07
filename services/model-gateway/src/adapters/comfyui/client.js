/* adapters/comfyui/client.js — ComfyUI HTTP client
 *
 * DevList §9 — Phase G2: ComfyUI Client.
 *
 * Low-level client for the official ComfyUI API.  Independent of PixelOasis
 * request details — only knows how to talk to ComfyUI endpoints.
 *
 * Endpoints used:
 *   GET  /system_stats
 *   GET  /object_info
 *   GET  /queue
 *   POST /upload/image
 *   POST /prompt
 *   GET  /history/{prompt_id}
 *   GET  /view
 *   WS   /ws?clientId=...         (stub — G5+)
 *
 * Node 18+ built-in fetch, FormData, Blob, AbortController.
 */

/* ═══════════════════════════════════════════════════════════════════════
 * Custom error classes
 * ═══════════════════════════════════════════════════════════════════════ */

export class ComfyUIError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ComfyUIError";
    this.details = details || {};
  }
}

/** ComfyUI server unreachable or connection refused. */
export class ComfyUIOfflineError extends ComfyUIError {
  constructor(baseUrl, cause) {
    super("ComfyUI unreachable at " + baseUrl, { baseUrl: baseUrl, cause: cause });
    this.name = "ComfyUIOfflineError";
  }
}

/** /prompt returned a validation error (node_errors or top-level error). */
export class ComfyUIValidationError extends ComfyUIError {
  constructor(message, nodeErrors, promptResponse) {
    super(message, { nodeErrors: nodeErrors, promptResponse: promptResponse });
    this.name = "ComfyUIValidationError";
    this.nodeErrors = nodeErrors || {};
  }
}

/** Generation did not complete before the timeout. */
export class ComfyUITimeoutError extends ComfyUIError {
  constructor(promptId, timeoutMs) {
    super("Prompt " + promptId + " timed out after " + timeoutMs + " ms", {
      promptId: promptId,
      timeoutMs: timeoutMs,
    });
    this.name = "ComfyUITimeoutError";
    this.promptId = promptId;
  }
}

/** History completed but no output image was found. */
export class ComfyUINoOutputError extends ComfyUIError {
  constructor(promptId) {
    super("No output image found for prompt " + promptId, { promptId: promptId });
    this.name = "ComfyUINoOutputError";
    this.promptId = promptId;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * Helpers
 * ═══════════════════════════════════════════════════════════════════════ */

/** Fetch JSON with a timeout. Returns parsed JSON or throws. */
async function fetchJson(url, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);

  try {
    var response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      var text = "";
      try { text = await response.text(); } catch (_) { /* ignore */ }
      throw new ComfyUIError(
        "HTTP " + response.status + " from " + url,
        { status: response.status, body: text.substring(0, 500) },
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ComfyUIError) throw error;
    if (error.name === "AbortError") {
      throw new ComfyUIError("Request timed out after " + timeoutMs + " ms: " + url);
    }
    /* Connection refused / DNS / etc. */
    if (
      error.cause &&
      (error.cause.code === "ECONNREFUSED" ||
        error.cause.code === "ENOTFOUND" ||
        error.cause.code === "EAI_AGAIN")
    ) {
      throw new ComfyUIOfflineError(url.split("/").slice(0, 3).join("/"), error.cause);
    }
    throw new ComfyUIError("Fetch failed for " + url + ": " + error.message);
  } finally {
    clearTimeout(timer);
  }
}

/** Sleep helper for polling loops */
function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

/* ═══════════════════════════════════════════════════════════════════════
 * Client factory
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Create a ComfyUI HTTP client.
 *
 * @param {string}  baseUrl  e.g. "http://127.0.0.1:8000"
 * @param {object}  [options]
 * @param {number}  [options.healthTimeout=10000]    timeout for health/info calls
 * @param {number}  [options.uploadTimeout=30000]    timeout for image uploads
 * @param {number}  [options.generateTimeout=600000] timeout for generation (10 min)
 * @param {number}  [options.pollInterval=1500]      ms between history polls
 * @param {string}  [options.clientId]               client_id for WS / prompt tracking
 */
export function createComfyUIClient(baseUrl, options) {
  var opts = options || {};

  /* Strip trailing slash from baseUrl */
  var base = baseUrl.replace(/\/+$/, "");

  var healthTimeout = opts.healthTimeout || 10000;
  var uploadTimeout = opts.uploadTimeout || 30000;
  var generateTimeout = opts.generateTimeout || 600000;   // 10 minutes
  var pollInterval = opts.pollInterval || 1500;
  var clientId = opts.clientId || "";

  /* ═══════════════════════════════════════════════════════════════════
   * GET /system_stats
   *
   * Returns the ComfyUI system stats object.  Useful for health checks. */
  async function getSystemStats() {
    return await fetchJson(base + "/system_stats", healthTimeout);
  }

  /* ═══════════════════════════════════════════════════════════════════
   * GET /object_info
   *
   * Returns the full node-class registry.  Useful for verifying available
   * node types and model option values before submitting a workflow. */
  async function getObjectInfo() {
    return await fetchJson(base + "/object_info", healthTimeout);
  }

  /* ═══════════════════════════════════════════════════════════════════
   * GET /queue
   *
   * Returns the current prompt queue (running + pending). */
  async function getQueue() {
    return await fetchJson(base + "/queue", healthTimeout);
  }

  /* ═══════════════════════════════════════════════════════════════════
   * POST /upload/image
   *
   * Upload a PNG (or other image) to ComfyUI's input directory.
   *
   * @param {object}   params
   * @param {Buffer}   params.bytes       raw image bytes
   * @param {string}   params.filename    destination filename (e.g. "source.png")
   * @param {boolean}  [params.overwrite=true]
   * @param {string}   [params.subfolder] optional subfolder
   * @returns {object}  { name, subfolder, type }
   */
  async function uploadImage(params) {
    var bytes = params.bytes;
    var filename = params.filename;
    var overwrite = params.overwrite !== false;
    var subfolder = params.subfolder || "";

    if (!bytes || !filename) {
      throw new ComfyUIError("uploadImage requires bytes and filename.");
    }

    /* Build multipart/form-data */
    var form = new FormData();
    var blob = new Blob([bytes], { type: "image/png" });
    form.append("image", blob, filename);
    form.append("overwrite", String(overwrite));

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, uploadTimeout);

    try {
      var response = await fetch(base + "/upload/image", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      if (!response.ok) {
        var text = "";
        try { text = await response.text(); } catch (_) { /* ignore */ }
        throw new ComfyUIError(
          "Upload failed — HTTP " + response.status + ": " + text.substring(0, 300),
          { status: response.status, body: text.substring(0, 500) },
        );
      }

      var data = await response.json();
      return {
        name: data.name || filename,
        subfolder: data.subfolder || subfolder,
        type: data.type || "input",
      };
    } catch (error) {
      if (error instanceof ComfyUIError) throw error;
      if (error.name === "AbortError") {
        throw new ComfyUIError("Upload timed out after " + uploadTimeout + " ms");
      }
      throw new ComfyUIError("Upload failed: " + error.message);
    } finally {
      clearTimeout(timer);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * POST /prompt
   *
   * Submit an API-format workflow for execution.
   *
   * @param {object}  params
   * @param {object}  params.workflow   the API-format workflow JSON
   * @param {string}  [params.clientId] overrides the default client_id
   * @returns {object}  { prompt_id, number, node_errors }
   *
   * Throws ComfyUIValidationError when ComfyUI rejects the workflow. */
  async function submitPrompt(params) {
    var workflow = params.workflow;
    var cid = params.clientId || clientId;

    if (!workflow || typeof workflow !== "object") {
      throw new ComfyUIError("submitPrompt requires a workflow object.");
    }

    var body = {
      prompt: workflow,
    };
    if (cid) {
      body.client_id = cid;
    }

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, healthTimeout);

    try {
      var response = await fetch(base + "/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      var data;
      try {
        data = await response.json();
      } catch (_) {
        var errText = "";
        try { errText = await response.text(); } catch (__) { /* ignore */ }
        throw new ComfyUIError(
          "Failed to parse /prompt response — HTTP " + response.status,
          { status: response.status, body: errText.substring(0, 500) },
        );
      }

      /* ComfyUI returns validation errors with 200/400 and an error field */
      if (data.error) {
        var msg = data.error.message || data.error.type || "ComfyUI validation error";
        throw new ComfyUIValidationError(
          msg,
          data.node_errors || {},
          data,
        );
      }

      /* Should have a prompt_id */
      if (!data.prompt_id) {
        throw new ComfyUIError(
          "/prompt returned no prompt_id and no error",
          { response: data },
        );
      }

      return {
        promptId: data.prompt_id,
        number: data.number,
        nodeErrors: data.node_errors || {},
      };
    } catch (error) {
      if (error instanceof ComfyUIError) throw error;
      if (error.name === "AbortError") {
        throw new ComfyUIError("submitPrompt timed out after " + healthTimeout + " ms");
      }
      throw new ComfyUIError("submitPrompt failed: " + error.message);
    } finally {
      clearTimeout(timer);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * GET /history/{prompt_id}
   *
   * Retrieve execution history for a single prompt.  Returns the history
   * entry, or null if the prompt hasn't started executing yet. */
  async function getHistory(promptId) {
    if (!promptId) {
      throw new ComfyUIError("getHistory requires a prompt_id.");
    }

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, healthTimeout);

    try {
      var response = await fetch(
        base + "/history/" + encodeURIComponent(promptId),
        { signal: controller.signal },
      );

      if (!response.ok) {
        var text = "";
        try { text = await response.text(); } catch (_) { /* ignore */ }
        throw new ComfyUIError(
          "getHistory failed — HTTP " + response.status,
          { status: response.status, body: text.substring(0, 500) },
        );
      }

      var data = await response.json();

      /* ComfyUI returns {} when the prompt_id hasn't been processed yet */
      if (!data || !data[promptId]) {
        return null;
      }

      return data[promptId];
    } catch (error) {
      if (error instanceof ComfyUIError) throw error;
      if (error.name === "AbortError") {
        throw new ComfyUIError("getHistory timed out after " + healthTimeout + " ms");
      }
      throw new ComfyUIError("getHistory failed: " + error.message);
    } finally {
      clearTimeout(timer);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * GET /view
   *
   * Download an output image as raw bytes.
   *
   * @param {object}  params
   * @param {string}  params.filename
   * @param {string}  [params.subfolder]
   * @param {string}  [params.type="output"]
   * @returns {Buffer}  raw PNG bytes
   */
  async function downloadView(params) {
    var filename = params.filename;
    var subfolder = params.subfolder || "";
    var type = params.type || "output";

    if (!filename) {
      throw new ComfyUIError("downloadView requires a filename.");
    }

    var query = "?filename=" + encodeURIComponent(filename) +
      "&subfolder=" + encodeURIComponent(subfolder) +
      "&type=" + encodeURIComponent(type);

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, uploadTimeout);

    try {
      var response = await fetch(base + "/view" + query, {
        signal: controller.signal,
      });

      if (!response.ok) {
        var text = "";
        try { text = await response.text(); } catch (_) { /* ignore */ }
        throw new ComfyUIError(
          "downloadView failed — HTTP " + response.status,
          { status: response.status, body: text.substring(0, 500) },
        );
      }

      var arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      if (error instanceof ComfyUIError) throw error;
      if (error.name === "AbortError") {
        throw new ComfyUIError("downloadView timed out after " + uploadTimeout + " ms");
      }
      throw new ComfyUIError("downloadView failed: " + error.message);
    } finally {
      clearTimeout(timer);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * waitForPrompt(promptId, options)
   *
   * Poll GET /history/{prompt_id} until the prompt completes, errors, or
   * times out.  Returns the full history entry.
   *
   * @param {string}   promptId
   * @param {object}   [options]
   * @param {number}   [options.timeoutMs]     max wait (default 10 min)
   * @param {number}   [options.pollInterval]  ms between polls (default 1500)
   * @param {function} [options.onProgress]    called with history entry each poll
   * @returns {object}  the completed history entry
   *
   * Throws ComfyUITimeoutError or ComfyUIError on failure. */
  async function waitForPrompt(promptId, options) {
    var opts = options || {};
    var timeoutMs = opts.timeoutMs || generateTimeout;
    var interval = opts.pollInterval || pollInterval;
    var onProgress = opts.onProgress || null;

    var startTime = Date.now();

    while (true) {
      /* Timeout check */
      if (Date.now() - startTime > timeoutMs) {
        throw new ComfyUITimeoutError(promptId, timeoutMs);
      }

      var entry = await getHistory(promptId);

      if (entry) {
        /* Report progress */
        if (onProgress) {
          try { onProgress(entry); } catch (_) { /* ignore */ }
        }

        /* Check for execution errors */
        if (entry.status) {
          var s = entry.status;
          if (s.status_str === "error" || s.status_str === "exception") {
            var errMsg = "Prompt " + promptId + " failed";
            if (s.messages && s.messages.length > 0) {
              var lastMsg = s.messages[s.messages.length - 1];
              if (typeof lastMsg === "string") {
                errMsg = lastMsg;
              } else if (lastMsg && lastMsg.exception_message) {
                errMsg = lastMsg.exception_message;
              }
            }
            throw new ComfyUIError(errMsg, {
              promptId: promptId,
              status: s,
            });
          }

          /* Completed successfully */
          if (s.completed === true) {
            return entry;
          }
        }
      }

      /* Wait before next poll */
      await sleep(interval);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * connectWebSocket(clientId) — STUB
   *
   * WebSocket progress listener for /ws?clientId=...
   * Not required for the first real milestone; polling /history is the
   * reliable first path (DevList §9 — G2). */
  function connectWebSocket(_clientId) {
    throw new ComfyUIError(
      "WebSocket progress tracking not yet implemented (planned for G5+). " +
      "Use waitForPrompt() polling instead.",
    );
  }

  /* ═══════════════════════════════════════════════════════════════════
   * Public API
   * ═══════════════════════════════════════════════════════════════════ */

  return {
    baseUrl: base,
    getSystemStats: getSystemStats,
    getObjectInfo: getObjectInfo,
    getQueue: getQueue,
    uploadImage: uploadImage,
    submitPrompt: submitPrompt,
    getHistory: getHistory,
    downloadView: downloadView,
    waitForPrompt: waitForPrompt,
    connectWebSocket: connectWebSocket,
  };
}
