import { resolve } from "node:path";
import { loadEnvFiles } from "./env.js";

const serviceRoot = resolve(import.meta.dirname, "..");
const projectRoot = resolve(serviceRoot, "..", "..");

loadEnvFiles([projectRoot, serviceRoot]);

const defaultBaseUrl = (process.env.PO_ONLINE_BASE_URL || process.env.ONLINE_BASE_URL || "").replace(/\/+$/, "");
const defaultDrawUrl = (process.env.PO_ONLINE_DRAW_URL || process.env.PO_ONLINE_DRAW_BASE_URL || (defaultBaseUrl ? `${defaultBaseUrl}/draw` : "")).replace(/\/+$/, "");
const defaultTasksUrl = (process.env.PO_ONLINE_TASKS_URL || defaultBaseUrl).replace(/\/+$/, "");

export function normalizeModelName(m) {
  if (!m) return m;
  const lower = String(m).trim().toLowerCase();
  if (lower === "banana2pro" || lower === "nano-banana-2-pro" || lower === "banana-pro" || lower === "banana-2-pro") {
    return "nano-banana-pro";
  }
  return m;
}

export default {
  host: process.env.PO_ONLINE_HOST || "127.0.0.1",
  port: Number(process.env.PO_ONLINE_PORT || 8790),
  dataDir: process.env.PO_ONLINE_DATA_DIR || resolve(projectRoot, ".pixeloasis", "online-data"),
  capabilitiesDir: resolve(projectRoot, "services", "model-gateway", "capabilities"),
  upstream: {
    drawBaseUrl: defaultDrawUrl,
    tasksBaseUrl: defaultTasksUrl,
    apiKey: process.env.PO_ONLINE_API_KEY || process.env.ONLINE_API_KEY || "",
    model: normalizeModelName(process.env.PO_ONLINE_MODEL || process.env.PO_ONLINE_IMAGE_MODEL || process.env.ONLINE_IMAGE_MODEL || "nano-banana-pro"),
    supportedModels: [
      "gpt-image-2",
      "gpt-image-2-vip",
      "nano-banana-2",
      "nano-banana-2-lite",
      "nano-banana-pro",
    ],
    imageSize: process.env.PO_ONLINE_IMAGE_SIZE || process.env.ONLINE_IMAGE_SIZE || "1K",
    pollIntervalMs: Number(process.env.PO_ONLINE_POLL_INTERVAL_MS || process.env.ONLINE_POLL_INTERVAL_MS || 1500),
    timeoutMs: Number(process.env.PO_ONLINE_TIMEOUT_MS || process.env.ONLINE_TIMEOUT_MS || 300000),
  },
  maxUploadBytes: Number(process.env.PO_ONLINE_MAX_UPLOAD_MB || 100) * 1024 * 1024,
  concurrency: Math.max(1, Number(process.env.PO_ONLINE_CONCURRENCY || 2)),
  artifactTtlMs: 7 * 24 * 60 * 60 * 1000,
};

