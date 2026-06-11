/* adapters/registry-instance.js — Shared workflow registry singleton
 *
 * DevList §9 — Phase G3.
 *
 * Holds the file-backed workflow registry loaded at startup so all routes
 * share the same cached index.
 */

import { loadWorkflows } from "./comfyui/workflow-loader.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);

/** Path to the workflows directory relative to the gateway root */
var DEFAULT_WORKFLOWS_DIR = join(__dirname, "..", "..", "workflows", "comfyui");

var registry = null;

/**
 * Initialise the workflow registry.  Must be called once at startup.
 * Safe to call multiple times — subsequent calls return the cached registry.
 */
export async function initRegistry(workflowsDir) {
  if (registry) return registry;

  var dir = workflowsDir || DEFAULT_WORKFLOWS_DIR;
  registry = await loadWorkflows(dir);
  return registry;
}

/**
 * Get the current registry.  Throws if not yet initialised.
 */
export function getRegistry() {
  if (!registry) {
    throw new Error(
      "Workflow registry not initialised. Call initRegistry() at startup."
    );
  }
  return registry;
}

/**
 * Re-initialise the registry (useful for hot-reload during development).
 */
export async function reloadRegistry(workflowsDir) {
  registry = null;
  return await initRegistry(workflowsDir);
}
