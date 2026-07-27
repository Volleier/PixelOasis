/* trace-context.js — Validate, generate, and attach trace context per request
 *
 * Every inbound request carries (or receives) a traceId. This module:
 *   1. Extracts traceId from X-Trace-Id, X-Correlation-Id, or multipart fields
 *   2. Validates format (tr_<base36>_<random>)
 *   3. Generates a gateway-scoped trace ID when the client sends none
 *   4. Attaches the immutable context to `req` so routes and workers can use it
 */

import logger from "../utils/logger.js";

const TRACE_ID_RE = /^tr_[a-z0-9]{6,14}_[a-z0-9]{4,10}$/;

/* ── Create a gateway-generated trace ID ── */
export function generateTraceId() {
  const ts = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 0x1000000).toString(36).padStart(4, "0");
  return "tr_" + ts + "_" + rnd;
}

/* ── Validate a client-supplied trace ID ── */
export function isValidTraceId(id) {
  if (!id || typeof id !== "string") return false;
  return TRACE_ID_RE.test(id);
}

/* ── Attach trace context to request ── */
export function attachTraceContext(req, res) {
  /* Extract from headers or multipart fields */
  let traceId = (req.headers && (req.headers["x-trace-id"] || req.headers["X-Trace-Id"])) || null;
  const correlationId = (req.headers && (req.headers["x-correlation-id"] || req.headers["X-Correlation-Id"])) || null;
  const clientId = (req.headers && (req.headers["x-client-id"] || req.headers["X-Client-Id"])) || "default";

  let generatedByGateway = false;

  if (!isValidTraceId(traceId)) {
    /* Correlation IDs from older clients are not trace IDs. Keep them for
       compatibility, but always generate a valid trace identifier. */
    traceId = generateTraceId();
    generatedByGateway = true;
  }

  /* Attach immutable context to req */
  req._traceContext = {
    traceId: traceId,
    correlationId: correlationId || traceId,
    clientId: clientId,
    generatedByGateway: generatedByGateway,
  };

  /* Echo back in response header */
  if (res && !res.headersSent) {
    res.setHeader("X-Trace-Id", traceId);
  }

  if (generatedByGateway) {
    logger.debug("trace.generated_by_gateway", {
      component: "trace-context",
      traceId: traceId,
      data: { reason: "missing or invalid client trace ID" },
    });
  }

  return req._traceContext;
}

/* ── Update trace context from multipart fields ── */
export function mergeMultipartTrace(req, multipartFields) {
  const ctx = req._traceContext;
  if (!ctx || !multipartFields) return ctx;

  /* Client may send traceId in multipart to link uploads */
  if (multipartFields.traceId && isValidTraceId(multipartFields.traceId)) {
    ctx.traceId = multipartFields.traceId;
  }
  if (multipartFields.correlationId) {
    ctx.correlationId = multipartFields.correlationId;
  }

  /* Attach image metadata from multipart */
  ctx.assetMeta = {
    originalName: multipartFields.originalName || null,
    clientWidth: parseInt(multipartFields.clientWidth, 10) || null,
    clientHeight: parseInt(multipartFields.clientHeight, 10) || null,
    sourceScale: parseFloat(multipartFields.sourceScale) || 1,
    scope: multipartFields.scope || null,
  };

  return ctx;
}

export default { attachTraceContext, generateTraceId, isValidTraceId, mergeMultipartTrace };
