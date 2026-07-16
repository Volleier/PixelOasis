/* pipelines/orchestrator.js — Pipeline execution orchestrator
 *
 * Stage 5: runs pipeline stages sequentially, supports stage-level
 * retry, quality gates, and progress reporting.
 */

import { getPipeline } from "./registry.js";
import { runImageStage } from "./runners/image-runner.js";
import { runComfyUIStage } from "./runners/comfyui-runner.js";
import { runQualityGate } from "./runners/quality-gate-runner.js";
import * as jobRepo from "../jobs/job-repository.js";
import { updateState } from "../jobs/job-repository.js";
import logger from "../utils/logger.js";

const RUNNERS = {
  image:      runImageStage,
  comfyui:    runComfyUIStage,
  qualityGate: runQualityGate,
  artifact:   async (ctx, cfg) => ({ stage: "artifact", skipped: true }), /* P3 handles artifacts */
  policy:     async (ctx, cfg) => ({ stage: "policy", passed: true }),
};

export async function executePipeline(jobId, pipelineName, inputs) {
  const pipeline = getPipeline(pipelineName);
  if (!pipeline) throw new Error("Unknown pipeline: " + pipelineName);

  const ctx = { jobId, inputs, outputs: {}, stageResults: [], warnings: [] };

  logger.info("pipeline.starting", { component: "orchestrator", data: { jobId, pipeline: pipelineName, stages: pipeline.stages.length } });

  for (let i = 0; i < pipeline.stages.length; i++) {
    const stage = pipeline.stages[i];
    const runner = RUNNERS[stage.runner];
    if (!runner) throw new Error("Unknown runner: " + stage.runner + " for stage " + stage.name);

    /* Add stage tracking */
    const stageRecord = jobRepo.addStage(jobId, { name: stage.name, ordinal: i, attempt: 0, input: { config: stage.config } });

    try {
      logger.info("pipeline.stage_starting", { component: "orchestrator", data: { jobId, stage: stage.name, runner: stage.runner } });
      const result = await runner(ctx, stage.config);
      ctx.stageResults.push({ name: stage.name, result });

      /* Store stage output for downstream stages */
      if (result.outputs) Object.assign(ctx.outputs, result.outputs);

      jobRepo.updateStage(stageRecord.id, { state: "completed", output: result, endedAt: new Date().toISOString() });

      /* Check quality gate if present */
      if (result.qualityGateFailed) {
        logger.warn("pipeline.quality_gate_failed", { component: "orchestrator", data: { jobId, stage: stage.name } });
        throw Object.assign(new Error("Quality gate failed: " + stage.name), { code: "QUALITY_GATE_FAILED" });
      }

    } catch (e) {
      jobRepo.updateStage(stageRecord.id, { state: "failed", error: { message: e.message, code: e.code }, endedAt: new Date().toISOString() });

      /* Stage recovery: retry once for retryable errors */
      if (e.retryable !== false && stageRecord.attempt < 1) {
        logger.info("pipeline.stage_retry", { component: "orchestrator", data: { jobId, stage: stage.name, attempt: 1 } });
        const retryStage = jobRepo.addStage(jobId, { name: stage.name, ordinal: i, attempt: 1, input: { config: stage.config } });
        try {
          const retryResult = await runner(ctx, stage.config);
          ctx.stageResults.push({ name: stage.name, result: retryResult, retried: true });
          if (retryResult.outputs) Object.assign(ctx.outputs, retryResult.outputs);
          jobRepo.updateStage(retryStage.id, { state: "completed", output: retryResult, endedAt: new Date().toISOString() });
          continue;
        } catch (retryErr) {
          jobRepo.updateStage(retryStage.id, { state: "failed", error: { message: retryErr.message, code: retryErr.code }, endedAt: new Date().toISOString() });
          logger.error("pipeline.stage_retry_failed", { component: "orchestrator", error: retryErr, data: { jobId, stage: stage.name } });
        }
      }

      throw e;
    }
  }

  logger.info("pipeline.completed", { component: "orchestrator", data: { jobId, pipeline: pipelineName } });
  return ctx;
}

export default { executePipeline };
