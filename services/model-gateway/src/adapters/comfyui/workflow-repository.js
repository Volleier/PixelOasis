/* workflow-repository.js — Workflow loading, caching, and variant resolution
 *
 * Extracted + enhanced from existing workflow-loader.js.
 * Caches parsed workflows in memory.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import config from "../../config.js";
import logger from "../../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = resolve(__dirname, "..", "..", "..", "workflows", "comfyui");

/* ── In-memory cache ── */
let _cache = null; /* { variantId: { apiJson, meta, path } } */
let _byCapability = {}; /* { capabilityId: [variantId] } */

/* ═══════════════════════════════════════════════════════════════════
 * loadAll() → map of variantId → { apiJson, meta }
 * ═══════════════════════════════════════════════════════════════════ */

export function loadAll() {
  if (_cache) return _cache;

  _cache = {};
  _byCapability = {};

  if (!existsSync(WORKFLOWS_DIR)) {
    logger.warn("workflow_repo.no_workflows_dir", { component: "workflow-repository", data: { dir: WORKFLOWS_DIR } });
    return _cache;
  }

  /* Scan recursively */
  _scanDir(WORKFLOWS_DIR);

  logger.info("workflow_repo.loaded", {
    component: "workflow-repository",
    data: { variantCount: Object.keys(_cache).length },
  });

  return _cache;
}

function _scanDir(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      _scanDir(fullPath);
    } else if (entry.name.endsWith(".meta.json")) {
      const variantId = entry.name.replace(".meta.json", "");
      const apiPath = fullPath.replace(".meta.json", ".api.json");

      if (!existsSync(apiPath)) {
        logger.warn("workflow_repo.no_api_json", { component: "workflow-repository", data: { variantId, apiPath } });
        continue;
      }

      try {
        const meta = JSON.parse(readFileSync(fullPath, "utf8"));
        const apiJson = JSON.parse(readFileSync(apiPath, "utf8"));

        _cache[variantId] = { apiJson, meta, path: fullPath };

        /* Index by capability */
        const capId = meta.capabilityId || meta.capability;
        if (capId) {
          if (!_byCapability[capId]) _byCapability[capId] = [];
          _byCapability[capId].push(variantId);
        }
      } catch (e) {
        logger.warn("workflow_repo.parse_error", { component: "workflow-repository", data: { variantId, error: e.message } });
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * getWorkflow(variantId) → { apiJson, meta } | null
 * ═══════════════════════════════════════════════════════════════════ */

export function getWorkflow(variantId) {
  const all = loadAll();
  return all[variantId] || null;
}

/* ═══════════════════════════════════════════════════════════════════
 * listWorkflows() → [{ variantId, capabilityId, profile, priority }]
 * ═══════════════════════════════════════════════════════════════════ */

export function listWorkflows() {
  const all = loadAll();
  return Object.entries(all).map(([id, wf]) => ({
    variantId: id,
    capabilityId: wf.meta.capabilityId || wf.meta.capability || null,
    profile: wf.meta.profile || "quality_16gb",
    priority: wf.meta.priority || 0,
    enabled: wf.meta.enabled !== false,
  }));
}

/* ═══════════════════════════════════════════════════════════════════
 * resolveVariant(capabilityId, profile) → variantId | null
 *
 * Finds the best matching variant: highest priority, matching profile,
 * then fallback to lower profiles.
 * ═══════════════════════════════════════════════════════════════════ */

export function resolveVariant(capabilityId, profile = "quality_16gb") {
  const all = loadAll();
  const candidates = (_byCapability[capabilityId] || [])
    .map(id => all[id])
    .filter(wf => wf && wf.meta.enabled !== false);

  if (candidates.length === 0) return null;

  /* Profile preference order */
  const profileOrder = ["quality_16gb", "balanced_16gb", "safe_low_vram"];
  const targetIdx = profileOrder.indexOf(profile);

  /* Sort: closest profile match first, then highest priority */
  candidates.sort((a, b) => {
    const aIdx = profileOrder.indexOf(a.meta.profile || "quality_16gb");
    const bIdx = profileOrder.indexOf(b.meta.profile || "quality_16gb");
    const aDist = Math.abs(aIdx - targetIdx);
    const bDist = Math.abs(bIdx - targetIdx);
    if (aDist !== bDist) return aDist - bDist;
    return (b.meta.priority || 0) - (a.meta.priority || 0);
  });

  return candidates[0].meta.variantId || candidates[0].meta.id;
}

/* ═══════════════════════════════════════════════════════════════════
 * clearCache() — force re-read on next access
 * ═══════════════════════════════════════════════════════════════════ */

export function clearCache() {
  _cache = null;
  _byCapability = {};
}

export default { loadAll, getWorkflow, listWorkflows, resolveVariant, clearCache };
