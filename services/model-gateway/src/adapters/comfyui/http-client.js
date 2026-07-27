/* http-client.js — Enhanced ComfyUI HTTP client
 *
 * Extracted from existing client.js. Adds queue/interrupt/delete.
 * All methods have timeout + AbortSignal support.
 */

import config from "../../config.js";
import logger from "../../utils/logger.js";

const DEFAULT_TIMEOUT_MS = 30000;

/* ── Error classes (re-exported for compatibility) ── */
export class ComfyUIError extends Error {
  constructor(message, details) { super(message); this.name = "ComfyUIError"; this.details = details || {}; }
}
export class ComfyUIOfflineError extends ComfyUIError {
  constructor(baseUrl, cause) { super("ComfyUI unreachable at " + baseUrl, { baseUrl, cause }); this.name = "ComfyUIOfflineError"; }
}
export class ComfyUIValidationError extends ComfyUIError {
  constructor(message, nodeErrors, promptResponse) { super(message, { nodeErrors, promptResponse }); this.name = "ComfyUIValidationError"; this.nodeErrors = nodeErrors || {}; }
}
export class ComfyUITimeoutError extends ComfyUIError {
  constructor(promptId, timeoutMs) { super("Generation timed out after " + timeoutMs + "ms", { promptId, timeoutMs }); this.name = "ComfyUITimeoutError"; }
}
export class ComfyUINoOutputError extends ComfyUIError {
  constructor(promptId) { super("No output images produced", { promptId }); this.name = "ComfyUINoOutputError"; }
}

/* ── Base URL ── */
function baseUrl() { return config.comfyui.baseUrl; }

/* ── Internal fetch helper ── */
async function _fetch(method, path, opts = {}) {
  const url = baseUrl() + path;
  const signal = opts.signal || (opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : AbortSignal.timeout(DEFAULT_TIMEOUT_MS));
  const startTime = Date.now();

  try {
    const fetchOpts = { method, signal };
    if (opts.body) { fetchOpts.body = opts.body; }
    if (opts.headers) { fetchOpts.headers = opts.headers; }

    const resp = await fetch(url, fetchOpts);
    const duration = Date.now() - startTime;

    if (method === "GET" || method === "HEAD") {
      logger.debug("comfyui.request", { component: "comfyui-http", data: { method, path, status: resp.status, durationMs: duration } });
    }

    return resp;
  } catch (e) {
    if (e.name === "AbortError" || e.name === "TimeoutError") {
      throw new ComfyUITimeoutError(opts.promptId || "unknown", opts.timeoutMs || DEFAULT_TIMEOUT_MS);
    }
    throw new ComfyUIOfflineError(baseUrl(), e);
  }
}

/* ── Public API ── */

export async function uploadImage(filePath, filename, overwrite = false) {
  const { readFileSync } = await import("node:fs");
  const blob = new Blob([readFileSync(filePath)]);
  const form = new FormData();
  const normalized = String(filename).replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const imageName = segments.pop() || "source.png";
  const subfolder = segments.join("/");
  form.append("image", blob, imageName);
  if (subfolder) form.append("subfolder", subfolder);
  form.append("type", "input");
  if (overwrite) form.append("overwrite", "true");

  const resp = await _fetch("POST", "/upload/image", { body: form, timeoutMs: 60000 });
  if (!resp.ok) throw new ComfyUIError("Upload failed: HTTP " + resp.status, { filename, status: resp.status });
  return resp.json();
}

export async function submitPrompt(apiJson, clientId) {
  const body = JSON.stringify({ prompt: apiJson, client_id: clientId || "pixeloasis" });
  const resp = await _fetch("POST", "/prompt", {
    body, timeoutMs: 30000,
    headers: { "Content-Type": "application/json" },
  });

  const data = await resp.json();
  if (!resp.ok || data.error) {
    const nodeErrors = data.node_errors || {};
    throw new ComfyUIValidationError(data.error || "Prompt validation failed", nodeErrors, data);
  }
  if (!data.prompt_id) throw new ComfyUIError("No prompt_id returned");
  return data;
}

export async function getHistory(promptId) {
  const resp = await _fetch("GET", "/history/" + encodeURIComponent(promptId), { timeoutMs: 15000 });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data[promptId] || null;
}

export async function getQueue() {
  const resp = await _fetch("GET", "/queue", { timeoutMs: 10000 });
  if (!resp.ok) return null;
  return resp.json();
}

export async function interruptPrompt() {
  const resp = await _fetch("POST", "/interrupt", { timeoutMs: 10000 });
  return resp.ok;
}

export async function deleteFromQueue(promptIds) {
  const body = JSON.stringify({ delete: Array.isArray(promptIds) ? promptIds : [promptIds] });
  const resp = await _fetch("POST", "/queue", {
    body, timeoutMs: 10000,
    headers: { "Content-Type": "application/json" },
  });
  return resp.ok;
}

export async function getSystemStats() {
  const resp = await _fetch("GET", "/system_stats", { timeoutMs: 5000 });
  if (!resp.ok) return null;
  return resp.json();
}

export async function getObjectInfo() {
  const resp = await _fetch("GET", "/object_info", { timeoutMs: 10000 });
  if (!resp.ok) return null;
  return resp.json();
}

export async function viewImage(filename, subfolder, type) {
  const qs = new URLSearchParams({ filename, subfolder: subfolder || "", type: type || "output" });
  const resp = await _fetch("GET", "/view?" + qs.toString(), { timeoutMs: 30000 });
  if (!resp.ok) throw new ComfyUIError("View image failed: HTTP " + resp.status, { filename });
  return resp.arrayBuffer();
}

export async function getImage(filename, subfolder, type) {
  /* Alias for viewImage */
  return viewImage(filename, subfolder, type);
}

export default { uploadImage, submitPrompt, getHistory, getQueue, interruptPrompt, deleteFromQueue, getSystemStats, getObjectInfo, viewImage, getImage };
