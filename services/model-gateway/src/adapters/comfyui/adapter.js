/* adapters/comfyui/adapter.js — ComfyUI adapter (stub for G2)
 *
 * Will handle: upload image/mask → patch workflow → submit prompt →
 * poll for completion → download result → normalize response.
 */

export default {
  id: "comfyui",

  async execute(request) {
    throw new Error("ComfyUI adapter not yet implemented (G2 milestone).");
  },
};
