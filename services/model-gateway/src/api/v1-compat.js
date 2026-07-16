/* api/v1-compat.js — V1 /generate compatibility adapter
 *
 * Stage 8: maps v1 workflowId → v2 capabilityId, submits v2 job,
 * synchronously waits for result, returns v1-format response.
 * Per GatewayOrchestrationDesign §13.
 */

import { writeJson, v2NotFound, v2BadRequest } from "../utils/errors.js";
import * as jobRepo from "../jobs/job-repository.js";
import { isTerminal } from "../jobs/state-machine.js";
import { generateId } from "../persistence/database.js";
import logger from "../utils/logger.js";

/* V1 workflowId → V2 capabilityId mapping */
const V1_TO_V2 = {
  "composition.inpaint.pro":    "scene.quickCleanupGrade",
  "composition.inpaint.basic":  "scene.quickCleanupGrade",
  "composition.remove.pro":     "cleanup.removeLightingGear",
  "composition.remove.local":   "cleanup.removeSupport",
  "composition.remove.basic":   "cleanup.removeSupport",
  "quality.realism.pro":        "lighting.enhance",
  "quality.realism-enhance.basic": "lighting.enhance",
  "portrait.skin-retouch.basic":   "portrait.impastoMakeup",
  "lighting.relight.basic":        "lighting.underlight",
  "effects.style-transfer.basic":  "scene.lightBlend",
};

export async function handleV1Generate(req, res, params) {
  /* Read body */
  let body = "";
  req.on("data", c => { body += c; });
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body);
      const v1WorkflowId = payload.workflowId;

      if (!v1WorkflowId) {
        v2BadRequest(res, "MISSING_WORKFLOW_ID", "workflowId is required");
        return;
      }

      /* Map to v2 capability */
      const capabilityId = V1_TO_V2[v1WorkflowId];
      if (!capabilityId) {
        writeJson(res, 410, { error: { code: "WORKFLOW_DEPRECATED", message: "Workflow " + v1WorkflowId + " has been migrated to v2. Please upgrade the plugin.", capabilityId: null } });
        return;
      }

      /* Create v2 job (synchronous wait for v1 compat) */
      const jobId = generateId("job");
      const job = jobRepo.create({
        id: jobId,
        clientId: "v1-compat",
        correlationId: payload.correlationId || ("v1-" + Date.now().toString(36)),
        capabilityId,
        profile: "quality_16gb",
        params: payload.parameters || {},
      });

      /* Sync wait for job completion (max 10 min, matching old timeout) */
      const timeoutMs = 600000;
      const startTime = Date.now();

      while (!isTerminal(job.state)) {
        if (Date.now() - startTime > timeoutMs) {
          jobRepo.updateState(jobId, "failed", { message: "V1 compat timeout" });
          writeJson(res, 504, { error: { code: "TIMEOUT", message: "Generation timed out" } });
          return;
        }
        await _sleep(1500);
        const updated = jobRepo.getById(jobId);
        if (updated) job.state = updated.state;
      }

      /* Return v1-format response */
      if (job.state === "succeeded") {
        writeJson(res, 200, {
          correlationId: job.correlationId,
          status: "success",
          result: { state: job.state, jobId },
        });
      } else {
        writeJson(res, 500, {
          correlationId: job.correlationId,
          status: "failed",
          error: { code: "GENERATION_FAILED", message: "Job ended in state: " + job.state },
        });
      }

      logger.info("v1_compat.completed", {
        component: "v1-compat",
        data: { v1WorkflowId, capabilityId, jobId, state: job.state },
      });

    } catch (e) {
      v2BadRequest(res, "INVALID_REQUEST", e.message);
    }
  });
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
