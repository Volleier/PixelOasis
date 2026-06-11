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

    var healthStart = Date.now();
    try {
      var resp = await fetch(base + "/health", {
        method: "GET",
        signal: controller.signal,
      });
      var ok = resp.ok;
      window.PO.Logger.info("gateway.health.completed", {
        component: "gateway",
        durationMs: Date.now() - healthStart,
        data: { url: base, healthy: ok },
      });
      return ok;
    } catch (e) {
      window.PO.Logger.warn("gateway.health.failed", {
        component: "gateway",
        durationMs: Date.now() - healthStart,
        error: e,
        data: { url: base },
      });
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

    var generateStart = Date.now();
    var corrId = requestPayload.correlationId || "";

    window.PO.Logger.info("gateway.generate.started", {
      component: "gateway",
      correlationId: corrId,
      workflowId: requestPayload.workflowId,
      data: { url: base },
    });

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
        window.PO.Logger.error("gateway.generate.failed", {
          component: "gateway",
          correlationId: corrId,
          workflowId: requestPayload.workflowId,
          durationMs: Date.now() - generateStart,
          data: { status: resp.status },
          error: { code: "HTTP_" + resp.status, message: errorText },
        });
        return {
          correlationId: corrId,
          status: "failed",
          error: {
            code: "HTTP_" + resp.status,
            message: errorText || "Gateway returned " + resp.status,
          },
        };
      }

      var data = await resp.json();

      window.PO.Logger.info("gateway.generate.completed", {
        component: "gateway",
        correlationId: corrId,
        workflowId: requestPayload.workflowId,
        durationMs: Date.now() - generateStart,
        data: { status: data.status },
      });

      return data;
    } catch (e) {
      var errCode = "NETWORK_ERROR";
      var errMsg = e instanceof Error ? e.message : String(e);

      if (e && e.name === "AbortError") {
        errCode = "TIMEOUT";
        errMsg = "Gateway request timed out after " + (GENERATE_TIMEOUT_MS / 1000) + "s";
      }

      window.PO.Logger.error("gateway.generate.failed", {
        component: "gateway",
        correlationId: corrId,
        workflowId: requestPayload.workflowId,
        durationMs: Date.now() - generateStart,
        error: { code: errCode, message: errMsg },
      });

      return {
        correlationId: corrId,
        status: "failed",
        error: {
          code: errCode,
          message: errMsg,
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
