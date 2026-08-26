import { resolve } from "node:path";

const serviceRoot = resolve(import.meta.dirname, "..");
const projectRoot = resolve(serviceRoot, "..", "..");

export default {
  host: process.env.PO_ONLINE_HOST || "127.0.0.1",
  port: Number(process.env.PO_ONLINE_PORT || 8790),
  dataDir: process.env.PO_ONLINE_DATA_DIR || resolve(projectRoot, ".pixeloasis", "online-data"),
  capabilitiesDir: resolve(projectRoot, "services", "model-gateway", "capabilities"),
  upstream: {
    baseUrl: (process.env.FEIFEIMIAO_BASE_URL || "https://api.feifeimiao.top/v1").replace(/\/+$/, ""),
    apiKey: process.env.FEIFEIMIAO_API_KEY || "",
    model: process.env.FEIFEIMIAO_IMAGE_MODEL || "gpt-image-2",
    timeoutMs: Number(process.env.FEIFEIMIAO_TIMEOUT_MS || 300000),
  },
  maxUploadBytes: Number(process.env.PO_ONLINE_MAX_UPLOAD_MB || 100) * 1024 * 1024,
  concurrency: Math.max(1, Number(process.env.PO_ONLINE_CONCURRENCY || 2)),
  artifactTtlMs: 7 * 24 * 60 * 60 * 1000,
};
