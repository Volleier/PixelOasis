/* config.js — Central configuration for PixelOasis model-gateway */

export default {
  /* Gateway server */
  host: process.env.PO_HOST || "127.0.0.1",
  port: parseInt(process.env.PO_PORT, 10) || 8787,

  /* ComfyUI upstream */
  comfyui: {
    baseUrl: process.env.COMFYUI_URL || "http://127.0.0.1:8188",
  },

  /* Limits */
  maxPayloadBytes: 50 * 1024 * 1024, /* 50 MB */
};
