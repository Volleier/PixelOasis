/* adapters/registry.js — Adapter registry + resolver */

import echoAdapter from "./echo/adapter.js";
import comfyuiAdapter from "./comfyui/adapter.js";

var registry = {
  echo: echoAdapter,
  comfyui: comfyuiAdapter,
};

export function resolveAdapter(request) {
  /* Allow explicit adapter override via request field */
  var provider = (request.adapter && request.adapter.provider) || "echo";
  var adapter = registry[provider];
  if (!adapter) {
    throw new Error('No adapter registered for provider "' + provider + '".');
  }
  return adapter;
}
