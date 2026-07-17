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
import { writeAuditEvent } from "../../observability/audit-repository.js";

/* ═══════════════════════════════════════════════════════════════════
 * run(workflowApiJson, meta, inputs, parameters, options) → outputs
 *
 * options: { jobId, clientId, timeoutMs, onProgress, onStageChange }
 * ═══════════════════════════════════════════════════════════════════ */

export async function run(workflowApiJson, meta, inputs, parameters, options = {}) {
  const jobId = options.jobId || ("job-" + Date.now().toString(36));
  const clientId = options.clientId || jobId;
  const timeoutMs = options.timeoutMs || (meta.timeoutMs || 600000); /* 10 min default */
  const traceId = options.traceId || null;
  const bindings = meta.bindings || [];
  const outputMapping = meta.outputs || [];

  logger.info("prompt_runner.starting", {
    component: "prompt-runner",
    traceId,
    jobId,
    data: { jobId, clientId, timeoutMs },
  });

  /* ── 1. Upload input images ── */
  if (inputs.images) {
    for (const img of inputs.images) {
      const filename = "po/" + jobId + "/" + (img.name || "source.png");
      await uploadImage(img.filePath, filename, false);
      logger.info("prompt_runner.image_uploaded", {
        component: "prompt-runner",
        traceId,
        jobId,
        asset: {
          role: img.role || "source",
          originalName: img.name || "source.png",
          storedName: filename,
          mimeType: img.mimeType || "image/png",
          sizeBytes: img.sizeBytes || null,
          width: img.width || null,
          height: img.height || null,
        },
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
      traceId,
      jobId,
      error: normalized,
      data: { jobId },
    });
    throw normalized;
  }

  const promptId = promptResult.prompt_id;
  logger.info("prompt_runner.submitted", {
    component: "prompt-runner",
    traceId,
    jobId,
    promptId,
  });
  writeAuditEvent(jobId, traceId, "comfyui.prompt.submitted", "info", { promptId });

  /* ── 4.5 Build node map for human-readable logging ── */
  const nodeMap = _buildNodeMap(patched);

  /* ── 5. Monitor via WebSocket + polling fallback ── */
  const historyEntry = await _monitorExecution(promptId, clientId, timeoutMs, options, nodeMap, jobId, traceId);

  /* ── 6. Collect outputs ── */
  if (options.onStageChange) options.onStageChange("postprocessing");

  const outputs = await collect(historyEntry, outputMapping, { jobId, traceId, promptId });
  if (outputs.length === 0) {
    throw Object.assign(new Error("No output images produced"), { code: "ARTIFACT_INVALID" });
  }

  logger.info("prompt_runner.completed", {
    component: "prompt-runner",
    traceId,
    jobId,
    promptId,
    data: { outputCount: outputs.length },
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
async function _monitorExecution(promptId, clientId, timeoutMs, options, nodeMap, jobId, traceId) {
  const startTime = Date.now();
  const pollInterval = 1500;
  let ws = null;
  let completed = false;
  let historyEntry = null;
  let wsUsed = false;

  /* Try WebSocket */
  try {
    ws = new ComfyUIWebSocket(promptId);
    ws.setNodeMap(nodeMap || {});

    /* ── Wire node-level callbacks to logger ── */
    ws.onNodeStart(function (evt) {
      logger.info("comfyui.node.started", {
        component: "prompt-runner",
        traceId,
        jobId: jobId,
        promptId: promptId,
        data: { nodeId: evt.nodeId, classType: evt.classType, title: evt.title },
      });
      writeAuditEvent(jobId, traceId, "comfyui.node.started", "info", evt);
    });

    ws.onNodeProgress(function (evt) {
      logger.debug("comfyui.node.progress", {
        component: "prompt-runner",
        traceId,
        jobId: jobId,
        promptId: promptId,
        data: { nodeId: evt.nodeId, classType: evt.classType, progress: evt.progress },
      });
    });

    ws.onNodeComplete(function (evt) {
      logger.info("comfyui.node.completed", {
        component: "prompt-runner",
        traceId,
        jobId: jobId,
        promptId: promptId,
        durationMs: evt.durationMs,
        data: { nodeId: evt.nodeId, classType: evt.classType, title: evt.title },
      });
      writeAuditEvent(jobId, traceId, "comfyui.node.completed", "info", evt);
    });

    ws.onNodeCached(function (evt) {
      logger.info("comfyui.node.cached", {
        component: "prompt-runner",
        traceId,
        jobId: jobId,
        promptId: promptId,
        data: { nodeId: evt.nodeId, classType: evt.classType, title: evt.title },
      });
      writeAuditEvent(jobId, traceId, "comfyui.node.cached", "info", evt);
    });

    ws.onNodeFailed(function (evt) {
      logger.error("comfyui.node.failed", {
        component: "prompt-runner",
        traceId,
        jobId: jobId,
        promptId: promptId,
        data: {
          nodeId: evt.nodeId, classType: evt.classType, title: evt.title,
          errorType: evt.errorType, errorMessage: evt.errorMessage,
        },
      });
      writeAuditEvent(jobId, traceId, "comfyui.node.failed", "error", evt);
    });

    ws.onExecuted((data) => {
      if (data.prompt_id === promptId) {
        logger.info("prompt_runner.ws_executed", { component: "prompt-runner", traceId, jobId, promptId });
      }
    });
    ws.onError((data) => {
      logger.warn("prompt_runner.ws_error", { component: "prompt-runner", traceId, jobId, promptId, data: { error: data } });
    });
    ws.connect(clientId);
    wsUsed = true;
  } catch (e) {
    logger.info("prompt_runner.ws_unavailable_fallback_polling", {
      component: "prompt-runner",
      traceId,
      jobId,
      promptId,
      data: { promptId },
    });
  }

  if (!wsUsed) {
    logger.info("comfyui.monitor.polling_fallback", {
      component: "prompt-runner",
      traceId,
      jobId: jobId,
      promptId: promptId,
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

/* ── Build nodeMap from patched workflow: nodeId -> { classType, title, stage } ── */
function _buildNodeMap(workflow) {
  const map = {};
  if (!workflow || typeof workflow !== "object") return map;
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : null;
  if (nodes) {
    for (const node of nodes) {
      if (!node || node.id === undefined || node.id === null) continue;
      map[String(node.id)] = {
        classType: node.type || node.class_type || null,
        title: (node._meta && node._meta.title) || node.title || null,
      };
    }
    return map;
  }

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!node || typeof node !== "object" || !node.class_type) continue;
    map[String(nodeId)] = {
      classType: node.class_type,
      title: (node._meta && node._meta.title) || node.title || null,
    };
  }
  return map;
}

export default { run, cancel };
