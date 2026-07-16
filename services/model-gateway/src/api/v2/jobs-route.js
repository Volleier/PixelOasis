/* jobs-route.js — V2 job CRUD + SSE + idempotency + cancellation
 *
 * POST   /v2/jobs              → create job (validate, idempotency check)
 * GET    /v2/jobs/{id}          → get job status
 * GET    /v2/jobs?clientId=&state= → list jobs
 * DELETE /v2/jobs/{id}          → cancel job
 * POST   /v2/jobs/{id}/retry    → retry failed job
 * GET    /v2/jobs/{id}/events   → SSE event stream
 */

import { writeJson, v2BadRequest, v2NotFound, v2Conflict, v2Unprocessable, v2ServerError } from "../../utils/errors.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as jobRepo from "../../jobs/job-repository.js";
import * as eventRepo from "../../jobs/event-repository.js";
import { isActive, isTerminal } from "../../jobs/state-machine.js";
import { getAsset } from "../../assets/asset-store.js";
import logger from "../../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* Load schema */
let _schema = null;
function getSchema() {
  if (!_schema) {
    _schema = JSON.parse(readFileSync(resolve(__dirname, "schemas/job-request.schema.json"), "utf8"));
  }
  return _schema;
}

/* ═══════════════════════════════════════════════════════════════════
 * POST /v2/jobs — create job
 * ═══════════════════════════════════════════════════════════════════ */

