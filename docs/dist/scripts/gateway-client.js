/* gateway-client.js — PixelOasis HTTP client for local model-gateway
 *
 * DevList §8-P3 / §4 protocol.
 *
 * Usage:
 *   var ok  = await window.PO.GatewayClient.health();
 *   var res = await window.PO.GatewayClient.generate(requestPayload);
 */

window.PO = window.PO || {};

window.PO.GatewayClient = (function () {
  "use strict";

  var DEFAULT_URL = "http://127.0.0.1:8787";
  var HEALTH_TIMEOUT_MS = 5000;
  var GENERATE_TIMEOUT_MS = 120000; /* 2 min — generation can be slow */

  function getBaseUrl() {
    return (window.PO.state && window.PO.state.gatewayUrl) || DEFAULT_URL;
  }

  /* ── Health check ── */

  async function health() {
    var base = getBaseUrl();
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, HEALTH_TIMEOUT_MS);

    try {
      var resp = await fetch(base + "/health", {
        method: "GET",
        signal: controller.signal,
      });
      return resp.ok;
    } catch (e) {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ── Generate ── */

  async function generate(requestPayload) {
    var base = getBaseUrl();
    var body = JSON.stringify(requestPayload);
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, GENERATE_TIMEOUT_MS);

    try {
      var resp = await fetch(base + "/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        signal: controller.signal,
      });

      if (!resp.ok) {
        var errorText = "";
        try { errorText = await resp.text(); } catch (e) { /* ignore */ }
        return {
          correlationId: requestPayload.correlationId || "",
          status: "failed",
          error: {
            code: "HTTP_" + resp.status,
            message: errorText || "Gateway returned " + resp.status,
          },
        };
      }

      var data = await resp.json();
      return data;
    } catch (e) {
      if (e && e.name === "AbortError") {
        return {
          correlationId: requestPayload.correlationId || "",
          status: "failed",
          error: {
            code: "TIMEOUT",
            message: "Gateway request timed out after " + (GENERATE_TIMEOUT_MS / 1000) + "s",
          },
        };
      }
      return {
        correlationId: requestPayload.correlationId || "",
        status: "failed",
        error: {
          code: "NETWORK_ERROR",
          message: e instanceof Error ? e.message : String(e),
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    health: health,
    generate: generate,
  };
})();
