/* binding-engine.js — Parameter injection into ComfyUI workflow JSON
 *
 * Extracted from existing workflow-bindings.js. Supports:
 *   image, mask, number, enum, text, seed, latent bindings.
 *   Validates all bindings target existing nodes/fields.
 */

import logger from "../../utils/logger.js";

/* ═══════════════════════════════════════════════════════════════════
 * bind(workflowApiJson, inputs, parameters, bindings)
 *
 * workflowApiJson: parsed ComfyUI API workflow JSON
 * inputs:         { sourceFilename, maskFilename, ... }
 * parameters:     { intensity: 0.5, seed: 1234, ... }
 * bindings:       [{ nodeId, field, type, source }] from variant metadata
 * ═══════════════════════════════════════════════════════════════════ */

export function bind(workflowApiJson, inputs = {}, parameters = {}, bindings = []) {
  /* Deep clone */
  const patched = JSON.parse(JSON.stringify(workflowApiJson));

  for (const binding of bindings) {
    _applyBinding(patched, binding, inputs, parameters);
  }

  return patched;
}

function _applyBinding(workflow, binding, inputs, parameters) {
  const { nodeId, field, type, source } = binding;
  if (!nodeId) {
    logger.warn("binding.no_node_id", { component: "binding-engine", data: { binding } });
    return;
  }

  /* Find the node */
  const node = workflow[nodeId];
  if (!node) {
    throw new BindingError("Node not found: " + nodeId, { nodeId, field, type });
  }

  /* Find the field in node inputs */
  if (!node.inputs) {
    throw new BindingError("Node has no inputs: " + nodeId, { nodeId });
  }

  const inputField = node.inputs[field];
  if (inputField === undefined) {
    throw new BindingError("Field not found: " + nodeId + "." + field, { nodeId, field });
  }

  /* Apply value based on type */
  switch (type) {
    case "image":
    case "mask": {
      const filename = inputs[source] || source;
      if (!filename) throw new BindingError("Missing image/mask input for " + field, { nodeId, field, source });
      node.inputs[field] = filename;
      break;
    }
    case "number":
    case "integer": {
      const val = _resolveValue(source, parameters, binding.default);
      if (val !== undefined && val !== null) {
        node.inputs[field] = type === "integer" ? Math.round(Number(val)) : Number(val);
      }
      break;
    }
    case "string":
    case "text": {
      const val = _resolveValue(source, parameters, binding.default);
      if (val !== undefined && val !== null) {
        node.inputs[field] = String(val);
      }
      break;
    }
    case "enum": {
      const val = _resolveValue(source, parameters, binding.default);
      if (val !== undefined && val !== null) {
        node.inputs[field] = val; /* Enum values passed as-is */
      }
      break;
    }
    case "seed": {
      const val = _resolveValue(source, parameters, binding.default);
      if (val !== undefined && val !== null) {
        const seed = Number(val);
        node.inputs[field] = seed === -1 ? Math.floor(Math.random() * 0x7FFFFFFF) : seed;
      }
      break;
    }
    case "boolean": {
      const val = _resolveValue(source, parameters, binding.default);
      if (val !== undefined && val !== null) {
        node.inputs[field] = Boolean(val);
      }
      break;
    }
    case "latent": {
      /* Latent bindings typically reference other nodes — skip */
      break;
    }
    default:
      logger.warn("binding.unknown_type", {
        component: "binding-engine",
        data: { type, nodeId, field },
      });
  }
}

/* ── Resolve value from parameters by dot-path source ── */
function _resolveValue(source, parameters, defaultValue) {
  if (source === undefined || source === null) return defaultValue;
  if (typeof source === "number" || typeof source === "boolean") return source;

  /* Dot-path lookup: "intensity" or "params.intensity" */
  if (typeof source === "string" && source.indexOf(".") !== -1) {
    const parts = source.split(".");
    let val = parameters;
    for (const part of parts) {
      if (val && typeof val === "object") val = val[part];
      else return defaultValue;
    }
    return val !== undefined ? val : defaultValue;
  }

  /* Direct key lookup */
  if (typeof source === "string" && parameters && parameters[source] !== undefined) {
    return parameters[source];
  }

  return defaultValue;
}

/* ── Validate bindings ── */
export function validateBindings(workflow, bindings) {
  const errors = [];
  for (const b of bindings) {
    if (!workflow[b.nodeId]) {
      errors.push("Node not found: " + b.nodeId);
      continue;
    }
    const node = workflow[b.nodeId];
    if (!node.inputs || node.inputs[b.field] === undefined) {
      errors.push("Field not found: " + b.nodeId + "." + b.field);
    }
  }
  return errors;
}

export class BindingError extends Error {
  constructor(message, details) { super(message); this.name = "BindingError"; this.details = details; }
}

export default { bind, validateBindings, BindingError };
