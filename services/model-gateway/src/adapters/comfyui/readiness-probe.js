/* readiness-probe.js — Probe ComfyUI health for capability readiness
 *
 * GatewayOrchestrationDesign §4.2: determines if a capability can run.
 * States: ready / degraded / missing_models / missing_nodes / unsupported_hardware
 */

import { getSystemStats, getObjectInfo } from "./http-client.js";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import config from "../../config.js";
import logger from "../../utils/logger.js";

/* ═══════════════════════════════════════════════════════════════════
 * probeNodes(requiredNodes) → { total, found, missing: [name] }
 * ═══════════════════════════════════════════════════════════════════ */

export async function probeNodes(requiredNodes = []) {
  try {
    const info = await getObjectInfo();
    if (!info) return { total: requiredNodes.length, found: 0, missing: requiredNodes };

    const available = new Set(Object.keys(info));
    const missing = [];
    for (const name of requiredNodes) {
      /* Check if node class name exists in object_info */
      if (!available.has(name)) {
        /* Also check common class name patterns */
        let found = false;
        for (const key of available) {
          if (key.toLowerCase().indexOf(name.toLowerCase()) !== -1) { found = true; break; }
        }
        if (!found) missing.push(name);
      }
    }

    return { total: requiredNodes.length, found: requiredNodes.length - missing.length, missing };
  } catch (e) {
    logger.warn("readiness.nodes_probe_failed", { component: "readiness-probe", error: e });
    return { total: requiredNodes.length, found: 0, missing: requiredNodes };
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * probeModels(requiredModels) → { total, found, missing: [name] }
 * ═══════════════════════════════════════════════════════════════════ */

export function probeModels(requiredModels = []) {
  const comfyRoot = config.comfyuiRoot || "";
  const modelsDir = config.modelAssetsDir || config.comfyuiModelsDir || resolve(comfyRoot, "models");

  const missing = [];
  for (const model of requiredModels) {
    const modelPath = resolve(modelsDir, model.path || model.name || model);
    if (!existsSync(modelPath) || (model.minSizeBytes && _fileSize(modelPath) < model.minSizeBytes)) {
      missing.push(model.name || model.id || model);
    }
  }

  return { total: requiredModels.length, found: requiredModels.length - missing.length, missing };
}

function _fileSize(filePath) {
  try {
    return statSync(filePath).size;
  } catch (_) {
    return 0;
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * probeGPU() → { name, vramTotalGb, vramFreeGb } | null
 * ═══════════════════════════════════════════════════════════════════ */

export async function probeGPU() {
  try {
    const stats = await getSystemStats();
    if (!stats || !stats.system) return null;

    const gpu = stats.system.gpu || {};
    return {
      name: gpu.name || "GPU",
      vramTotalGb: gpu.vram_total ? Math.round(gpu.vram_total / 1024) : null,
      vramFreeGb: gpu.vram_free ? Math.round(gpu.vram_free / 1024) : null,
    };
  } catch (e) {
    logger.warn("readiness.gpu_probe_failed", { component: "readiness-probe", error: e });
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * getOverallReadiness(capability) → { state, profile, details }
 * ═══════════════════════════════════════════════════════════════════ */

export async function getOverallReadiness(capability) {
  if (!capability) return { state: "disabled", profile: null };

  const variants = capability.variants || [];
  const preferred = variants.find(v => v.profile === (capability.preferredProfile || "quality_16gb")) || variants[0];
  if (!preferred) return { state: "disabled", profile: null };

  const requiredNodes = preferred.requiredNodes || [];
  const requiredModels = preferred.requiredModels || [];

  /* Check nodes */
  const nodeStatus = await probeNodes(requiredNodes);
  if (nodeStatus.missing.length > 0) {
    return { state: "missing_nodes", profile: preferred.profile, details: { missingNodes: nodeStatus.missing } };
  }

  /* Check models */
  const modelStatus = probeModels(requiredModels);
  if (modelStatus.missing.length > 0) {
    return { state: "missing_models", profile: preferred.profile, details: { missingModels: modelStatus.missing } };
  }

  /* Check GPU */
  const gpu = await probeGPU();
  if (gpu && gpu.vramFreeGb !== null) {
    const minVram = preferred.minVramGb || (preferred.profile === "quality_16gb" ? 13 : 8);
    if (gpu.vramFreeGb < minVram) {
      /* Check if a lower profile variant exists */
      const fallback = variants.find(v => v.profile === "balanced_16gb" || v.profile === "safe_low_vram");
      if (fallback) {
        return { state: "degraded", profile: fallback.profile, details: { reason: "VRAM不足，降级至 " + fallback.profile } };
      }
      return { state: "unsupported_hardware", profile: null, details: { vramFreeGb: gpu.vramFreeGb, requiredGb: minVram } };
    }
  }

  return { state: "ready", profile: preferred.profile };
}

export default { probeNodes, probeModels, probeGPU, getOverallReadiness };
