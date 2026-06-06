/* routes/generate.js — POST /generate
 *
 * Reads the JSON body, validates it, resolves the appropriate adapter,
 * and returns the normalized PixelOasis response.
 */

import { badRequest, serverError, writeJson } from "../utils/errors.js";
import { validateGenerateRequest } from "../validation/generate-request.js";
import { resolveAdapter } from "../adapters/registry.js";

/* ── Read JSON body from the incoming request stream ── */

async function readJson(request) {
  var chunks = [];
  for await (var chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  var payload = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(payload);
}

export async function handleGenerate(request, response) {
  var body;
  try {
    body = await readJson(request);
  } catch (e) {
    badRequest(response, "", "Invalid JSON body.");
    return;
  }

  /* Validate */
  var validation = validateGenerateRequest(body);
  if (!validation.valid) {
    badRequest(response, body.correlationId || "", validation.error);
    return;
  }

  /* Resolve adapter & execute */
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
