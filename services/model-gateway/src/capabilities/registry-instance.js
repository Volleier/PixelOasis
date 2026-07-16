/* registry-instance.js — Singleton capability registry
 *
 * Loads capabilities from disk, validates, and computes readiness.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAll } from "./loader.js";
import { validateAll } from "./validator.js";
import { computeAll } from "./readiness.js";
import logger from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CAP_DIR = resolve(__dirname, "..", "..", "capabilities");

let _registry = null; /* { capabilities, byId, revision, errors } */

export async function initCapabilityRegistry(capDir) {
  if (_registry) return _registry;

  const dir = capDir || DEFAULT_CAP_DIR;

  logger.info("capability_registry.init", { component: "capability-registry", data: { dir } });

  /* Load + validate */
  const { capabilities, byId, errors, revision } = loadAll(dir);

  /* Validate */
  const validationErrors = validateAll(capabilities);
  if (validationErrors.length > 0) {
    logger.warn("capability_registry.validation_warnings", {
      component: "capability-registry",
      data: { errors: validationErrors },
    });
  }

  /* Compute readiness */
  let enriched;
  try {
    enriched = await computeAll(capabilities);
  } catch (e) {
    logger.warn("capability_registry.readiness_failed", {
      component: "capability-registry",
      error: e,
    });
    enriched = capabilities.map(c => ({ ...c, availability: { state: "ready", profile: "quality_16gb" } }));
  }

  _registry = {
    capabilities: enriched,
    byId: {},
    revision,
    loadErrors: errors,
    validationErrors,
  };

  /* Index by id */
  for (const cap of enriched) {
    _registry.byId[cap.id] = cap;
  }

  logger.info("capability_registry.ready", {
    component: "capability-registry",
    data: { count: enriched.length, revision },
  });

  return _registry;
}

export function getCapabilityRegistry() {
  return _registry;
}

export function getCapabilities() {
  if (!_registry) return [];
  return _registry.capabilities;
}

export function getCapability(id) {
  if (!_registry) return null;
  return _registry.byId[id] || null;
}

export async function refreshRegistry() {
  _registry = null;
  return initCapabilityRegistry();
}

export default { initCapabilityRegistry, getCapabilityRegistry, getCapabilities, getCapability, refreshRegistry };
