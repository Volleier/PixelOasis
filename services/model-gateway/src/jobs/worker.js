/* jobs/worker.js — Single GPU worker for job processing
 *
 * BlackSmokeDust B2: processes queued jobs through the pipeline.
 * State machine: queued→preparing→running→postprocessing→succeeded|failed
 * Records events/SSE at each step. Calls ComfyUI interrupt on cancel.
 */

import * as jobRepo from "./job-repository.js";
import { enqueue, dequeue, done } from "./scheduler.js";
import { executePipeline } from "../pipelines/orchestrator.js";
import { isActive, STATES } from "./state-machine.js";
import { getCapability } from "../capabilities/registry-instance.js";
import { checkDiskSpace } from "../security/disk-protection.js";
import logger from "../utils/logger.js";

let _running = false;
let _currentJobId = null;
let _currentPromptId = null;

/* ── Start the worker loop ── */
export function start() {
  if (_running) return;
  _running = true;
  logger.info("worker.started", { component: "worker" });
  _loop();
}

/* ── Stop the worker ── */
export function stop() {
  _running = false;
  logger.info("worker.stopped", { component: "worker" });
}

/* ── Main processing loop ── */
async function _loop() {
  while (_running) {
    const jobId = dequeue();
    if (!jobId) {
      /* No jobs — wait and check again */
      await _sleep(2000);
      continue;
    }

    _currentJobId = jobId;
    logger.info("worker.processing", { component: "worker", data: { jobId } });

    try {
      await _processJob(jobId);
    } catch (e) {
      logger.error("worker.job_failed", { component: "worker", error: e, data: { jobId } });
      try {
        jobRepo.updateState(jobId, "failed", { message: e.message, code: e.code });
      } catch (_) { /* ignore */ }
    }

    done(jobId);
    _currentJobId = null;
    _currentPromptId = null;
  }
}

/* ── Process a single job ── */
async function _processJob(jobId) {
  /* Disk space check */
  const disk = checkDiskSpace();
  if (!disk.ok) {
    jobRepo.updateState(jobId, "failed", { message: disk.reason, code: "DISK_SPACE_LOW" });
    return;
  }

  /* Get job data */
  const job = jobRepo.getById(jobId);
  if (!job) throw new Error("Job not found: " + jobId);

  /* Get capability */
  const capability = getCapability(job.capabilityId);
  if (!capability) throw new Error("Capability not found: " + job.capabilityId);

  /* ── preparing ── */
  jobRepo.updateState(jobId, STATES.PREPARING, { progress: 10 });
  jobRepo.addStage(jobId, { name: "preparing", ordinal: 0, input: { capabilityId: job.capabilityId, params: job.params } });

  /* Resolve pipeline */
  const pipelineName = capability.pipeline || "black-smoke-v1";

  /* ── running ── */
  jobRepo.updateState(jobId, STATES.RUNNING, { progress: 25 });

  try {
    const ctx = await executePipeline(jobId, pipelineName, {
      jobId,
      capabilityId: job.capabilityId,
      params: job.params || {},
      sourceBuffer: null, /* Will be loaded from asset store by runners */
    });

    /* ── postprocessing ── */
    jobRepo.updateState(jobId, STATES.POSTPROCESSING, { progress: 90 });
    jobRepo.addStage(jobId, { name: "postprocessing", ordinal: 99, input: { outputs: Object.keys(ctx.outputs || {}) } });

    /* Register artifacts */
    if (ctx.outputs) {
      await _registerArtifacts(jobId, ctx.outputs, capability);
    }

    /* ── succeeded ── */
    jobRepo.updateState(jobId, STATES.SUCCEEDED, { progress: 100 });

    logger.info("worker.job_completed", { component: "worker", data: { jobId, pipeline: pipelineName } });

  } catch (e) {
    jobRepo.updateState(jobId, STATES.FAILED, { progress: 0, message: e.message, code: e.code });
    throw e;
  }
}

/* ── Register output artifacts in the database ── */
async function _registerArtifacts(jobId, outputs, capability) {
  const { storeAsset } = await import("../assets/asset-store.js");
  const { getDb } = await import("../persistence/database.js");
  const db = getDb();

  const outputSchema = capability.outputSchema;
  const artifactRoles = outputSchema && outputSchema.artifacts
    ? outputSchema.artifacts
    : [{ role: "result", layerName: "结果" }];

  for (const artDef of artifactRoles) {
    const role = artDef.role;
    const bufferKey = role + "Buffer";
    const buf = outputs[bufferKey];

    if (!buf) {
      logger.warn("worker.missing_artifact", { component: "worker", data: { jobId, role } });
      continue;
    }

    /* Store as artifact asset */
    const clientId = "default";
    const artifactId = "art_" + jobId + "_" + role;
    const asset = storeAsset({
      id: artifactId,
      clientId,
      kind: "artifact",
      filePath: _bufferToTempFile(buf, artifactId),
      mime: "image/png",
      sha256: null, /* computed by storeAsset */
      sizeBytes: buf.length,
      moveFile: true,
      ttlHours: 168, /* 7 days */
    });

    /* Register in artifacts table */
    const placementJson = JSON.stringify({
      layerName: artDef.layerName || role,
      groupName: "PixelOasis/" + (capability.title || capability.id),
      blendMode: artDef.blendMode || "normal",
      opacity: artDef.opacity || 100,
      previewOnly: artDef.previewOnly || false,
      order: (artifactRoles.indexOf(artDef) + 1) * 10,
    });

    db.prepare(`
      INSERT INTO artifacts (id, job_id, role, asset_id, placement_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(artifactId, jobId, role, asset.id, placementJson);

    logger.info("worker.artifact_registered", {
      component: "worker",
      data: { jobId, role, artifactId, sizeBytes: asset.sizeBytes },
    });
  }
}

function _bufferToTempFile(buf, name) {
  const { writeFileSync, mkdirSync, existsSync } = require("node:fs");
  const { resolve } = require("node:path");
  const tmpDir = resolve("E:/PixelOasisData", "tmp");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const path = resolve(tmpDir, name + ".png");
  writeFileSync(path, buf);
  return path;
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default { start, stop };
