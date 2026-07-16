/* validator.js — Validate capability files against expected structure */

import logger from "../utils/logger.js";

const VALID_SECTIONS = [
  "sceneEffects", "combatEffects", "studioComposite",
  "portrait", "hair", "lightingCleanup",
];

const VALID_SOURCES = ["document", "selection"];
const VALID_MASK_MODES = ["none", "optional", "required"];
const VALID_POINTS_MODES = ["none", "optional", "two"];

export function validate(cap) {
  const errors = [];

  if (!cap || typeof cap !== "object") {
    return { valid: false, errors: ["Not a valid object"] };
  }

  /* schemaVersion */
  if (cap.schemaVersion !== "2.0") {
    errors.push("schemaVersion must be '2.0', got: " + cap.schemaVersion);
  }

  /* id */
  if (!cap.id || typeof cap.id !== "string" || cap.id.length === 0) {
    errors.push("Missing or invalid id");
  } else if (!/^[a-z]+\.[a-zA-Z0-9]+$/.test(cap.id)) {
    errors.push("Invalid id format: " + cap.id + " (expected: category.name)");
  }

  /* section */
  if (!cap.section || VALID_SECTIONS.indexOf(cap.section) === -1) {
    errors.push("Unknown or missing section: " + cap.section + ". Valid: " + VALID_SECTIONS.join(", "));
  }

  /* title */
  if (!cap.title || (!cap.title["zh-CN"] && typeof cap.title !== "string")) {
    errors.push("Missing title (need at least zh-CN)");
  }

  /* input contract */
  if (cap.input) {
    if (cap.input.source && VALID_SOURCES.indexOf(cap.input.source) === -1) {
      errors.push("Invalid input.source: " + cap.input.source);
    }
    if (cap.input.mask && VALID_MASK_MODES.indexOf(cap.input.mask) === -1) {
      errors.push("Invalid input.mask: " + cap.input.mask);
    }
    if (cap.input.points && VALID_POINTS_MODES.indexOf(cap.input.points) === -1) {
      errors.push("Invalid input.points: " + cap.input.points);
    }
  }

  /* enabled */
  if (cap.enabled !== undefined && typeof cap.enabled !== "boolean") {
    errors.push("enabled must be boolean");
  }

  /* ui */
  if (cap.ui && cap.ui.requiresConfirm !== undefined && typeof cap.ui.requiresConfirm !== "boolean") {
    errors.push("ui.requiresConfirm must be boolean");
  }

  if (errors.length > 0) {
    logger.warn("capabilities.validation_errors", {
      component: "capability-validator",
      data: { id: cap.id, errors },
    });
  }

  return { valid: errors.length === 0, errors };
}

export function validateAll(capabilities) {
  const results = [];
  for (const cap of capabilities) {
    const result = validate(cap);
    if (!result.valid) {
      results.push({ id: cap.id, errors: result.errors });
    }
  }
  return results;
}

export default { validate, validateAll };
