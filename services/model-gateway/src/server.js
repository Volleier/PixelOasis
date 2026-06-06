/* server.js — PixelOasis model-gateway entry point
 *
 * DevList §9 — Phase G0: Service Skeleton.
 *
 * Routes:
 *   GET  /health     → health check
 *   GET  /workflows  → workflow registry
 *   POST /generate   → submit generation request
 */

import { createServer } from "node:http";
import config from "./config.js";
import { handleHealth } from "./routes/health.js";
import { handleWorkflows } from "./routes/workflows.js";
import { handleGenerate } from "./routes/generate.js";
import { notFound } from "./utils/errors.js";

var ROUTES = {
  "GET:/health": handleHealth,
  "GET:/workflows": handleWorkflows,
  "POST:/generate": handleGenerate,
};

var server = createServer(async function (request, response) {
  var key = request.method + ":" + request.url;
  var handler = ROUTES[key];

  if (handler) {
    await handler(request, response);
  } else {
    notFound(response);
  }
});

server.listen(config.port, config.host, function () {
  console.log("PixelOasis model-gateway listening at http://" + config.host + ":" + config.port);
  console.log("  GET  /health     → health check");
  console.log("  GET  /workflows  → workflow registry");
  console.log("  POST /generate   → submit generation (echo adapter)");
});
