/* pipelines/runners/comfyui-runner.js — ComfyUI execution as pipeline stage
 *
 * Stage 5: wraps prompt-runner for use within pipeline orchestrator.
 */

import { getWorkflow } from "../../adapters/comfyui/workflow-repository.js";
import { run as runPrompt } from "../../adapters/comfyui/prompt-runner.js";
import logger from "../../utils/logger.js";

export async function runComfyUIStage(ctx, config) {
  const { jobId, inputs } = ctx;
  const workflowId = config.workflow;

  logger.info("comfyui_runner.executing", { component: "comfyui-runner", data: { jobId, workflow: workflowId } });

  const wf = getWorkflow(workflowId);
  if (!wf) throw new Error("Workflow not found: " + workflowId);

  if (config.inputBinding) {
    const bind = await import("../../adapters/comfyui/binding-engine.js");
    const patched = bind.bind(wf.apiJson, inputs, config.parameters || {}, config.inputBinding);
    wf.apiJson = patched;
  }

  const outputs = await runPrompt(wf.apiJson, wf.meta, inputs, config.parameters || {}, {
    jobId,
    clientId: jobId,
    timeoutMs: config.timeoutMs || 600000,
  });

  /* Return output buffers and metadata */
  const resultOutputs = {};
  for (const o of outputs) {
    resultOutputs[o.role + "Buffer"] = o.imageBuffer;
    resultOutputs[o.role + "Width"] = o.width;
    resultOutputs[o.role + "Height"] = o.height;
  }

  return { stage: "comfyui:" + workflowId, outputs: resultOutputs, metrics: { outputCount: outputs.length } };
}

export default { runComfyUIStage };
