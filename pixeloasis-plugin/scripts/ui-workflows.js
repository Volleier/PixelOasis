window.PO = window.PO || {};

/* ── Sampler / scheduler option sets ── */

window.PO.SAMPLER_OPTIONS = [
  "dpmpp_2m",
  "euler",
  "euler_ancestral",
  "ddim",
  "uni_pc",
];

window.PO.SCHEDULER_OPTIONS = [
  "karras",
  "normal",
  "simple",
  "ddim_uniform",
  "sg_uniform",
];

/* ── Workflow registry ──
 *
 * Each workflow declares its id, display title, category, and default
 * parameter values.  The parameter page reads these defaults on first open
 * and persists user edits per workflowId in window.PO.workflowParams.
 */

window.PO.ENTRY_WORKFLOWS = {
  /* tool-btn → parameter set A */
  "entry.tool-select": {
    id: "entry.tool-select",
    title: "工具选择",
    category: "composition",
    defaults: {
      prompt: "",
      negativePrompt: "",
      seed: -1,
      steps: 28,
      cfg: 7,
      denoise: 0.75,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },
  /* capture-btn → parameter set B */
  "entry.capture": {
    id: "entry.capture",
    title: "选区生成",
    category: "composition",
    defaults: {
      prompt: "",
      negativePrompt: "",
      seed: -1,
      steps: 28,
      cfg: 7,
      denoise: 0.75,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },
};

window.PO.WORKFLOWS = {
  "portrait.skin-retouch.basic": {
    id: "portrait.skin-retouch.basic",
    title: "皮肤精修",
    category: "portrait",
    defaults: {
      prompt: "",
      negativePrompt: "",
      seed: -1,
      steps: 28,
      cfg: 7,
      denoise: 0.75,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },
  "composition.inpaint.basic": {
    id: "composition.inpaint.basic",
    title: "局部修复",
    category: "composition",
    defaults: {
      prompt: "",
      negativePrompt: "",
      seed: -1,
      steps: 28,
      cfg: 7,
      denoise: 0.75,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },
  "lighting.relight.basic": {
    id: "lighting.relight.basic",
    title: "光影调整",
    category: "lighting",
    defaults: {
      prompt: "",
      negativePrompt: "",
      seed: -1,
      steps: 20,
      cfg: 7,
      denoise: 0.6,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },
  "effects.style-transfer.basic": {
    id: "effects.style-transfer.basic",
    title: "风格迁移",
    category: "effects",
    defaults: {
      prompt: "",
      negativePrompt: "",
      seed: -1,
      steps: 30,
      cfg: 7,
      denoise: 0.8,
      sampler: "euler",
      scheduler: "normal",
    },
  },
  "quality.upscale.basic": {
    id: "quality.upscale.basic",
    title: "画质放大",
    category: "quality",
    defaults: {
      prompt: "",
      negativePrompt: "",
      seed: -1,
      steps: 20,
      cfg: 7,
      denoise: 0.3,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },
};

/* Map category id → first workflow (for section buttons) */
window.PO.CATEGORY_WORKFLOW = {
  portrait: "portrait.skin-retouch.basic",
  composition: "composition.inpaint.basic",
  lighting: "lighting.relight.basic",
  fx: "effects.style-transfer.basic",
  quality: "quality.upscale.basic",
};
