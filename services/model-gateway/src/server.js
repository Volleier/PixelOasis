/* server.js — PixelOasis model-gateway entry point
 *
 * DevList §9 — Phase G0/G3.
 *
 * Routes:
 *   GET  /health     → health check (supports ?upstream=1 and ?upstream=deep)
 *   GET  /workflows  → workflow registry (file-backed, G3)
 *   POST /generate   → submit generation request
 */

import { createServer } from "node:http";
import config from "./config.js";
import { handleConfig } from "./routes/config.js";
import { handleHealth } from "./routes/health.js";
import { handleWorkflows } from "./routes/workflows.js";
import { handleGenerate } from "./routes/generate.js";
import { handleV1Generate } from "./api/v1-compat.js";
import { notFound } from "./utils/errors.js";
import { initRegistry } from "./adapters/registry-instance.js";
import { getDb } from "./persistence/database.js";
import logger from "./utils/logger.js";

/* Init logger with config */
logger.init(config);

/* Init database (v2) — runs migrations on first start */
try {
  getDb();
  console.log("  Database: ready (SQLite WAL)");
  logger.info("database.initialized", { component: "server" });
} catch (err) {
  console.warn("  Database: initialization warning — " + err.message);
  logger.warn("database.init_warning", { component: "server", error: err });
}

/* Init capability registry (v2) — loads *.capability.json files */
import { initCapabilityRegistry } from "./capabilities/registry-instance.js";
try {
  await initCapabilityRegistry();
  console.log("  Capabilities: registry loaded");
  logger.info("capabilities.initialized", { component: "server" });
} catch (err) {
  console.warn("  Capabilities: initialization warning — " + err.message);
  logger.warn("capabilities.init_warning", { component: "server", error: err });
}

/* Load pipeline definitions (v2 Stage 5-7) */
import "./pipelines/definitions/all-pipelines.js";

/* Start TTL cleanup worker (v2 Stage 8) */
import { start as startCleanup } from "./jobs/cleanup-worker.js";
startCleanup();
console.log("  Cleanup: TTL worker started");

/* Import v2 router */
import { dispatch as dispatchV2 } from "./api/v2/router.js";

/* Route table — keyed by "METHOD:pathname" */
var ROUTES = {
  "GET:/config": handleConfig,
  "GET:/health": handleHealth,
  "GET:/workflows": handleWorkflows,
  "POST:/generate": handleGenerate,
};

/* Parse request.url into pathname + URLSearchParams.
 * Node.js http request.url is the path + query string, e.g. "/health?upstream=1". */
function parseUrl(request) {
  var queryIndex = request.url.indexOf("?");
  var pathname = queryIndex === -1 ? request.url : request.url.substring(0, queryIndex);
  var queryString = queryIndex === -1 ? "" : request.url.substring(queryIndex + 1);
  var params = new URLSearchParams(queryString);
  return { pathname, params };
}

var server = createServer(async function (request, response) {
  var reqStart = Date.now();
  var { pathname, params } = parseUrl(request);
  var key = request.method + ":" + pathname;
  var handler = ROUTES[key];

  if (handler) {
    try {
      await handler(request, response, params);
    } catch (err) {
      logger.error("request.handler_error", {
        component: "server",
        data: { method: request.method, path: pathname },
        error: err,
        durationMs: Date.now() - reqStart,
      });
      notFound(response);
    }
    logger.info("request.completed", {
      component: "server",
      data: { method: request.method, path: pathname },
      durationMs: Date.now() - reqStart,
    });
  } else if (pathname.startsWith("/v2/")) {
    /* Forward to v2 router */
    await dispatchV2(request.method, pathname, request, response, params);
  } else {
    logger.debug("request.not_found", {
      component: "server",
      data: { method: request.method, path: pathname },
    });
    notFound(response);
  }
});

/* ── Startup: initialise workflow registry, then listen ── */

try {
  await initRegistry();
} catch (err) {
  console.warn("Workflow registry initialisation warning: " + err.message);
  console.warn("GET /workflows will fall back to hardcoded defaults.");
  logger.warn("workflow.init_warning", {
    component: "server",
    error: err,
  });
}

server.listen(config.port, config.host, function () {
  console.log("PixelOasis model-gateway listening at http://" + config.host + ":" + config.port);
  console.log("  Provider: " + config.modelProvider);
  console.log("  ComfyUI:  " + config.comfyui.baseUrl);
  console.log("  GET  /config     → non-sensitive config summary");
  console.log("  GET  /health     → health check (?upstream=1 for ComfyUI status)");
  console.log("  GET  /workflows  → workflow registry (file-backed)");
  console.log("  POST /generate   → submit generation");

  logger.info("gateway.started", {
    component: "server",
    data: {
      host: config.host,
      port: config.port,
      provider: config.modelProvider,
      comfyuiUrl: config.comfyui.baseUrl,
      nodeVersion: process.version,
      pid: process.pid,
    },
  });
});
