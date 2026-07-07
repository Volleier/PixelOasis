#!/usr/bin/env node
/* tools/verify-env.mjs — Environment validation script
 *
 * ImplList §10.4 — Checks that all required paths and tools are configured.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, PROJECT_ROOT } from "./lib/config.mjs";

console.log("PixelOasis Environment Check\n");

const config = loadConfig();
let allOk = true;

function check(label, ok, detail) {
  const mark = ok ? "OK" : "FAIL";
  console.log("  [" + mark + "] " + label + (detail ? ": " + detail : ""));
  if (!ok) allOk = false;
}

/* ── config.yaml ── */
check("config.yaml exists", true, resolve(PROJECT_ROOT, "config.yaml"));

/* ── Node.js ── */
const nodeVersion = process.version;
const major = parseInt(nodeVersion.replace("v", "").split(".")[0], 10);
check("Node.js >= 18", major >= 18, nodeVersion);

/* P2-2: Placeholder detection */
function isPlaceholder(p) {
  if (!p || typeof p !== "string" || p.trim().length === 0) return true;
  return /Your[\/\\]Path[\/\\]To/i.test(p.trim());
}

/* ── Photoshop plugin path ── */
const psPath = config.photoshop?.plugin_path || "";
check("photoshop.plugin_path configured",
  psPath.length > 0 && !isPlaceholder(psPath),
  isPlaceholder(psPath) ? "placeholder detected — update config.yaml" : (psPath || "not set"));
if (psPath) {
  check("  plugin directory exists", existsSync(psPath), psPath);
}

/* ── ComfyUI ── */
const comfyRoot = config.comfyui?.root || "";
check("comfyui.root configured",
  comfyRoot.length > 0 && !isPlaceholder(comfyRoot),
  isPlaceholder(comfyRoot) ? "placeholder detected — update config.yaml" : (comfyRoot || "not set"));
if (comfyRoot) {
  check("  ComfyUI root exists", existsSync(comfyRoot), comfyRoot);
}

const comfyModels = config.comfyui?.models_dir || "";
if (comfyModels) {
  check("comfyui.models_dir", existsSync(comfyModels),
    comfyModels + (existsSync(comfyModels) ? "" : " — not found"));
}

/* ── ComfyUI URL reachable ── */
const comfyUrl = config.comfyui?.url || "http://127.0.0.1:8000";
try {
  const resp = await fetch(comfyUrl + "/system_stats", { signal: AbortSignal.timeout(5000) });
  check("ComfyUI reachable at " + comfyUrl, resp.ok,
    resp.ok ? "responding" : "HTTP " + resp.status);
} catch (_) {
  check("ComfyUI reachable at " + comfyUrl, false,
    "unreachable — start ComfyUI Desktop first");
}

/* ── Gateway dependencies ── */
const gatewayNodeModules = resolve(PROJECT_ROOT, "services", "model-gateway", "node_modules");
check("model-gateway dependencies installed", existsSync(gatewayNodeModules),
  gatewayNodeModules);

/* ── Summary ── */
console.log("");
if (allOk) {
  console.log("All checks passed.");
} else {
  console.log("Some checks failed. Fix the issues above and re-run.");
  process.exit(1);
}
