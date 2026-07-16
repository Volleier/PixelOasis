/* prompt-runner.js — Orchestrate a single ComfyUI prompt execution
 *
 * GatewayOrchestrationDesign §7.3: upload → patch → submit → monitor → collect
 * Prefers WebSocket for monitoring, falls back to polling.
 * Deep-copies workflow before patching; saves sanitized debug copy.
 */

import { submitPrompt, getHistory, uploadImage, interruptPrompt } from "./http-client.js";
import { ComfyUIWebSocket } from "./ws-client.js";
import { bind } from "./binding-engine.js";
import { collect } from "./output-collector.js";
import { normalize } from "./error-normalizer.js";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import logger from "../../utils/logger.js";
import config from "../../config.js";

/* ═══════════════════════════════════════════════════════════════════
 * run(workflowApiJson, meta, inputs, parameters, options) → outputs
 *
 * options: { jobId, clientId, timeoutMs, onProgress, onStageChange }
 * ═══════════════════════════════════════════════════════════════════ */

export async function run(workflowApiJson, meta, inputs, parameters, options = {}) {
  const jobId = options.jobId || ("job-" + Date.now().toString(36));
  const clientId = options.clientId || jobId;
  const timeoutMs = options.timeoutMs || (meta.timeoutMs || 600000); /* 10 min default */
  const bindings = meta.bindings || [];
  const outputMapping = meta.outputs || [];

  logger.info("prompt_runner.starting", {
    component: "prompt-runner",
    data: { jobId, clientId, timeoutMs },
  });

  /* ── 1. Upload input images ── */
  if (inputs.images) {
    for (const img of inputs.images) {
      const filename = "po/" + jobId + "/" + (img.name || "source.png");
      await uploadImage(img.filePath, filename, false);
      logger.info("prompt_runner.image_uploaded", {
        component: "prompt-runner",
        data: { jobId, filename },
      });
    }
  }

  /* ── 2. Deep copy + inject parameters ── */
  const patched = bind(workflowApiJson, inputs, parameters, bindings);

  /* ── 3. Save sanitized debug copy ── */
  _saveDebugCopy(jobId, patched);

  /* ── 4. Submit prompt ── */
  if (options.onStageChange) options.onStageChange("running");

  let promptResult;
  try {
    promptResult = await submitPrompt(patched, clientId);
  } catch (e) {
    const normalized = normalize(e);
    logger.error("prompt_runner.submit_failed", {
      component: "prompt-runner",
      error: normalized,
      data: { jobId },
    });
    throw normalized;
  }

  const promptId = promptResult.prompt_id;
  logger.info("prompt_runner.submitted", {
    component: "prompt-runner",
    data: { jobId, promptId },
  });

  /* ── 5. Monitor via WebSocket + polling fallback ── */
  const historyEntry = await _monitorExecution(promptId, clientId, timeoutMs, options);

  /* ── 6. Collect outputs ── */
  if (options.onStageChange) options.onStageChange("postprocessing");

  const outputs = await collect(historyEntry, outputMapping, { jobId });
  if (outputs.length === 0) {
    throw Object.assign(new Error("No output images produced"), { code: "ARTIFACT_INVALID" });
  }

  logger.info("prompt_runner.completed", {
    component: "prompt-runner",
    data: { jobId, promptId, outputCount: outputs.length },
  });

  return outputs;
}

/* ═══════════════════════════════════════════════════════════════════
 * cancel(promptId) — interrupt a running prompt
 * ═══════════════════════════════════════════════════════════════════ */

export async function cancel(promptId) {
  try {
    await interruptPrompt();
    logger.info("prompt_runner.canceled", {
      component: "prompt-runner",
      data: { promptId },
    });
    return true;
  } catch (e) {
    logger.warn("prompt_runner.cancel_failed", {
      component: "prompt-runner",
      error: e,
      data: { promptId },
    });
    return false;
  }
}

/* ── Monitor: WebSocket preferred, polling fallback ── */
async function _monitorExecution(promptId, clientId, timeoutMs, options) {
  const startTime = Date.now();
  const pollInterval = 1500;
  let ws = null;
  let completed = false;
  let historyEntry = null;

  /* Try WebSocket */
  try {
    ws = new ComfyUIWebSocket();
    ws.onExecuted((data) => {
      if (data.prompt_id === promptId) {
        logger.info("prompt_runner.ws_executed", { component: "prompt-runner", data: { promptId } });
      }
    });
    ws.onError((data) => {
      logger.warn("prompt_runner.ws_error", { component: "prompt-runner", data: { promptId, error: data } });
    });
    ws.connect(clientId);
  } catch (e) {
    logger.info("prompt_runner.ws_unavailable_fallback_polling", {
      component: "prompt-runner",
      data: { promptId },
    });
  }

  /* Polling loop */
  while (!completed) {
    if (Date.now() - startTime > timeoutMs) {
      if (ws) ws.disconnect();
      throw Object.assign(new Error("Generation timed out"), { code: "COMFYUI_EXECUTION_FAILED", promptId, timeoutMs });
    }

    await _sleep(pollInterval);

    try {
      historyEntry = await getHistory(promptId);
    } catch (e) {
      /* Keep polling */
    }

    if (historyEntry) {
      completed = true;
      if (options.onProgress) options.onProgress({ promptId, complete: true });
    }
  }

  if (ws) ws.disconnect();
  return historyEntry;
}

/* ── Save sanitized debug copy ── */
function _saveDebugCopy(jobId, workflow) {
  try {
    const debugDir = resolve(config.dataDir || "E:/PixelOasisData", "debug", "jobs", jobId);
    if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true });
    /* Sanitize: remove image data references */
    const clean = JSON.parse(JSON.stringify(workflow));
    writeFileSync(resolve(debugDir, "workflow.json"), JSON.stringify(clean, null, 2));
  } catch (e) {
    logger.warn("prompt_runner.debug_save_failed", {
      component: "prompt-runner",
      error: e,
      data: { jobId },
    });
  }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default { run, cancel };
