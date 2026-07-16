/* errors.js — Structured error responses (v1 + v2) */

export function writeJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

export function sendError(response, statusCode, correlationId, code, message) {
  writeJson(response, statusCode, {
    correlationId: correlationId || "",
    error: { code, message },
  });
}

/* v1 helpers */
export function badRequest(response, correlationId, message) {
  sendError(response, 400, correlationId, "BAD_REQUEST", message);
}

export function notFound(response) {
  writeJson(response, 404, { error: "Not found" });
}

export function serverError(response, correlationId, message) {
  sendError(response, 500, correlationId || "", "INTERNAL_ERROR", message);
}

/* ── v2 error helpers (GatewayOrchestrationDesign §10) ── */

export function v2BadRequest(response, code, message, details) {
  writeJson(response, 400, {
    error: { code: code || "REQUEST_SCHEMA_INVALID", message: message || "Bad request", retryable: false, details: details || null },
  });
}

export function v2NotFound(response, code, message) {
  writeJson(response, 404, {
    error: { code: code || "NOT_FOUND", message: message || "Not found", retryable: false },
  });
}

export function v2Conflict(response, code, message) {
  writeJson(response, 409, {
    error: { code: code || "DOCUMENT_STATE_CONFLICT", message: message || "Conflict", retryable: false },
  });
}

export function v2Unprocessable(response, code, message, details) {
  writeJson(response, 422, {
    error: { code: code || "INPUT_MASK_REQUIRED", message: message || "Unprocessable", retryable: false, details: details || null },
  });
}

export function v2ServerError(response, code, message) {
  writeJson(response, 500, {
    error: { code: code || "PIPELINE_FAILED", message: message || "Internal server error", retryable: true },
  });
}

export function v2GatewayError(response, code, message) {
  writeJson(response, 502, {
    error: { code: code || "COMFYUI_UNAVAILABLE", message: message || "Upstream unavailable", retryable: true },
  });
}

export function v2QueueFull(response, code, message) {
  writeJson(response, 429, {
    error: { code: code || "QUEUE_LIMIT_EXCEEDED", message: message || "Too many requests", retryable: false },
  });
}

export function v2DependencyMissing(response, code, message, details) {
  writeJson(response, 424, {
    error: { code: code || "MODEL_MISSING", message: message || "Dependency not ready", retryable: false, details: details || null },
  });
}

/* ── v2 error descriptor (callable before response is ended) ── */
export function buildV2Error(code, message, details) {
  return { code: code || "UNKNOWN", message: message || "", retryable: false, details: details || null };
}
