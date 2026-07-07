/* routes/config.js — GET /config
 *
 * ImplList §1.5 — Non-sensitive config summary for the plugin.
 *
 * The plugin reads this endpoint to understand the gateway configuration
 * without needing direct access to config.yaml on disk.
 *
 * Full local paths are never exported — only basename or existence booleans.
 */

import { loadConfig } from "../config/config-loader.js";
import { writeJson } from "../utils/errors.js";

export function handleConfig(_request, response) {
  const { config } = loadConfig();

  const comfyuiRootConfigured =
    typeof config.comfyui.root === "string" && config.comfyui.root.trim().length > 0;
  const modelsDirConfigured =
    typeof config.comfyui.models_dir === "string" && config.comfyui.models_dir.trim().length > 0;
  const pluginPathConfigured =
    typeof config.photoshop.plugin_path === "string" && config.photoshop.plugin_path.trim().length > 0;

  const payload = {
    gateway: {
      host: config.model_gateway.host,
      port: config.model_gateway.port,
      provider: config.model_gateway.provider,
    },

    comfyui: {
      url: config.comfyui.url,
      rootConfigured: comfyuiRootConfigured,
      modelsDirConfigured: modelsDirConfigured,
    },

    photoshop: {
      minMajorVersion: config.photoshop.min_major_version,
      minHostVersion: config.photoshop.min_host_version,
      pluginPathConfigured: pluginPathConfigured,
    },

    debug: {
      debugWorkflows: config.pixel_oasis.debug_workflows,
      keepIntermediateImages: config.pixel_oasis.keep_intermediate_images,
    },
  };

  writeJson(response, 200, payload);
}
