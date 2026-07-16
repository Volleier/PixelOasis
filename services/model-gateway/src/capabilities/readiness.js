/* readiness.js — Compute capability readiness using ComfyUI probes
 *
 * Uses Stage 3's readiness-probe to check nodes, models, and GPU.
 * Results cached with short TTL (30s).
 */

import { probeNodes, probeGPU } from "../adapters/comfyui/readiness-probe.js";
import { probeModels } from "../adapters/comfyui/readiness-probe.js";
import logger from "../utils/logger.js";

let _cache = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 30000; /* 30 seconds */

/* ═══════════════════════════════════════════════════════════════════
 * computeAll(capabilities) → capabilities with availability populated
 * ═══════════════════════════════════════════════════════════════════ */

export async function computeAll(capabilities) {
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL_MS) {
    return _cache;
  }

  logger.info("readiness.computing", {
    component: "capability-readiness",
    data: { count: capabilities.length },
  });

  /* Probe once, apply to all */
  let gpuInfo = null;
  let nodeInfo = null;

  try {
    gpuInfo = await probeGPU();
    nodeInfo = await probeNodes([]); /* Get all available nodes */
  } catch (e) {
    logger.warn("readiness.probe_failed", {
      component: "capability-readiness",
      error: e,
    });
  }

  const results = [];
  for (const cap of capabilities) {
    /* Skip disabled capabilities */
    if (cap.enabled === false) {
      results.push({ ...cap, availability: { state: "disabled", profile: null } });
      continue;
    }

    /* Check variants for required nodes/models */
    const variants = cap.variants || [];
    let state = "ready";
    let profile = "quality_16gb";
    let missingNodes = [];
    let missingModels = [];

    if (variants.length === 0) {
      results.push({
        ...cap,
        availability: {
          state: "missing_nodes",
          profile: null,
          details: { reason: "no_executable_variant" },
        },
      });
      continue;
    }

    if (variants.length > 0) {
      /* Check preferred variant */
      const preferred = variants.find(v => v.profile === "quality_16gb") || variants[0];
      const reqNodes = preferred.requiredNodes || [];
      const reqModels = preferred.requiredModels || [];

      if (reqNodes.length > 0) {
        const nodeStatus = await probeNodes(reqNodes);
        if (nodeStatus.missing.length > 0) {
          state = "missing_nodes";
          missingNodes = nodeStatus.missing;
        }
      }

      if (reqModels.length > 0 && state === "ready") {
        const modelStatus = probeModels(reqModels);
        if (modelStatus.missing.length > 0) {
          state = "missing_models";
          missingModels = modelStatus.missing;
        }
      }

      /* Check GPU for profile */
      if (state === "ready" && gpuInfo && gpuInfo.vramFreeGb !== null) {
        const minVram = preferred.minVramGb || 13;
        if (gpuInfo.vramFreeGb < minVram) {
          state = "degraded";
          /* Try to find a lower-profile variant */
          const fallback = variants.find(v => v.profile === "balanced_16gb");
          if (fallback) profile = "balanced_16gb";
          else state = "unsupported_hardware";
        }
      }

      if (state !== "degraded") profile = preferred.profile || profile;
    }

    results.push({
      ...cap,
      availability: { state, profile, details: { missingNodes, missingModels } },
    });
  }

  _cache = results;
  _cacheTime = now;

  logger.info("readiness.computed", {
    component: "capability-readiness",
    data: { total: results.length, gpuOk: !!gpuInfo },
  });

  return results;
}

/* ═══════════════════════════════════════════════════════════════════
 * invalidateCache() — force recompute on next call
 * ═══════════════════════════════════════════════════════════════════ */

export function invalidateCache() {
  _cache = null;
  _cacheTime = 0;
}

export default { computeAll, invalidateCache };
