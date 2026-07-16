/* config.js — Central configuration for PixelOasis model-gateway
 *
 * ImplList §1.4 — Refactored to load from config.yaml via config-loader.
 *
 * Priority: env var > config.yaml > built-in defaults.
 * Environment variables:
 *   PO_HOST            — gateway listen host
 *   PO_PORT            — gateway listen port
 *   PO_MODEL_PROVIDER  — active adapter (default: comfyui)
 *   COMFYUI_URL        — ComfyUI upstream base URL
 *   PO_LOG_LEVEL       — log level override
 *   PO_LOG_DIR         — log directory override
 *   PO_LOG_ENABLED     — set to "0" to disable logging
 *   PO_LOG_PROMPT_TEXT — set to "1" to log full prompt text
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/config-loader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

const { config: loaded, warnings } = loadConfig();

/* Surface any warnings from the config loader */
for (const w of warnings) {
  console.warn("[config] " + w);
}

export default {
  /* ── Gateway server ─────────────────────────────── */
  host: loaded.model_gateway.host,
  port: loaded.model_gateway.port,

  /* ── Model provider — driven by config / env ────── */
  modelProvider: loaded.model_gateway.provider,

  /* ── ComfyUI upstream ───────────────────────────── */
  comfyui: {
    baseUrl: loaded.comfyui.url,

    /* Fallback candidates for auto-detection when the primary URL fails.
     * Checked in order by GET /health?upstream=1. */
    fallbackCandidates: [
      "http://127.0.0.1:51818",   // ComfyUI Desktop
      "http://127.0.0.1:8188",   // Manual / portable ComfyUI
    ],
  },

  /* ── Limits ─────────────────────────────────────── */
  maxPayloadBytes: 50 * 1024 * 1024, /* 50 MB */

  /* ── Logging ────────────────────────────────────── */
  logging: {
    enabled: process.env.PO_LOG_ENABLED !== "0",
    level: loaded.model_gateway.log_level || "info",
    dir: (loaded.logging && loaded.logging.dir) || process.env.PO_LOG_DIR || path.resolve(PROJECT_ROOT, "logs"),
    maxFileBytes: 5 * 1024 * 1024,
    retainFiles: 10,
    logPromptText: process.env.PO_LOG_PROMPT_TEXT === "1",
  },

  /* ── PixelOasis debug & behaviour ───────────────── */
  pixelOasis: {
    debugWorkflows: loaded.pixel_oasis.debug_workflows !== false,
    keepIntermediateImages: loaded.pixel_oasis.keep_intermediate_images === true,
    defaultResultLayerGroup: loaded.pixel_oasis.default_result_layer_group || "PixelOasis",
  },

  /* ── ComfyUI root path (for debug/model checks) ──── */
  comfyuiRoot: loaded.comfyui.root || "",
  comfyuiModelsDir: loaded.comfyui.models_dir || "",

  /* ── v2: Data & persistence ──────────────────────── */
  dataDir: process.env.PO_DATA_DIR || loaded.model_gateway.data_dir || "E:/PixelOasisData",
  sqlitePath: process.env.PO_SQLITE_PATH || loaded.model_gateway.sqlite_path || "",
  sqliteDir: "E:/PixelOasisData",
  gpuConcurrency: loaded.model_gateway.gpu_concurrency || 1,
  cpuConcurrency: loaded.model_gateway.cpu_concurrency || 2,
  maxQueuedPerClient: loaded.model_gateway.max_queued_per_client || 3,
  jobTtlHours: loaded.model_gateway.job_ttl_hours || 24,
  artifactTtlHours: loaded.model_gateway.artifact_ttl_hours || 24,
  uploadMaxMb: loaded.model_gateway.upload_max_mb || 100,
  jobInputMaxMb: loaded.model_gateway.job_input_max_mb || 300,
};
