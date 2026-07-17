/* router.js — V2 API route dispatcher with parameterized paths
 *
 * Matches paths like /v2/jobs/{id} and /v2/jobs/{id}/events
 * All responses get X-Correlation-Id and Cache-Control: no-store.
 */

import { handleHealth } from "./health-route.js";
import { handleCapabilities, handleCapabilityById } from "./capabilities-route.js";
import { handleAssetUpload, handleAssetHead } from "./assets-route.js";
import { handleCreateJob, handleGetJob, handleListJobs, handleCancelJob, handleRetryJob, handleJobEvents, handleGetJobAudit, handleClientEvent } from "./jobs-route.js";
import { handleArtifactDownload } from "./artifacts-route.js";
import { v2NotFound, v2ServerError } from "../../utils/errors.js";
import logger from "../../utils/logger.js";
import { attachTraceContext } from "../../observability/trace-context.js";

/* ── Exact routes (method + path) ── */
const EXACT_ROUTES = {
  "GET:/v2/health":        handleHealth,
  "GET:/v2/capabilities":  handleCapabilities,
  "POST:/v2/assets":       handleAssetUpload,
  "POST:/v2/jobs":         handleCreateJob,
  "GET:/v2/jobs":          handleListJobs,
};

/* ── Parameterized routes ── */
const PARAM_ROUTES = [
  /* /v2/capabilities/{id} */
  { method: "GET", pattern: /^\/v2\/capabilities\/([A-Za-z0-9_.-]+)$/, handler: handleCapabilityById, paramKeys: ["id"] },
  /* /v2/assets/{id} */
  { method: "HEAD", pattern: /^\/v2\/assets\/([A-Za-z0-9_-]+)$/, handler: handleAssetHead, paramKeys: ["id"] },
  /* /v2/jobs/{id} */
  { method: "GET", pattern: /^\/v2\/jobs\/([A-Za-z0-9_-]+)$/, handler: handleGetJob, paramKeys: ["id"] },
  /* /v2/jobs/{id}/events */
  { method: "GET", pattern: /^\/v2\/jobs\/([A-Za-z0-9_-]+)\/events$/, handler: handleJobEvents, paramKeys: ["id"] },
  /* /v2/jobs/{id}/retry */
  { method: "POST", pattern: /^\/v2\/jobs\/([A-Za-z0-9_-]+)\/retry$/, handler: handleRetryJob, paramKeys: ["id"] },
  /* DELETE /v2/jobs/{id} */
  { method: "DELETE", pattern: /^\/v2\/jobs\/([A-Za-z0-9_-]+)$/, handler: handleCancelJob, paramKeys: ["id"] },
  /* /v2/artifacts/{id} */
  { method: "GET", pattern: /^\/v2\/artifacts\/([A-Za-z0-9_-]+)$/, handler: handleArtifactDownload, paramKeys: ["id"] },
  /* /v2/jobs/{id}/audit */
  { method: "GET", pattern: /^\/v2\/jobs\/([A-Za-z0-9_-]+)\/audit$/, handler: handleGetJobAudit, paramKeys: ["id"] },
  /* /v2/jobs/{id}/client-events */
  { method: "POST", pattern: /^\/v2\/jobs\/([A-Za-z0-9_-]+)\/client-events$/, handler: handleClientEvent, paramKeys: ["id"] },
];

/* ═══════════════════════════════════════════════════════════════════
 * dispatch(method, pathname, req, res, queryParams)
 * ═══════════════════════════════════════════════════════════════════ */

export async function dispatch(method, pathname, req, res, queryParams) {
  /* Set common headers */
  const traceContext = attachTraceContext(req, res);
  const corrId = traceContext.correlationId;
  res.setHeader("X-Correlation-Id", corrId);
  res.setHeader("Cache-Control", "no-store");

  const reqStart = Date.now();

  try {
    /* ── Exact route match ── */
    const exactKey = method + ":" + pathname;
    const exactHandler = EXACT_ROUTES[exactKey];
    if (exactHandler) {
      await exactHandler(req, res, queryParams);
      logger.info("v2.request_completed", {
        component: "v2-router",
        data: { method, path: pathname, httpStatus: res.statusCode },
        traceId: traceContext.traceId,
        correlationId: corrId,
        durationMs: Date.now() - reqStart,
      });
      return;
    }

    /* ── Parameterized route match ── */
    for (const route of PARAM_ROUTES) {
      if (route.method !== method) continue;
      const match = pathname.match(route.pattern);
      if (match) {
        const params = {};
        for (let i = 0; i < route.paramKeys.length; i++) {
          params[route.paramKeys[i]] = match[i + 1];
        }
        await route.handler(req, res, params, queryParams);
        logger.info("v2.request_completed", {
          component: "v2-router",
          data: { method, path: pathname, params, httpStatus: res.statusCode },
          traceId: traceContext.traceId,
          correlationId: corrId,
          durationMs: Date.now() - reqStart,
        });
        return;
      }
    }

    /* ── Not found ── */
    v2NotFound(res, "NOT_FOUND", "Endpoint not found: " + method + " " + pathname);
    logger.debug("v2.not_found", {
      component: "v2-router",
      data: { method, path: pathname, httpStatus: 404 },
      traceId: traceContext.traceId,
      correlationId: corrId,
    });
  } catch (err) {
    logger.error("v2.handler_error", {
      component: "v2-router",
      data: { method, path: pathname, httpStatus: 500, errorClass: err.constructor ? err.constructor.name : typeof err },
      traceId: traceContext.traceId,
      correlationId: corrId,
      error: err,
      durationMs: Date.now() - reqStart,
    });
    v2ServerError(res, "INTERNAL_ERROR", "Internal server error");
  }
}

export default { dispatch };
