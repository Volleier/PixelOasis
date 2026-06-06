/* routes/workflows.js — GET /workflows */

import { writeJson } from "../utils/errors.js";

var WORKFLOWS = [

  /* ═══ 构图工具 ═══ */

  {
    id: "composition.remove.basic",
    title: "移除",
    category: "composition",
    description: "框选不想要的物体，自动移除并补全背景 — SDXL Inpaint",
    defaults: {
      steps: 28,
      cfg: 6.5,
      denoise: 0.85,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },
  {
    id: "composition.outpaint.basic",
    title: "扩图",
    category: "composition",
    description: "框选画面边缘或空白区域，AI 补全画布内容",
    defaults: {
      steps: 30,
      cfg: 7,
      denoise: 0.9,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },
  {
    id: "composition.inpaint.basic",
    title: "局部修复",
    category: "composition",
    description: "选中区域内容感知填充 — FLUX.1 Kontext Dev",
    defaults: {
      steps: 28,
      cfg: 7,
      denoise: 0.75,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },

  /* ═══ 画质提升 ═══ */

  {
    id: "quality.upscale.basic",
    title: "超分放大",
    category: "quality",
    description: "提升选区清晰度、细节和分辨率 — Upscale Model + 低 denoise img2img",
    defaults: {
      steps: 18,
      cfg: 5,
      denoise: 0.25,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },
  {
    id: "quality.realism-enhance.basic",
    title: "真实感增强",
    category: "quality",
    description: "让局部更自然、更真实，减少 AI 感 — FLUX.1 Kontext Dev",
    defaults: {
      steps: 24,
      cfg: 5.5,
      denoise: 0.35,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },

  /* ═══ 后续扩展 ═══ */

  {
    id: "portrait.skin-retouch.basic",
    title: "皮肤精修",
    category: "portrait",
    description: "人像皮肤清理与细节恢复",
    defaults: {
      steps: 28,
      cfg: 7,
      denoise: 0.75,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },
  {
    id: "lighting.relight.basic",
    title: "光影调整",
    category: "lighting",
    description: "局部光线重新分布",
    defaults: {
      steps: 20,
      cfg: 7,
      denoise: 0.6,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },
  {
    id: "effects.style-transfer.basic",
    title: "风格迁移",
    category: "effects",
    description: "视觉风格效果迁移",
    defaults: {
      steps: 30,
      cfg: 7,
      denoise: 0.8,
      sampler: "euler",
      scheduler: "normal",
    },
  },
];

export function handleWorkflows(request, response) {
  writeJson(response, 200, { workflows: WORKFLOWS });
}
