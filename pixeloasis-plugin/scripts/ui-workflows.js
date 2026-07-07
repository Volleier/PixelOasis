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

window.PO.WORKFLOWS = {

  /* ═══ 构图工具 ═══ */

  "composition.remove.basic": {
    id: "composition.remove.basic",
    title: "移除",
    category: "composition",
    defaults: {
      prompt: "clean background, remove selected object, natural continuation, preserve surrounding texture and lighting",
      negativePrompt: "object remains, blurry, distorted, duplicate object, artifacts, bad texture",
      seed: -1,
      steps: 28,
      cfg: 6.5,
      denoise: 0.85,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },

  "composition.outpaint.basic": {
    id: "composition.outpaint.basic",
    title: "扩图",
    category: "composition",
    defaults: {
      prompt: "extend the scene naturally, consistent perspective, consistent lighting, seamless background continuation",
      negativePrompt: "hard edge, visible seam, distorted perspective, repeated pattern, artifacts",
      seed: -1,
      steps: 30,
      cfg: 7,
      denoise: 0.9,
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

  /* ═══ 画质提升 ═══ */

  "quality.upscale.basic": {
    id: "quality.upscale.basic",
    title: "超分放大",
    category: "quality",
    defaults: {
      prompt: "enhance detail, clean texture, sharp but natural, preserve original structure",
      negativePrompt: "over-sharpened, plastic skin, noisy, artifacts, changed identity, changed shape",
      seed: -1,
      steps: 18,
      cfg: 5,
      denoise: 0.25,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },

  "quality.realism-enhance.basic": {
    id: "quality.realism-enhance.basic",
    title: "真实感增强",
    category: "quality",
    defaults: {
      prompt: "make the selected area more photorealistic, natural lighting, realistic texture, preserve identity, preserve composition",
      negativePrompt: "overprocessed, plastic, waxy skin, distorted, changed face, changed object shape, artifacts",
      seed: -1,
      steps: 24,
      cfg: 5.5,
      denoise: 0.35,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },

  /* ═══ 后续扩展 ═══ */

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
};

/* ── Phase 1 visible workflow IDs (ImplList §8.1) ── */
window.PO.PHASE1_WORKFLOW_IDS = [
  "composition.inpaint.pro",
  "composition.remove.pro",
  "quality.realism.pro",
];

/* ── Backend-driven workflow loading (ImplList §8.1) ──
 *
 * On startup, tries to fetch /workflows from the gateway.
 * Backend data (title, defaults, inputPolicy) is merged into the
 * local WORKFLOWS registry.  Falls back to local definitions if
 * the gateway is unreachable. */

window.PO.loadWorkflowsFromBackend = async function () {
  try {
    var data = await window.PO.GatewayClient.getWorkflows();
    if (!data) {
      window.PO.Logger.info("workflows.backend_empty", {
        component: "workflows",
        data: { reason: "no data from gateway, using local fallback" },
      });
      return;
    }

    var merged = 0;
    for (var i = 0; i < data.length; i++) {
      var wf = data[i];
      var id = wf.id;

      /* Only care about Phase 1 pro workflows for the primary UI */
      if (window.PO.PHASE1_WORKFLOW_IDS.indexOf(id) === -1) continue;

      if (window.PO.WORKFLOWS[id]) {
        /* Merge backend defaults into existing local entry */
        if (wf.defaults && typeof wf.defaults === "object") {
          var existing = window.PO.WORKFLOWS[id].defaults || {};
          var keys = Object.keys(wf.defaults);
          for (var k = 0; k < keys.length; k++) {
            existing[keys[k]] = wf.defaults[keys[k]];
          }
          window.PO.WORKFLOWS[id].defaults = existing;
        }
        if (wf.title) window.PO.WORKFLOWS[id].title = wf.title;
        if (wf.category) window.PO.WORKFLOWS[id].category = wf.category;
        if (wf.inputPolicy) window.PO.WORKFLOWS[id].inputPolicy = wf.inputPolicy;
        if (wf.sizePolicyMode) window.PO.WORKFLOWS[id].sizePolicyMode = wf.sizePolicyMode;
        merged++;
      } else {
        /* Create new entry from backend data */
        window.PO.WORKFLOWS[id] = {
          id: id,
          title: wf.title || id,
          category: wf.category || "",
          defaults: wf.defaults || {},
          inputPolicy: wf.inputPolicy || null,
          sizePolicyMode: wf.sizePolicyMode || null,
          _fromBackend: true,
        };
        merged++;
      }
    }

    window.PO.Logger.info("workflows.backend_loaded", {
      component: "workflows",
      data: { total: data.length, merged: merged },
    });
  } catch (e) {
    window.PO.Logger.warn("workflows.backend_failed", {
      component: "workflows",
      data: { reason: e.message || String(e) },
    });
  }
};
