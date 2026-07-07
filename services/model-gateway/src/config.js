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

import { loadConfig } from "./config/config-loader.js";

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
      "http://127.0.0.1:8000",   // ComfyUI Desktop
      "http://127.0.0.1:8188",   // Manual / portable ComfyUI
    ],
  },

  /* ── Limits ─────────────────────────────────────── */
  maxPayloadBytes: 50 * 1024 * 1024, /* 50 MB */

  /* ── Logging ────────────────────────────────────── */
  logging: {
    enabled: process.env.PO_LOG_ENABLED !== "0",
    level: loaded.model_gateway.log_level || "info",
    dir: process.env.PO_LOG_DIR || "logs",
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
};
