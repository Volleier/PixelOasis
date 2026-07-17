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
import { getAsset } from "../assets/asset-store.js";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import config from "../config.js";
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
    const queuedJob = jobRepo.getById(jobId);
    logger.info("worker.processing", { component: "worker", traceId: queuedJob?.traceId, jobId, data: { jobId } });

    try {
      await _processJob(jobId);
    } catch (e) {
      logger.error("worker.job_failed", { component: "worker", traceId: queuedJob?.traceId, jobId, error: e, data: { jobId } });
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
  if (!job.input || !job.input.source?.assetId) {
    throw Object.assign(new Error("Job input graph is missing"), { code: "JOB_INPUT_MISSING" });
  }
  const sourceAsset = getAsset(job.input.source.assetId);
  if (!sourceAsset || sourceAsset.clientId !== job.clientId) {
    throw Object.assign(new Error("Job source asset is unavailable"), { code: "ASSET_NOT_FOUND" });
  }
  const subjectMaskAssetId = job.input.inputs?.subjectMaskAssetId;
  const subjectMaskAsset = subjectMaskAssetId ? getAsset(subjectMaskAssetId) : null;
  if (subjectMaskAsset && subjectMaskAsset.clientId !== job.clientId) {
    throw Object.assign(new Error("Job subject mask is unavailable"), { code: "ASSET_NOT_FOUND" });
  }
  const subjectMaskPath = subjectMaskAsset?.path || await _createEmptySubjectMask(jobId, sourceAsset);

  /* ── preparing ── */
  jobRepo.updateState(jobId, STATES.PREPARING, { progress: 10 });
  jobRepo.addStage(jobId, { name: "preparing", ordinal: 0, input: { capabilityId: job.capabilityId, params: job.params } });

  /* Resolve pipeline */
  const pipelineName = capability.pipeline || "black-smoke-v1";
  const outputSize = _workflowSize(job.input.source.bounds);

  /* ── running ── */
  jobRepo.updateState(jobId, STATES.RUNNING, { progress: 25 });

  try {
    const ctx = await executePipeline(jobId, pipelineName, {
      jobId,
      traceId: job.traceId,
      capabilityId: job.capabilityId,
      params: job.params || {},
      sourcePath: sourceAsset.path,
      subjectMaskPath,
      sourceFilename: "po/" + jobId + "/source.png",
      subjectMaskFilename: "po/" + jobId + "/subject-mask.png",
      smokeOutputPrefix: "PixelOasis/" + jobId + "/smoke",
      smokeFrontOutputPrefix: "PixelOasis/" + jobId + "/smoke-front",
      dustOutputPrefix: "PixelOasis/" + jobId + "/dust",
      dustFrontOutputPrefix: "PixelOasis/" + jobId + "/dust-front",
      compositeOutputPrefix: "PixelOasis/" + jobId + "/composite",
      images: [
        {
          role: "source",
          name: "source.png",
          filePath: sourceAsset.path,
          mimeType: sourceAsset.mime,
          sizeBytes: sourceAsset.sizeBytes,
          width: sourceAsset.width,
          height: sourceAsset.height,
        },
        {
          role: "subjectMask",
          name: "subject-mask.png",
          filePath: subjectMaskPath,
          mimeType: subjectMaskAsset?.mime || "image/png",
          sizeBytes: subjectMaskAsset?.sizeBytes || null,
          width: subjectMaskAsset?.width || sourceAsset.width,
          height: subjectMaskAsset?.height || sourceAsset.height,
        },
      ],
      anchorX: _anchorCoordinate(job.input.inputs?.points, "x", 0.58, job.input.source.bounds?.width),
      anchorY: _anchorCoordinate(job.input.inputs?.points, "y", 0.72, job.input.source.bounds?.height),
      width: outputSize.width,
      height: outputSize.height,
    });

    /* ── postprocessing ── */
    jobRepo.updateState(jobId, STATES.POSTPROCESSING, { progress: 90 });
    jobRepo.addStage(jobId, { name: "postprocessing", ordinal: 99, input: { outputs: Object.keys(ctx.outputs || {}) } });

    /* Register artifacts */
    if (ctx.outputs) {
      await _registerArtifacts(jobId, ctx.outputs, capability, {
        width: Math.max(1, Math.round(job.input.source.bounds?.width || sourceAsset.width || 1024)),
        height: Math.max(1, Math.round(job.input.source.bounds?.height || sourceAsset.height || 1024)),
      });
    }

    /* ── succeeded ── */
    jobRepo.updateState(jobId, STATES.SUCCEEDED, { progress: 100 });

    logger.info("worker.job_completed", { component: "worker", traceId: job.traceId, jobId, data: { pipeline: pipelineName } });

  } catch (e) {
    jobRepo.updateState(jobId, STATES.FAILED, { progress: 0, message: e.message, code: e.code });
    throw e;
  }
}

