/* adapters/comfyui/workflow-loader.js — File-backed workflow registry
 *
 * DevList §9 — Phase G3: Workflow Registry And Metadata.
 *
 * Recursively scans the workflows directory for *.meta.json files, validates
 * each against the metadata schema, loads the matching *.api.json, and
 * indexes everything by public workflowId.
 *
 * Public API:
 *   await loadWorkflows(workflowsDir)  → registry
 *   registry.listWorkflows()           → array of public workflow summaries
 *   registry.getWorkflow(workflowId)   → { workflowId, variants[], best }
 *   registry.resolveVariant(wfId)      → best enabled variant with apiWorkflow
 *   registry.getAllWorkflowIds()       → string[]
 */

import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";

/* ═══════════════════════════════════════════════════════════════════════
 * Schema constants
 * ═══════════════════════════════════════════════════════════════════════ */

var REQUIRED_META_FIELDS = [
  "workflowId", "variantId", "title", "category", "provider", "apiWorkflowFile",
];

var VALID_CATEGORIES = ["composition", "portrait", "lighting", "effects", "quality"];

var VALID_PROVIDERS = ["comfyui"];

var VALID_SIZE_MODES = ["matchSelection", "allowResize", "allowAny"];

/* ═══════════════════════════════════════════════════════════════════════
 * Schema validation
 * ═══════════════════════════════════════════════════════════════════════ */

