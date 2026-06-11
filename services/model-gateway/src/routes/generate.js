/* routes/generate.js — POST /generate
 *
 * Reads the JSON body, validates it, normalizes parameters, resolves the
 * appropriate adapter, and returns the normalized PixelOasis response.
 *
 * DevList §9 — Phase G0/G1.
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

/* ── Normalize optional request fields before adapter execution ── */
function normalizeRequest(body) {
  if (!body.parameters) {
    body.parameters = {};
  }

  var p = body.parameters;

  /* Default missing string fields */
  if (typeof p.prompt !== "string") {
    p.prompt = "";
  }
  if (typeof p.negativePrompt !== "string") {
    p.negativePrompt = "";
  }

  /* Seed: -1 means "random" — the gateway generates a concrete seed */
  if (p.seed === undefined || p.seed === null) {
    p.seed = -1;
  }
  if (p.seed === -1) {
    p.seed = Math.floor(Math.random() * 0x7FFFFFFF);
  }

  return body;
}

export async function handleGenerate(request, response, _params) {
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

  /* ── Normalize before execution ── */
  body = normalizeRequest(body);

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
