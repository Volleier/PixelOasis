/* routes/workflows.js — GET /workflows
 *
 * Returns the workflow registry as JSON so the plugin can discover
 * available workflows without hard-coding them.
 */

import { writeJson } from "../utils/errors.js";

/* Minimal in-memory registry for G0 — will move to file-based loader in G3 */
const WORKFLOWS = [
  {
    id: "composition.inpaint.basic",
    title: "FLUX.1 Kontext Dev Inpaint Basic",
    category: "composition",
    description: "局部修复 — 选中区域内容感知填充",
    defaults: {
      steps: 28,
      cfg: 7,
      denoise: 0.75,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },
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
  {
    id: "quality.upscale.basic",
    title: "画质放大",
    category: "quality",
    description: "选中区域超分辨率放大",
    defaults: {
      steps: 20,
      cfg: 7,
      denoise: 0.3,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },
];

export function handleWorkflows(request, response) {
  writeJson(response, 200, { workflows: WORKFLOWS });
}