function validateMetaSchema(meta, filePath) {
  var errors = [];

  /* Required string fields */
  for (var i = 0; i < REQUIRED_META_FIELDS.length; i++) {
    var field = REQUIRED_META_FIELDS[i];
    if (typeof meta[field] !== "string" || !meta[field].trim()) {
      errors.push("Missing or empty field: " + field);
    }
  }

  /* category must be valid */
  if (meta.category && VALID_CATEGORIES.indexOf(meta.category) === -1) {
    errors.push(
      "Unknown category '" + meta.category +
      "'. Allowed: " + VALID_CATEGORIES.join(", ") + "."
    );
  }

  /* provider must be valid */
  if (meta.provider && VALID_PROVIDERS.indexOf(meta.provider) === -1) {
    errors.push("Unknown provider '" + meta.provider + "'.");
  }

  /* enabled */
  if (meta.enabled !== undefined && typeof meta.enabled !== "boolean") {
    errors.push("enabled must be a boolean.");
  }

  /* priority */
  if (meta.priority !== undefined && typeof meta.priority !== "number") {
    errors.push("priority must be a number.");
  }

  /* requiredModels */
  if (meta.requiredModels !== undefined) {
    if (!Array.isArray(meta.requiredModels)) {
      errors.push("requiredModels must be an array.");
    } else {
      for (var j = 0; j < meta.requiredModels.length; j++) {
        var m = meta.requiredModels[j];
        if (!m || typeof m.name !== "string" || !m.name.trim()) {
          errors.push("requiredModels[" + j + "] must have a 'name' string.");
        }
      }
    }
  }

  /* inputs */
  if (!meta.inputs || typeof meta.inputs !== "object") {
    errors.push("Missing inputs object.");
  } else {
    var inputKeys = Object.keys(meta.inputs);
    for (var k = 0; k < inputKeys.length; k++) {
      var inp = meta.inputs[inputKeys[k]];
      if (!inp || typeof inp.nodeId !== "string" || typeof inp.input !== "string") {
        errors.push(
          "inputs." + inputKeys[k] + " must have nodeId (string) and input (string)."
        );
      }
    }
  }

  /* outputs */
  if (!meta.outputs || typeof meta.outputs !== "object") {
    errors.push("Missing outputs object.");
  } else if (!meta.outputs.images || typeof meta.outputs.images.nodeId !== "string") {
    errors.push("outputs.images must have a nodeId (string).");
  }

  /* defaults */
  if (meta.defaults !== undefined && meta.defaults !== null) {
    if (typeof meta.defaults !== "object") {
      errors.push("defaults must be an object.");
    }
  }

  /* sizePolicy */
  if (meta.sizePolicy !== undefined && meta.sizePolicy !== null) {
    var sp = meta.sizePolicy;
    if (typeof sp !== "object") {
      errors.push("sizePolicy must be an object.");
    } else {
      if (sp.mode !== undefined && VALID_SIZE_MODES.indexOf(sp.mode) === -1) {
        errors.push(
          "sizePolicy.mode must be one of: " + VALID_SIZE_MODES.join(", ") + "."
        );
      }
      if (sp.allowResize !== undefined && typeof sp.allowResize !== "boolean") {
        errors.push("sizePolicy.allowResize must be a boolean.");
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      "Invalid metadata in " + filePath + ":\n  - " + errors.join("\n  - ")
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * Recursive *.meta.json discovery
 * ═══════════════════════════════════════════════════════════════════════ */

async function findMetaFiles(dir) {
  var results = [];

  async function walk(currentDir) {
    var entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch (_) {
      return; /* directory missing or unreadable */
    }

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".meta.json")) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

/* ═══════════════════════════════════════════════════════════════════════
 * Model validation (via /object_info fallback)
 * ═══════════════════════════════════════════════════════════════════════ */

export class MissingModelError extends Error {
  constructor(modelName, folder) {
    super(
      "Required model not available: " + modelName +
      (folder ? " (folder: " + folder + ")" : "")
    );
    this.name = "MissingModelError";
    this.modelName = modelName;
    this.folder = folder;
  }
}

/**
 * Validate that required model types are available via ComfyUI /object_info.
 *
 * This is a node-class-level check, not a file-level check (which needs the
 * /models endpoint).  It verifies that the necessary loader nodes exist for
 * each required model folder type.
 */
export async function validateModels(client, requiredModels) {
  if (!requiredModels || requiredModels.length === 0) {
    return { valid: true, missing: [] };
  }

  var objectInfo;
  try {
    objectInfo = await client.getObjectInfo();
  } catch (_) {
    /* Can't reach ComfyUI — adapter handles that separately */
    return { valid: true, missing: [], unverified: true };
  }

  /* Node class required per model folder */
  var FOLDER_LOADERS = {
    "checkpoints": "CheckpointLoaderSimple",
    "vae": "VAELoader",
    "text_encoder": "CLIPLoader",
    "text_encoders": "DualCLIPLoader",
    "diffusion_model": "UNETLoader",
    "diffusion_models": "UNETLoader",
    "lora": "LoraLoader",
    "loras": "LoraLoader",
    "upscale_model": "UpscaleModelLoader",
    "upscale_models": "UpscaleModelLoader",
    "controlnet": "ControlNetLoader",
  };

  var missing = [];

  for (var i = 0; i < requiredModels.length; i++) {
    var model = requiredModels[i];
    var folder = (model.folder || "").toLowerCase();
    var requiredLoader = FOLDER_LOADERS[folder];

    if (requiredLoader && !objectInfo[requiredLoader]) {
      missing.push({
        name: model.name,
        folder: model.folder,
        requiredLoader: requiredLoader,
      });
    }
  }

  if (missing.length > 0) {
    return { valid: false, missing: missing };
  }

  return { valid: true, missing: [] };
}

/* ═══════════════════════════════════════════════════════════════════════
 * Main loader: scan → parse → validate → index
 * ═══════════════════════════════════════════════════════════════════════ */

export async function loadWorkflows(workflowsDir) {
  var metaFiles = await findMetaFiles(workflowsDir);

  var allVariants = [];
  var warnings = [];

  for (var i = 0; i < metaFiles.length; i++) {
    var metaPath = metaFiles[i];
    var metaDir = dirname(metaPath);

    /* Parse metadata */
    var meta;
    try {
      var raw = await readFile(metaPath, "utf-8");
      meta = JSON.parse(raw);
      validateMetaSchema(meta, metaPath);
    } catch (err) {
      warnings.push("Skipping " + metaPath + ": " + err.message);
      continue;
    }

    var enabled = meta.enabled !== false;
    var priority = typeof meta.priority === "number" ? meta.priority : 50;

    /* Load API workflow */
    var apiPath = join(metaDir, meta.apiWorkflowFile);
    var apiWorkflow = null;
    var apiLoadError = null;

    if (enabled) {
      try {
        var apiRaw = await readFile(apiPath, "utf-8");
        apiWorkflow = JSON.parse(apiRaw);
      } catch (err) {
        apiLoadError = "Failed to load " + apiPath + ": " + err.message;
        warnings.push(apiLoadError);
      }
    }

    allVariants.push({
      workflowId: meta.workflowId,
      variantId: meta.variantId,
      title: meta.title,
      category: meta.category,
      provider: meta.provider,
      enabled: enabled,
      priority: priority,
      requiredModels: meta.requiredModels || [],
      inputs: meta.inputs,
      outputs: meta.outputs,
      defaults: meta.defaults || {},
      sizePolicy: meta.sizePolicy || { mode: "matchSelection", allowResize: false },
      apiWorkflow: apiWorkflow,
      apiWorkflowFile: meta.apiWorkflowFile,
      apiLoadError: apiLoadError,
      metaPath: metaPath,
      apiPath: apiPath,
    });
  }

  /* ── Index by workflowId ── */
  var byWorkflowId = {};

  for (var w = 0; w < allVariants.length; w++) {
    var variant = allVariants[w];
    var wfId = variant.workflowId;

    if (!byWorkflowId[wfId]) {
      byWorkflowId[wfId] = [];
    }
    byWorkflowId[wfId].push(variant);
  }

  /* Sort each group by priority descending */
  var workflowIds = Object.keys(byWorkflowId);
  for (var g = 0; g < workflowIds.length; g++) {
    byWorkflowId[workflowIds[g]].sort(function (a, b) {
      return b.priority - a.priority;
    });
  }

  /* ── Registry object ── */

  var registry = {
    warnings: warnings,
    allVariants: allVariants,

    /** Public workflow summaries for GET /workflows (no node IDs). */
    listWorkflows: function () {
      var summaries = [];
      for (var s = 0; s < workflowIds.length; s++) {
        var id = workflowIds[s];
        var best = registry.getBestVariant(id);
        var ref = best || byWorkflowId[id][0];

        summaries.push({
          id: id,
          title: ref ? ref.title : id,
          category: ref ? ref.category : "",
          description: ref ? ref.title : "",
          defaults: ref ? ref.defaults : {},
          variantCount: byWorkflowId[id].length,
          activeVariant: best ? best.variantId : null,
        });
      }

      summaries.sort(function (a, b) {
        if (a.category !== b.category) {
          return (a.category || "").localeCompare(b.category || "");
        }
        return a.id.localeCompare(b.id);
      });

      return summaries;
    },

    getAllWorkflowIds: function () {
      return workflowIds.slice();
    },

    getWorkflow: function (wfId) {
      var variants = byWorkflowId[wfId] || [];
      return {
        workflowId: wfId,
        variants: variants,
        best: registry.getBestVariant(wfId),
      };
    },

    getBestVariant: function (wfId) {
      var variants = byWorkflowId[wfId];
      if (!variants || variants.length === 0) return null;

      for (var b = 0; b < variants.length; b++) {
        if (variants[b].enabled && variants[b].apiWorkflow) {
          return variants[b];
        }
      }
      return null;
    },

    getVariant: function (wfId, varId) {
      var variants = byWorkflowId[wfId];
      if (!variants) return null;

      for (var t = 0; t < variants.length; t++) {
        if (variants[t].variantId === varId) {
          return variants[t];
        }
      }
      return null;
    },

    /**
     * Resolve a public workflowId to the best enabled, loadable variant.
     * Throws with descriptive error when no variant is available.
     */
    resolveVariant: function (wfId) {
      var workflow = registry.getWorkflow(wfId);

      if (workflow.variants.length === 0) {
        throw new Error(
          "WORKFLOW_NOT_FOUND: No workflow registered for '" + wfId + "'."
        );
      }

      if (!workflow.best) {
        var reasons = [];
        for (var r = 0; r < workflow.variants.length; r++) {
          var vr = workflow.variants[r];
          if (!vr.enabled) {
            reasons.push(vr.variantId + " is disabled");
          } else if (vr.apiLoadError) {
            reasons.push(vr.variantId + ": " + vr.apiLoadError);
          }
        }
        throw new Error(
          "WORKFLOW_UNAVAILABLE: No enabled variant with a valid API workflow for '" +
          wfId + "'. Reasons: " + reasons.join("; ") + "."
        );
      }

      return workflow.best;
    },
  };

  /* Log load summary */
  if (warnings.length > 0) {
    console.warn("[workflow-loader] " + warnings.length + " warning(s):");
    for (var wrn = 0; wrn < warnings.length; wrn++) {
      console.warn("  - " + warnings[wrn]);
    }
  }

  console.log(
    "[workflow-loader] Loaded " + allVariants.length +
    " variant(s) across " + workflowIds.length + " public workflow(s)."
  );

  return registry;
}
