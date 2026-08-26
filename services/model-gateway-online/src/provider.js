import { readFileSync } from "node:fs";
import sharp from "sharp";
import config from "./config.js";

function imageSize(width, height) {
  const ratio = width / height;
  if (ratio > 1.2) return "1536x1024";
  if (ratio < 0.83) return "1024x1536";
  return "1024x1024";
}

function promptFor(capability, parameters) {
  const values = Object.entries(parameters || {}).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => key + "=" + value).join(", ");
  return [
    "Edit the supplied image for a professional Photoshop result.",
    "Task: " + capability.title + ".",
    capability.description ? "Goal: " + capability.description + "." : "",
    values ? "Parameters: " + values + "." : "",
    "Preserve identity, composition, perspective, anatomy, text, logos and all areas outside the requested edit.",
    "Blend edges, lighting, color, grain and depth naturally. Return one finished image without captions or borders.",
  ].filter(Boolean).join(" ");
}

async function upstreamError(response) {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { message: text }; }
  const error = new Error(body?.error?.message || body?.message || "Online image provider returned HTTP " + response.status);
  error.status = response.status;
  error.code = response.status === 401 ? "ONLINE_AUTH_INVALID" : response.status === 429 ? "ONLINE_QUOTA_EXCEEDED" : "ONLINE_PROVIDER_ERROR";
  throw error;
}

async function decodeResult(data, signal) {
  const item = data?.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) {
    const response = await fetch(item.url, { signal });
    if (!response.ok) throw new Error("Unable to download generated image");
    return Buffer.from(await response.arrayBuffer());
  }
  throw Object.assign(new Error("Provider response did not contain image data"), { code: "ONLINE_RESULT_MISSING" });
}

export async function generateOnline({ capability, source, mask, parameters, width, height, signal }) {
  if (!config.upstream.apiKey) throw Object.assign(new Error("FEIFEIMIAO_API_KEY is not configured"), { code: "ONLINE_AUTH_MISSING", status: 424 });

  const form = new FormData();
  form.set("model", config.upstream.model);
  form.set("prompt", promptFor(capability, parameters));
  form.set("size", imageSize(width, height));
  form.set("response_format", "b64_json");
  form.append("image", new Blob([readFileSync(source.path)], { type: source.mime || "image/png" }), source.filename || "source.png");
  if (mask) form.append("mask", new Blob([readFileSync(mask.path)], { type: mask.mime || "image/png" }), mask.filename || "mask.png");

  const requestBytes = source.sizeBytes + (mask?.sizeBytes || 0);
  const startedAt = Date.now();
  const timeoutSignal = AbortSignal.timeout(config.upstream.timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(config.upstream.baseUrl + "/images/edits", {
    method: "POST",
    headers: { Authorization: "Bearer " + config.upstream.apiKey },
    body: form,
    signal: combinedSignal,
  });
  if (!response.ok) await upstreamError(response);
  const generated = await decodeResult(await response.json(), combinedSignal);
  const output = await sharp(generated).resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 }).png().toBuffer();
  return { bytes: output, metrics: { durationMs: Date.now() - startedAt, requestBytes, responseBytes: output.length, upstreamStatus: response.status, model: config.upstream.model } };
}

export async function getUsage() {
  if (!config.upstream.apiKey) return { configured: false, valid: false };
  const response = await fetch(config.upstream.baseUrl + "/usage", { headers: { Authorization: "Bearer " + config.upstream.apiKey }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) await upstreamError(response);
  return { configured: true, valid: true, ...(await response.json()) };
}
