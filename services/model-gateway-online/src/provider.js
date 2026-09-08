import { readFileSync } from "node:fs";
import sharp from "sharp";
import config from "./config.js";

function mapRatioSize(width, height) {
  const ratio = width / height;
  if (ratio > 1.35) return "16:9";
  if (ratio < 0.72) return "9:16";
  if (ratio > 1.15) return "4:3";
  return "1:1";
}

function promptFor(capability, parameters, hasMask = false) {
  const values = Object.entries(parameters || {})
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => key + "=" + value)
    .join(", ");

  return [
    "Edit the supplied image for a professional Photoshop result.",
    "Task: " + capability.title + ".",
    capability.description ? "Goal: " + capability.description + "." : "",
    values ? "Parameters: " + values + "." : "",
    hasMask ? "Focus modification specifically on the area indicated by the edit mask (second image, where white indicates the edit region and black is preserved unedited)." : "",
    "Preserve identity, composition, perspective, anatomy, text, logos and all areas outside the requested edit.",
    "Blend edges, lighting, color, grain and depth naturally. Return one finished image without captions or borders.",
  ].filter(Boolean).join(" ");
}

async function upstreamError(response) {
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { message: text }; }
  const message = body?.error?.message || body?.message || "Online image provider returned HTTP " + response.status;
  const error = new Error(message);
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
  throw Object.assign(new Error("Online provider response did not contain image data"), { code: "ONLINE_RESULT_MISSING" });
}

export async function generateOnline({ capability, source, mask, parameters, width, height, signal, onProgress, model }) {
  if (!config.upstream.apiKey) {
    throw Object.assign(new Error("PO_ONLINE_API_KEY is not configured"), { code: "ONLINE_AUTH_MISSING", status: 424 });
  }
  if (!config.upstream.drawBaseUrl || !config.upstream.tasksBaseUrl) {
    throw Object.assign(new Error("PO_ONLINE_BASE_URL (or PO_ONLINE_DRAW_URL and PO_ONLINE_TASKS_URL) is not configured"), { code: "ONLINE_ENDPOINT_MISSING", status: 424 });
  }

  const sourceBuffer = readFileSync(source.path);
  const mime = source.mime || "image/png";
  const images = [`data:${mime};base64,${sourceBuffer.toString("base64")}`];

  if (mask?.path) {
    const maskBuffer = readFileSync(mask.path);
    const maskMime = mask.mime || "image/png";
    images.push(`data:${maskMime};base64,${maskBuffer.toString("base64")}`);
  }

  const selectedModel = model || parameters?.model || config.upstream.model;

  const payload = {
    model: selectedModel,
    prompt: promptFor(capability, parameters, Boolean(mask)),
    n: 1,
    size: mapRatioSize(width, height),
    imageSize: config.upstream.imageSize,
    async: true,
    image: images,
  };

  const startedAt = Date.now();
  const timeoutSignal = AbortSignal.timeout(config.upstream.timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  // 1. Submit async drawing task
  const submitRes = await fetch(`${config.upstream.drawBaseUrl}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.upstream.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: combinedSignal,
  });

  if (!submitRes.ok) await upstreamError(submitRes);
  const submitData = await submitRes.json();
  const taskId = submitData.task_id;
  if (!taskId) {
    throw Object.assign(new Error("Online provider did not return a task_id"), { code: "ONLINE_TASK_CREATION_FAILED" });
  }

  // 2. Poll site-level task endpoint (/v1/tasks/{task_id})
  const taskUrl = `${config.upstream.tasksBaseUrl}/v1/tasks/${taskId}`;
  let taskResult = null;

  while (!taskResult) {
    if (combinedSignal.aborted) throw new Error("Task aborted");

    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, config.upstream.pollIntervalMs);
      combinedSignal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("Task aborted"));
      }, { once: true });
    });

    const pollRes = await fetch(taskUrl, {
      headers: { Authorization: "Bearer " + config.upstream.apiKey },
      signal: combinedSignal,
    });

    if (!pollRes.ok) await upstreamError(pollRes);
    const pollData = await pollRes.json();

    if (pollData.data && Array.isArray(pollData.data) && pollData.data.length > 0) {
      taskResult = pollData;
      break;
    }

    if (pollData.status === "completed") {
      taskResult = pollData;
      break;
    }

    if (pollData.status === "failed") {
      const message = pollData.error?.message || "Online async task failed";
      throw Object.assign(new Error(message), { code: "ONLINE_PROVIDER_ERROR" });
    }

    if (typeof pollData.progress === "number" && onProgress) {
      onProgress(pollData.progress);
    }
  }

  // 3. Decode image and Lanczos resample to Photoshop bounds
  const generated = await decodeResult(taskResult, combinedSignal);
  const output = await sharp(generated)
    .resize(width, height, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();

  return {
    bytes: output,
    metrics: {
      durationMs: Date.now() - startedAt,
      requestBytes: source.sizeBytes + (mask?.sizeBytes || 0),
      responseBytes: output.length,
      upstreamStatus: 200,
      model: selectedModel,
      taskId,
    },
  };
}

export async function getUsage() {
  if (!config.upstream.apiKey) return { configured: false, valid: false, provider: "online", models: config.upstream.supportedModels };
  return {
    configured: true,
    valid: true,
    provider: "online",
    model: config.upstream.model,
    models: config.upstream.supportedModels,
    drawBaseUrl: config.upstream.drawBaseUrl,
  };
}

