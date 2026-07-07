/* routes/workflows.js — GET /workflows
 *
 * ImplList §8.1 — Returns full workflow summaries including policy fields
 * so the plugin can render buttons and configure parameters correctly.
 *
 * Uses the file-backed workflow registry when available, with a hardcoded
 * fallback for when the registry fails to load. */

import { writeJson } from "../utils/errors.js";
import { getRegistry } from "../adapters/registry-instance.js";

/* Hardcoded fallback — used when the file-backed registry is unavailable. */
var FALLBACK_WORKFLOWS = [
  { id: "composition.inpaint.basic", title: "局部修复", category: "composition", defaults: { steps: 28, cfg: 7, denoise: 0.75, sampler: "euler", scheduler: "karras" }, stage: 0, inputPolicy: null, sizePolicyMode: null, placementPolicyType: null },
  { id: "composition.remove.basic", title: "移除", category: "composition", defaults: { steps: 28, cfg: 6.5, denoise: 0.85, sampler: "euler", scheduler: "karras" }, stage: 0, inputPolicy: null, sizePolicyMode: null, placementPolicyType: null },
  { id: "quality.upscale.basic", title: "超分放大", category: "quality", defaults: { steps: 18, cfg: 5, denoise: 0.25, sampler: "dpmpp_2m", scheduler: "karras" }, stage: 0, inputPolicy: null, sizePolicyMode: null, placementPolicyType: null },
  { id: "quality.realism-enhance.basic", title: "真实感增强", category: "quality", defaults: { steps: 24, cfg: 5.5, denoise: 0.35, sampler: "dpmpp_2m", scheduler: "karras" }, stage: 0, inputPolicy: null, sizePolicyMode: null, placementPolicyType: null },
];

export function handleWorkflows(_request, response, _params) {
  var workflows;

  try {
    var registry = getRegistry();
    var summaries = registry.listWorkflows();

    /* Pass through file-backed summaries with full policy fields */
    workflows = summaries.map(function (s) {
      return {
        id: s.id,
        title: s.title,
        category: s.category,
        description: s.title,
        stage: s.stage !== undefined ? s.stage : 0,
        defaults: s.defaults || {},
        inputPolicy: s.inputPolicy || null,
        sizePolicyMode: s.sizePolicyMode || null,
        placementPolicyType: s.placementPolicyType || null,
        variantCount: s.variantCount || 1,
        activeVariant: s.activeVariant || null,
      };
    });

    /* Merge in fallback entries that have no file-backed equivalent */
    var fileIds = {};
    for (var i = 0; i < workflows.length; i++) {
      fileIds[workflows[i].id] = true;
    }
    for (var j = 0; j < FALLBACK_WORKFLOWS.length; j++) {
      if (!fileIds[FALLBACK_WORKFLOWS[j].id]) {
        workflows.push(FALLBACK_WORKFLOWS[j]);
      }
    }
  } catch (_) {
    /* Registry not initialised — use hardcoded fallback */
    workflows = FALLBACK_WORKFLOWS.map(function (w) {
      return {
        id: w.id,
        title: w.title,
        category: w.category,
        description: w.title,
        stage: w.stage || 0,
        defaults: w.defaults || {},
        inputPolicy: w.inputPolicy || null,
        sizePolicyMode: w.sizePolicyMode || null,
        placementPolicyType: w.placementPolicyType || null,
        variantCount: 1,
        activeVariant: null,
      };
    });
  }

  writeJson(response, 200, { workflows: workflows });
}
