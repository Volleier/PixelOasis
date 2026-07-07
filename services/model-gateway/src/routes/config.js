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

/* P2-2 placeholder detector */
function isPlaceholder(val) {
  if (typeof val !== "string" || val.trim().length === 0) return true;
  return /Your[\/\\]Path[\/\\]To/i.test(val.trim());
}

export function handleConfig(_request, response) {
  const { config } = loadConfig();

  var cr = config.comfyui.root;
  var md = config.comfyui.models_dir;
  var pp = config.photoshop.plugin_path;

  const comfyuiRootConfigured =
    typeof cr === "string" && cr.trim().length > 0 && !isPlaceholder(cr);
  const modelsDirConfigured =
    typeof md === "string" && md.trim().length > 0 && !isPlaceholder(md);
  const pluginPathConfigured =
    typeof pp === "string" && pp.trim().length > 0 && !isPlaceholder(pp);

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
