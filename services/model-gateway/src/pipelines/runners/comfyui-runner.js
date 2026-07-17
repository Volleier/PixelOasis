/* pipelines/runners/comfyui-runner.js — ComfyUI execution as pipeline stage
 *
 * Stage 5: wraps prompt-runner for use within pipeline orchestrator.
 */

import { getWorkflow } from "../../adapters/comfyui/workflow-repository.js";
import { run as runPrompt } from "../../adapters/comfyui/prompt-runner.js";
import logger from "../../utils/logger.js";
import * as jobRepo from "../../jobs/job-repository.js";

export async function runComfyUIStage(ctx, config) {
  const { jobId, inputs } = ctx;
  const workflowId = config.workflow;
  const job = jobRepo.getById(jobId);

  logger.info("comfyui_runner.executing", {
    component: "comfyui-runner",
    traceId: job?.traceId,
    jobId,
    workflowId,
    data: { workflow: workflowId },
  });

  const wf = getWorkflow(workflowId);
  if (!wf) throw new Error("Workflow not found: " + workflowId);

  /* Workflow repository caches templates. Each job must patch a clone so
     parameters and uploaded assets cannot leak into later jobs. */
  let apiWorkflow = structuredClone(wf.apiJson);

  if (config.inputBinding) {
    const bind = await import("../../adapters/comfyui/binding-engine.js");
    apiWorkflow = bind.bind(apiWorkflow, inputs, config.parameters || {}, config.inputBinding);
  }

  const outputs = await runPrompt(apiWorkflow, wf.meta, inputs, inputs.params || config.parameters || {}, {
    jobId,
    clientId: jobId,
    traceId: job?.traceId,
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
