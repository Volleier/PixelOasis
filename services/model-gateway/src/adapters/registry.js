/* adapters/registry.js — Adapter registry + resolver
 *
 * DevList §9 — Phase G0: Gateway Runtime Hardening.
 *
 * The active adapter is controlled by PO_MODEL_PROVIDER in config,
 * overridable per-request via request.adapter.provider. */

import config from "../config.js";
import echoAdapter from "./echo/adapter.js";
import comfyuiAdapter from "./comfyui/adapter.js";

var registry = {
  echo: echoAdapter,
  comfyui: comfyuiAdapter,
};

export function resolveAdapter(request) {
  /* Per-request override takes precedence, otherwise use configured default */
  var provider = (request.adapter && request.adapter.provider) || config.modelProvider;
  var adapter = registry[provider];
  if (!adapter) {
    throw new Error('No adapter registered for provider "' + provider + '".');
  }
  return adapter;
}