/* ── Register output artifacts in the database ── */
async function _registerArtifacts(jobId, outputs, capability, targetSize) {
  const { storeAsset } = await import("../assets/asset-store.js");
  const { getDb } = await import("../persistence/database.js");
  const db = getDb();

  const outputSchema = capability.outputSchema;
  const artifactRoles = outputSchema && outputSchema.artifacts
    ? outputSchema.artifacts
    : [{ role: "result", layerName: "结果" }];

  const job = jobRepo.getById(jobId);

  for (const artDef of artifactRoles) {
    const role = artDef.role;
    const bufferKey = role + "Buffer";
    let buf = outputs[bufferKey];

    if (!buf) {
      logger.warn("worker.missing_artifact", { component: "worker", data: { jobId, role } });
      continue;
    }

    const generatedWidth = outputs[role + "Width"] || null;
    const generatedHeight = outputs[role + "Height"] || null;
    const finalWidth = targetSize?.width || generatedWidth;
    const finalHeight = targetSize?.height || generatedHeight;

    /* ComfyUI intentionally renders overlays at a VRAM-safe proxy size.
       Artifacts returned to Photoshop must match the captured canvas exactly;
       otherwise place/transform silently changes the layer's pixel grid. */
    if (finalWidth && finalHeight && (generatedWidth !== finalWidth || generatedHeight !== finalHeight)) {
      buf = await sharp(buf).resize(finalWidth, finalHeight, {
        fit: "fill",
        kernel: sharp.kernel.lanczos3,
      }).png().toBuffer();
      logger.info("worker.artifact_resized_for_placement", {
        component: "worker",
        traceId: job?.traceId,
        jobId,
        data: {
          role,
          generatedWidth,
          generatedHeight,
          finalWidth,
          finalHeight,
        },
      });
    }

    /* Store as artifact asset */
    const clientId = job?.clientId;
    const artifactId = "art_" + jobId + "_" + role;
    const asset = storeAsset({
      id: artifactId,
      clientId,
      kind: "artifact",
      filePath: _bufferToTempFile(buf, artifactId),
      mime: "image/png",
      sha256: null, /* computed by storeAsset */
      sizeBytes: buf.length,
      width: finalWidth || null,
      height: finalHeight || null,
      traceId: job?.traceId,
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
      bounds: job?.input?.source?.bounds || null,
      createSmartObject: true,
      order: (artifactRoles.indexOf(artDef) + 1) * 10,
    });

    db.prepare(`
      INSERT INTO artifacts (id, job_id, role, asset_id, width, height, placement_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(artifactId, jobId, role, asset.id, asset.width || null, asset.height || null, placementJson);

    logger.info("worker.artifact_registered", {
      component: "worker",
      traceId: job?.traceId,
      jobId,
      asset: {
        role,
        mimeType: asset.mime,
        sizeBytes: asset.sizeBytes,
        width: asset.width || null,
        height: asset.height || null,
        sha256Prefix: asset.sha256 ? asset.sha256.substring(0, 12) : null,
      },
      data: {
        artifactId,
        previewOnly: artDef.previewOnly === true,
        generatedWidth,
        generatedHeight,
        finalWidth: asset.width || null,
        finalHeight: asset.height || null,
      },
    });
  }
}

function _bufferToTempFile(buf, name) {
  const tmpDir = resolve(config.dataDir, "tmp");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const path = resolve(tmpDir, name + ".png");
  writeFileSync(path, buf);
  return path;
}

async function _createEmptySubjectMask(jobId, sourceAsset) {
  const tmpDir = resolve(config.dataDir, "tmp");
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const path = resolve(tmpDir, jobId + "-empty-subject-mask.png");
  const metadata = await sharp(sourceAsset.path).metadata();
  await sharp({
    create: {
      width: metadata.width,
      height: metadata.height,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  }).png().toFile(path);
  return path;
}

function _anchorCoordinate(points, coordinate, fallback, extent) {
  if (!Array.isArray(points) || points.length === 0 || !Number.isFinite(points[0]?.[coordinate]) || !extent) return fallback;
  return Math.max(0, Math.min(1, points[0][coordinate] / extent));
}

function _workflowSize(bounds) {
  const width = Math.max(1, Math.round(bounds?.width || 1024));
  const height = Math.max(1, Math.round(bounds?.height || 1024));
  const scale = Math.min(1, 2048 / Math.max(width, height));
  return {
    width: Math.max(64, Math.round(width * scale)),
    height: Math.max(64, Math.round(height * scale)),
  };
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default { start, stop };
