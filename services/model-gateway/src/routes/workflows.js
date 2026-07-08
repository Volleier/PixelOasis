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
  /* Phase 1 pro workflows — primary Phase 1 buttons */
  { id: "composition.inpaint.pro", title: "局部修复", category: "composition", description: "局部修复 Pro — 修复选区内瑕疵、破损", defaults: { prompt: "", negativePrompt: "", seed: -1, steps: 28, cfg: 7, denoise: 0.75, sampler: "euler", scheduler: "karras" }, stage: 1, inputPolicy: { source: "selection", mask: "required" }, sizePolicyMode: "selectionExact", placementPolicyType: "smartObjectMaskedExact" },
  { id: "composition.remove.local", title: "局部移除", category: "composition", description: "局部移除 — 移除选区内小面积瑕疵、斑点、异物，自然融合周围纹理", defaults: { prompt: "remove small defect, clean repair, seamless blend with surrounding texture and color", negativePrompt: "blurry patch, visible seam, repeated pattern, discoloration, artificial texture", seed: -1, steps: 24, cfg: 6, denoise: 0.7, sampler: "dpmpp_2m", scheduler: "karras" }, stage: 1, inputPolicy: { source: "selection", mask: "required" }, sizePolicyMode: "expandThenCrop", placementPolicyType: "smartObjectMaskedExact" },
  { id: "composition.remove.pro", title: "移除物体", category: "composition", description: "移除物体 Pro — 删除选区内物体，背景自然补全", defaults: { prompt: "clean background, remove selected object, natural continuation, preserve surrounding texture and lighting", negativePrompt: "object remains, blurry, distorted, duplicate object, artifacts, bad texture", seed: -1, steps: 28, cfg: 6.5, denoise: 0.85, sampler: "euler", scheduler: "karras" }, stage: 1, inputPolicy: { source: "selection", mask: "required" }, sizePolicyMode: "expandThenCrop", placementPolicyType: "smartObjectMaskedExact" },
  { id: "quality.realism.pro", title: "真实感增强", category: "quality", description: "真实感增强 Pro — 提升选区真实感、材质细节、光影层次", defaults: { prompt: "photorealistic, high detail, natural skin texture, soft cinematic lighting, sharp focus, 8k", negativePrompt: "cartoon, painting, plastic skin, over-saturated, distorted face, changed identity, different person, body horror", seed: -1, steps: 24, cfg: 4.5, denoise: 0.35, sampler: "dpmpp_2m", scheduler: "karras" }, stage: 1, inputPolicy: { source: "selection", mask: "optional" }, sizePolicyMode: "selectionExact", placementPolicyType: "smartObjectMaskedExact" },
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
