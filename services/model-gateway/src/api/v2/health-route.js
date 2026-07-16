/* health-route.js — V2 health endpoint with depth support
 *
 * GET /v2/health?depth=basic  → gateway + comfyui status
 * GET /v2/health?depth=full   → adds GPU, models, nodes, disk, queue
 */

import { writeJson } from "../../utils/errors.js";
import config from "../../config.js";
import logger from "../../utils/logger.js";
import { existsSync, readFileSync, statfsSync } from "node:fs";
import { resolve } from "node:path";

export async function handleHealth(req, res, params) {
  const depth = params.get("depth") || "basic";
  const result = { status: "ok", gateway: "ok", timestamp: new Date().toISOString() };

  /* ComfyUI probe */
  try {
    const resp = await fetch(config.comfyui.baseUrl + "/system_stats", { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const stats = await resp.json();
      result.comfyui = "connected";
      if (depth === "full") {
        result.gpu = {
          name: stats.system?.gpu?.name || "GPU",
          vram_total_gb: stats.system?.gpu?.vram_total ? Math.round(stats.system.gpu.vram_total / 1024) : null,
          vram_free_gb: stats.system?.gpu?.vram_free ? Math.round(stats.system.gpu.vram_free / 1024) : null,
        };
      }
    } else {
      result.comfyui = "error:" + resp.status;
    }
  } catch (e) {
    result.comfyui = "disconnected";
  }

  /* Full depth: models, nodes, disk, queue */
  if (depth === "full") {
    /* Models */
    try {
      const manifestPath = resolve(config.comfyuiRoot || "", "models/models.manifest.yaml");
      if (existsSync(manifestPath)) {
        const yaml = await import("yaml");
        const manifest = yaml.parse(readFileSync(manifestPath, "utf8"));
        const models = manifest.models || [];
        const missingList = [];
        for (const m of models) {
          const modelPath = resolve(config.comfyuiModelsDir || config.comfyuiRoot || "", m.path || "");
          if (!existsSync(modelPath)) missingList.push(m.name || m.id || m.path);
        }
        result.models = { total: models.length, ready: models.length - missingList.length, missing: missingList.length, missing_list: missingList };
      } else {
        result.models = { total: 0, ready: 0, missing: 0, missing_list: [] };
      }
    } catch (e) {
      result.models = { error: e.message };
    }

    /* Nodes */
    try {
      const resp = await fetch(config.comfyui.baseUrl + "/object_info", { signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        const info = await resp.json();
        const nodeNames = Object.keys(info);
        result.nodes = { total: nodeNames.length, ready: nodeNames.length, missing: 0, missing_list: [] };
      } else {
        result.nodes = { total: 0, ready: 0, missing: 0, missing_list: [] };
      }
    } catch (e) {
      result.nodes = { total: 0, ready: 0, missing: 0, missing_list: ["无法连接到 ComfyUI"] };
    }

    /* Disk */
    try {
      const stats = statfsSync(config.dataDir || process.cwd());
      result.disk = { free_gb: Math.floor((Number(stats.bavail) * Number(stats.bsize)) / 1024 / 1024 / 1024) };
    } catch (error) {
      result.disk = { free_gb: null, error: "unavailable" };
    }

    /* Profile */
    result.profile = config.gpuConcurrency > 0 ? "quality_16gb" : "none";
  }

  writeJson(res, 200, result);
  logger.info("health.v2", { component: "health-route", data: { depth } });
}
