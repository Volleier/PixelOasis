/* routes/generate.js — POST /generate
 *
 * Reads the JSON body, validates it, resolves the appropriate adapter,
 * and returns the normalized PixelOasis response.
 */

import { badRequest, serverError, writeJson } from "../utils/errors.js";
import { validateGenerateRequest } from "../validation/generate-request.js";
import { resolveAdapter } from "../adapters/registry.js";
import config from "../config.js";

/* ── Read JSON body from incoming request stream ── */

async function readJson(request) {
  var chunks = [];
  var totalBytes = 0;
  var maxBytes = config.maxPayloadBytes || 50 * 1024 * 1024;

  for await (var chunk of request) {
    var buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > maxBytes) {
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    chunks.push(buf);
  }
  var payload = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(payload);
}

export async function handleGenerate(request, response) {
  /* ── G1: Content-Length pre-check ── */
  var contentLength = parseInt(request.headers["content-length"], 10);
  var maxBytes = config.maxPayloadBytes || 50 * 1024 * 1024;
  if (contentLength > maxBytes) {
    badRequest(response, "", "请求体超过 " + (maxBytes / 1024 / 1024) + " MB 限制");
    return;
  }

  /* ── Read & parse body ── */
  var body;
  try {
    body = await readJson(request);
  } catch (e) {
    if (e && e.message === "PAYLOAD_TOO_LARGE") {
      badRequest(response, "", "请求体超过 " + (maxBytes / 1024 / 1024) + " MB 限制");
    } else {
      badRequest(response, "", "请求体不是有效的 JSON");
    }
    return;
  }

  /* ── G1: Full validation ── */
  var validation = validateGenerateRequest(body);
  if (!validation.valid) {
    badRequest(response, body.correlationId || "", validation.error);
    return;
  }

  /* ── Resolve adapter & execute ── */
  try {
    var adapter = resolveAdapter(body);
    var result = await adapter.execute(body);
    writeJson(response, 200, result);
  } catch (error) {
    serverError(
      response,
      body.correlationId || "",
      error instanceof Error ? error.message : "Unexpected error",
    );
  }
}
