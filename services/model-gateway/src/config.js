/* config.js — Central configuration for PixelOasis model-gateway
 *
 * DevList §9 — Phase G0: Gateway Runtime Hardening.
 *
 * Environment variables:
 *   PO_HOST            — gateway listen host (default 127.0.0.1)
 *   PO_PORT            — gateway listen port (default 8787)
 *   PO_MODEL_PROVIDER  — active adapter: "echo" | "comfyui" (default echo)
 *   COMFYUI_URL        — ComfyUI upstream base URL
 *                         (default http://127.0.0.1:8000 for ComfyUI Desktop)
 */

export default {
  /* Gateway server */
  host: process.env.PO_HOST || "127.0.0.1",
  port: parseInt(process.env.PO_PORT, 10) || 8787,

  /* Model provider — explicit env var controls the active adapter */
  modelProvider: process.env.PO_MODEL_PROVIDER || "echo",

  /* ComfyUI upstream
   *
   * ComfyUI Desktop defaults to port 8000 on this machine.
   * Manual / portable ComfyUI commonly uses port 8188.
   * Set COMFYUI_URL to override. */
  comfyui: {
    baseUrl: process.env.COMFYUI_URL || "http://127.0.0.1:8000",

    /* Fallback candidates for auto-detection when COMFYUI_URL is not set.
     * Checked in order by GET /health?upstream=1 when the primary URL fails. */
    fallbackCandidates: [
      "http://127.0.0.1:8000",   // ComfyUI Desktop
      "http://127.0.0.1:8188",   // Manual / portable ComfyUI
    ],
  },

  /* Limits */
  maxPayloadBytes: 50 * 1024 * 1024, /* 50 MB */
};
