/* errors.js — Structured error responses */

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

export function badRequest(response, correlationId, message) {
  sendError(response, 400, correlationId, "BAD_REQUEST", message);
}

export function notFound(response) {
  writeJson(response, 404, { error: "Not found" });
}

export function serverError(response, correlationId, message) {
  sendError(response, 500, correlationId || "", "INTERNAL_ERROR", message);
}