export async function handleCreateJob(req, res, params) {
  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body);

      /* Validate schemaVersion */
      if (payload.schemaVersion !== "2.0") {
        v2BadRequest(res, "REQUEST_SCHEMA_INVALID", "schemaVersion must be 2.0");
        return;
      }

      /* Validate required fields */
      if (!payload.capabilityId) {
        v2BadRequest(res, "REQUEST_SCHEMA_INVALID", "capabilityId is required");
        return;
      }
      if (!payload.source || !payload.source.assetId) {
        v2BadRequest(res, "REQUEST_SCHEMA_INVALID", "source.assetId is required");
        return;
      }

      /* Verify source asset exists */
      const sourceAsset = getAsset(payload.source.assetId);
      if (!sourceAsset) {
        v2Unprocessable(res, "ASSET_NOT_FOUND", "Source asset not found or expired");
        return;
      }

      /* Idempotency check */
      if (payload.idempotencyKey) {
        const existing = jobRepo.findByIdempotencyKey(payload.idempotencyKey);
        if (existing) {
          writeJson(res, 200, {
            jobId: existing.id,
            correlationId: existing.correlationId,
            state: existing.state,
            statusUrl: "/v2/jobs/" + existing.id,
            eventsUrl: "/v2/jobs/" + existing.id + "/events",
            cancelUrl: "/v2/jobs/" + existing.id,
            _idempotent: true,
          });
          logger.info("job.idempotency_hit", {
            component: "jobs-route",
            data: { idempotencyKey: payload.idempotencyKey, jobId: existing.id },
          });
          return;
        }
      }

      /* Create job */
      const job = jobRepo.create({
        clientId: req.headers["x-client-id"] || "default",
        correlationId: payload.correlationId || ("gw-" + Date.now().toString(36)),
        idempotencyKey: payload.idempotencyKey || null,
        capabilityId: payload.capabilityId,
        profile: (payload.options && payload.options.profile) || "quality_16gb",
        params: payload.parameters || null,
      });

      writeJson(res, 202, {
        jobId: job.id,
        correlationId: job.correlationId,
        state: job.state,
        statusUrl: "/v2/jobs/" + job.id,
        eventsUrl: "/v2/jobs/" + job.id + "/events",
        cancelUrl: "/v2/jobs/" + job.id,
      });

      logger.info("job.created_v2", {
        component: "jobs-route",
        data: { jobId: job.id, capabilityId: payload.capabilityId, idempotencyKey: payload.idempotencyKey },
      });

    } catch (e) {
      if (e.code === "INVALID_STATE_TRANSITION") {
        v2Conflict(res, "INVALID_STATE_TRANSITION", e.message);
      } else if (e.message && e.message.indexOf("JSON") !== -1) {
        v2BadRequest(res, "REQUEST_SCHEMA_INVALID", "Invalid JSON body");
      } else {
        v2ServerError(res, "JOB_CREATE_FAILED", e.message);
      }
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════
 * GET /v2/jobs/{id} — get job status
 * ═══════════════════════════════════════════════════════════════════ */

export async function handleGetJob(req, res, routeParams) {
  const jobId = routeParams.id;
  const job = jobRepo.getById(jobId);
  if (!job) {
    v2NotFound(res, "JOB_NOT_FOUND", "Job not found: " + jobId);
    return;
  }

  writeJson(res, 200, {
    jobId: job.id,
    correlationId: job.correlationId,
    capabilityId: job.capabilityId,
    state: job.state,
    profile: job.profile,
    progress: _estimateProgress(job),
    stages: job.stages,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}

function _estimateProgress(job) {
  const ranges = {
    queued: 0, preparing: 10, running: 50, postprocessing: 90,
    succeeded: 100, failed: 0, canceled: 0,
  };
  return ranges[job.state] || 0;
}

/* ═══════════════════════════════════════════════════════════════════
 * GET /v2/jobs — list jobs
 * ═══════════════════════════════════════════════════════════════════ */

export async function handleListJobs(req, res, params) {
  const clientId = params.get("clientId") || req.headers["x-client-id"] || "default";
  const state = params.get("state") || null;
  const jobs = jobRepo.listByClient(clientId, state);
  writeJson(res, 200, jobs.map(j => ({
    jobId: j.id,
    correlationId: j.correlationId,
    capabilityId: j.capabilityId,
    state: j.state,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  })));
}

/* ═══════════════════════════════════════════════════════════════════
 * DELETE /v2/jobs/{id} — cancel job
 * ═══════════════════════════════════════════════════════════════════ */

export async function handleCancelJob(req, res, routeParams) {
  const jobId = routeParams.id;
  const job = jobRepo.getById(jobId);
  if (!job) {
    v2NotFound(res, "JOB_NOT_FOUND", "Job not found: " + jobId);
    return;
  }

  if (!isActive(job.state)) {
    v2Conflict(res, "JOB_ALREADY_TERMINAL", "Job is already in terminal state: " + job.state);
    return;
  }

  jobRepo.updateState(jobId, "canceled", { message: "Canceled by user" });
  writeJson(res, 200, { jobId, state: "canceled" });

  logger.info("job.canceled_v2", { component: "jobs-route", data: { jobId } });
}

/* ═══════════════════════════════════════════════════════════════════
 * POST /v2/jobs/{id}/retry — retry failed job
 * ═══════════════════════════════════════════════════════════════════ */

export async function handleRetryJob(req, res, routeParams) {
  const jobId = routeParams.id;
  const job = jobRepo.getById(jobId);
  if (!job) {
    v2NotFound(res, "JOB_NOT_FOUND", "Job not found: " + jobId);
    return;
  }

  if (job.state !== "failed") {
    v2Conflict(res, "JOB_NOT_FAILED", "Only failed jobs can be retried. Current state: " + job.state);
    return;
  }

  jobRepo.updateState(jobId, "queued", { message: "Retry requested" });
  writeJson(res, 202, {
    jobId,
    state: "queued",
    statusUrl: "/v2/jobs/" + jobId,
    eventsUrl: "/v2/jobs/" + jobId + "/events",
  });

  logger.info("job.retried_v2", { component: "jobs-route", data: { jobId } });
}

/* ═══════════════════════════════════════════════════════════════════
 * GET /v2/jobs/{id}/events — SSE event stream
 * ═══════════════════════════════════════════════════════════════════ */

export async function handleJobEvents(req, res, routeParams, queryParams) {
  const jobId = routeParams.id;
  const job = jobRepo.getById(jobId);
  if (!job) {
    v2NotFound(res, "JOB_NOT_FOUND", "Job not found: " + jobId);
    return;
  }

  /* SSE headers */
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  /* Get Last-Event-ID for replay */
  const lastEventId = req.headers["last-event-id"];
  let lastSeq = lastEventId ? parseInt(lastEventId, 10) : 0;

  /* Send initial state */
  _sendSSE(res, "state", { state: job.state, progress: _estimateProgress(job) });

  /* Poll for new events */
  const interval = setInterval(() => {
    const events = eventRepo.getEvents(jobId, lastSeq);
    for (const evt of events) {
      _sendSSE(res, evt.type, evt.payload, evt.seq);
      lastSeq = evt.seq;
    }

    /* Check if job reached terminal state */
    const current = jobRepo.getById(jobId);
    if (current && isTerminal(current.state)) {
      _sendSSE(res, "complete", { state: current.state });
      clearInterval(interval);
      res.end();
    }
  }, 1000);

  /* Heartbeat every 15 seconds */
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  /* Cleanup on disconnect */
  req.on("close", () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });
}

function _sendSSE(res, event, data, id) {
  if (id) res.write("id: " + id + "\n");
  res.write("event: " + event + "\n");
  res.write("data: " + JSON.stringify(data) + "\n\n");
}
