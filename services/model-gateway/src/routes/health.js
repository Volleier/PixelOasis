/* routes/health.js — GET /health
 *
 * DevList §9 — Phase G0: Gateway Runtime Hardening.
 *
 * Always reports gateway process status and configured ComfyUI URL.
 *
 * Query params:
 *   ?upstream=1    — also probe ComfyUI /system_stats
 *   ?upstream=deep — also probe ComfyUI /system_stats and /object_info
 *
 * ComfyUI offline is NOT a gateway error — the health endpoint returns 200
 * and reports upstream status in the payload so the plugin can distinguish
 * "gateway is up but ComfyUI is down" from "gateway is completely dead".
 */

import config from "../config.js";
import { writeJson } from "../utils/errors.js";

/* ── Small helper: fetch JSON from a URL with a timeout ── */
async function fetchJson(url, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);

  try {
    var response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    var data = await response.json();
    return { ok: true, data: data };
  } catch (error) {
    if (error.name === "AbortError") {
      return { ok: false, error: "timeout" };
    }
    return { ok: false, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

/* ── Probe a single ComfyUI base URL ── */
async function probeComfyUI(baseUrl, deep) {
  var result = { baseUrl: baseUrl, reachable: false };

  /* system_stats (lightweight, always called for upstream checks) */
  var stats = await fetchJson(baseUrl + "/system_stats", 5000);
  if (stats.ok) {
    result.reachable = true;
    result.systemStats = stats.data;
  } else {
    result.systemStatsError = stats.error || ("HTTP " + stats.status);
  }

  /* object_info (heavy, only for deep checks) */
  if (deep && result.reachable) {
    var info = await fetchJson(baseUrl + "/object_info", 10000);
    if (info.ok) {
      result.objectInfo = info.data;
    } else {
      result.objectInfoError = info.error || ("HTTP " + info.status);
    }
  }

  return result;
}

export async function handleHealth(request, response, params) {
  var upstream = (params && params.get("upstream")) || "0";

  var payload = {
    status: "ok",
    service: "pixeloasis-model-gateway",
    version: "0.1.0",

    /* Gateway process identity */
    gateway: {
      provider: config.modelProvider,
      uptime: process.uptime(),
      nodeVersion: process.version,
      pid: process.pid,
    },

    /* ComfyUI upstream configuration (always reported) */
    comfyui: {
      configuredUrl: config.comfyui.baseUrl,
    },
  };

  /* ── Optional upstream probe ── */
  if (upstream === "1" || upstream === "deep") {
    var deep = upstream === "deep";
    var primary = await probeComfyUI(config.comfyui.baseUrl, deep);
    payload.comfyui.upstream = primary;

    /* If the primary URL is unreachable and no explicit COMFYUI_URL was set,
     * try fallback candidates for diagnostic purposes. */
    if (!primary.reachable && !process.env.COMFYUI_URL) {
      var fallbacks = {};
      for (var i = 0; i < config.comfyui.fallbackCandidates.length; i++) {
        var candidate = config.comfyui.fallbackCandidates[i];
        if (candidate === config.comfyui.baseUrl) continue; // already tried
        fallbacks[candidate] = await probeComfyUI(candidate, false);
      }
      if (Object.keys(fallbacks).length > 0) {
        payload.comfyui.fallbacks = fallbacks;
      }
    }
  }

  writeJson(response, 200, payload);
}
