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
import logger from "../utils/logger.js";

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
  var reqStart = Date.now();

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
    logger.warn("request.invalid", {
      component: "generate",
      data: { reason: "JSON parse failed" },
      error: e,
    });
    if (e && e.message === "PAYLOAD_TOO_LARGE") {
      badRequest(response, "", "请求体超过 " + (maxBytes / 1024 / 1024) + " MB 限制");
    } else {
      badRequest(response, "", "请求体不是有效的 JSON");
    }
    return;
  }

  var corrId = body.correlationId || "";
  var workflowId = body.workflowId || "";

  logger.info("request.received", {
    component: "generate",
    correlationId: corrId,
    workflowId: workflowId,
    data: {
      promptLength: (body.parameters && body.parameters.prompt) ? body.parameters.prompt.length : 0,
      hasSelection: !!body.selection,
    },
  });

  /* ── G1: Full validation ── */
  var validation = validateGenerateRequest(body);
  if (!validation.valid) {
    logger.warn("request.invalid", {
      component: "generate",
      correlationId: corrId,
      workflowId: workflowId,
      data: { reason: validation.error },
    });
    badRequest(response, corrId, validation.error);
    return;
  }

  /* ── Normalize before execution ── */
  body = normalizeRequest(body);

  /* ── Resolve adapter & execute ── */
  try {
    var adapter = resolveAdapter(body);
    var result = await adapter.execute(body);

    logger.info("response.succeeded", {
      component: "generate",
      correlationId: corrId,
      workflowId: workflowId,
      durationMs: Date.now() - reqStart,
      data: {
        resultWidth: result.result ? result.result.width : undefined,
        resultHeight: result.result ? result.result.height : undefined,
      },
    });

    writeJson(response, 200, result);
  } catch (error) {
    logger.error("response.failed", {
      component: "generate",
      correlationId: corrId,
      workflowId: workflowId,
      durationMs: Date.now() - reqStart,
      error: error,
    });
    serverError(
      response,
      corrId,
      error instanceof Error ? error.message : "Unexpected error",
    );
  }
}
