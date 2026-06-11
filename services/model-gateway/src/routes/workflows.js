/* routes/workflows.js — GET /workflows
 *
 * DevList §9 — Phase G3: Workflow Registry And Metadata.
 *
 * Returns the public PixelOasis workflow catalogue.
 * Uses the file-backed workflow registry when available, with a hardcoded
 * fallback for when the registry fails to load. */

import { writeJson } from "../utils/errors.js";
import { getRegistry } from "../adapters/registry-instance.js";

/* Hardcoded fallback — used when the file-backed registry is unavailable.
 * Must stay in sync with KNOWN_WORKFLOWS in validation/generate-request.js. */
var FALLBACK_WORKFLOWS = [
  { id: "composition.remove.basic", title: "移除", category: "composition", defaults: { steps: 28, cfg: 6.5, denoise: 0.85, sampler: "dpmpp_2m", scheduler: "karras" } },
  { id: "composition.outpaint.basic", title: "扩图", category: "composition", defaults: { steps: 30, cfg: 7, denoise: 0.9, sampler: "dpmpp_2m", scheduler: "karras" } },
  { id: "composition.inpaint.basic", title: "局部修复", category: "composition", defaults: { steps: 28, cfg: 7, denoise: 0.75, sampler: "dpmpp_2m", scheduler: "karras" } },
  { id: "quality.upscale.basic", title: "超分放大", category: "quality", defaults: { steps: 18, cfg: 5, denoise: 0.25, sampler: "dpmpp_2m", scheduler: "karras" } },
  { id: "quality.realism-enhance.basic", title: "真实感增强", category: "quality", defaults: { steps: 24, cfg: 5.5, denoise: 0.35, sampler: "dpmpp_2m", scheduler: "karras" } },
  { id: "quality.denoise.basic", title: "去噪", category: "quality", defaults: { steps: 15, cfg: 5, denoise: 0.3, sampler: "dpmpp_2m", scheduler: "karras" } },
  { id: "portrait.skin-retouch.basic", title: "皮肤精修", category: "portrait", defaults: { steps: 28, cfg: 7, denoise: 0.75, sampler: "dpmpp_2m", scheduler: "karras" } },
  { id: "portrait.face-restore.basic", title: "面部修复", category: "portrait", defaults: { steps: 28, cfg: 7, denoise: 0.65, sampler: "dpmpp_2m", scheduler: "karras" } },
  { id: "lighting.relight.basic", title: "光影调整", category: "lighting", defaults: { steps: 20, cfg: 7, denoise: 0.6, sampler: "dpmpp_2m", scheduler: "karras" } },
  { id: "lighting.color-grade.basic", title: "色调调整", category: "lighting", defaults: { steps: 22, cfg: 6.5, denoise: 0.55, sampler: "dpmpp_2m", scheduler: "karras" } },
  { id: "effects.style-transfer.basic", title: "风格迁移", category: "effects", defaults: { steps: 30, cfg: 7, denoise: 0.8, sampler: "euler", scheduler: "normal" } },
  { id: "effects.background-effect.basic", title: "背景特效", category: "effects", defaults: { steps: 28, cfg: 7, denoise: 0.75, sampler: "dpmpp_2m", scheduler: "karras" } },
];

export function handleWorkflows(request, response, _params) {
  var workflows;

  try {
    var registry = getRegistry();
    var summaries = registry.listWorkflows();

    /* Build a map from file-backed summaries */
    var fileBackedMap = {};
    for (var i = 0; i < summaries.length; i++) {
      fileBackedMap[summaries[i].id] = summaries[i];
    }

    /* Start with all fallback entries, overwriting with file-backed data
     * when the same workflowId exists in both sources. */
    workflows = FALLBACK_WORKFLOWS.map(function (fb) {
      var fbFile = fileBackedMap[fb.id];
      return {
        id: fb.id,
        title: fbFile ? fbFile.title : fb.title,
        category: fbFile ? fbFile.category : fb.category,
        description: fb.title,
        defaults: fbFile ? fbFile.defaults : fb.defaults,
      };
    });

    /* Add file-backed workflows that are NOT in the fallback list */
    var fallbackIds = FALLBACK_WORKFLOWS.map(function (w) { return w.id; });
    for (var j = 0; j < summaries.length; j++) {
      if (fallbackIds.indexOf(summaries[j].id) === -1) {
        workflows.push({
          id: summaries[j].id,
          title: summaries[j].title,
          category: summaries[j].category,
          description: summaries[j].title,
          defaults: summaries[j].defaults,
        });
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
        defaults: w.defaults,
      };
    });
  }

  writeJson(response, 200, { workflows: workflows });
}
