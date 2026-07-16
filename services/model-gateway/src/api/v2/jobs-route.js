/* jobs-route.js — V2 job CRUD + SSE + idempotency + cancellation
 *
 * POST   /v2/jobs              → create job (validate, idempotency check)
 * GET    /v2/jobs/{id}          → get job status
 * GET    /v2/jobs?clientId=&state= → list jobs
 * DELETE /v2/jobs/{id}          → cancel job
 * POST   /v2/jobs/{id}/retry    → retry failed job
 * GET    /v2/jobs/{id}/events   → SSE event stream
 */

import { writeJson, v2BadRequest, v2NotFound, v2Conflict, v2Unprocessable, v2ServerError, v2QueueFull, v2DependencyMissing, buildV2Error } from "../../utils/errors.js";
import * as jobRepo from "../../jobs/job-repository.js";
import * as eventRepo from "../../jobs/event-repository.js";
import { isActive, isTerminal } from "../../jobs/state-machine.js";
import { getAsset } from "../../assets/asset-store.js";
import { getCapability, refreshCapabilityReadiness } from "../../capabilities/registry-instance.js";
import config from "../../config.js";
import { enqueue, cancelQueued } from "../../jobs/scheduler.js";
import { getDb } from "../../persistence/database.js";
import logger from "../../utils/logger.js";
import { getAuditEvents, buildAuditSummary, writeAuditEvent } from "../../observability/audit-repository.js";

const MAX_JOB_BODY_BYTES = () => (config.jobInputMaxMb || 300) * 1024 * 1024;

/* ── Standardised job rejection: logs + responds in one call ── */
function respondJobError(res, status, code, message, details, context) {
  context = context || {};
  const rejectionStage = context.rejectionStage || "unknown";
  logger.info("job.create.rejected", {
    component: "jobs-route",
    data: {
      status: status,
      code: code,
      rejectionStage: rejectionStage,
      traceId: context.traceId || null,
      correlationId: context.correlationId || null,
      clientId: (context.clientId || "").substring(0, 8) + "...",
      capabilityId: context.capabilityId || null,
    },
  });
  const err = buildV2Error(code, message, details);
  writeJson(res, status, { error: err });
}

/* ── Safe logger details: whitelist field paths, max 256 chars ── */
const ALLOWED_DETAIL_FIELDS = [
  "source.bounds", "source.document.width", "source.document.height",
  "source.document.bitDepth", "source.assetId", "source.scope",
  "capabilityId", "parameterName", "assetKind", "maskKind",
];
function safeDetails(raw) {
  if (!raw || typeof raw !== "string") return raw;
  return raw.substring(0, 256);
}

/* ═══════════════════════════════════════════════════════════════════
 * POST /v2/jobs — create job
 * ═══════════════════════════════════════════════════════════════════ */

export async function handleCreateJob(req, res, params) {
  const traceId = req.headers["x-correlation-id"] || ("gw-" + Date.now().toString(36));
  const clientId = req.headers["x-client-id"] || "default";
  const ctx = { traceId: traceId, clientId: clientId };
  const startMs = Date.now();

  try {
      await refreshCapabilityReadiness();
      const payload = await readJsonBody(req, MAX_JOB_BODY_BYTES());

      ctx.correlationId = payload.correlationId || traceId;

      /* Validate schemaVersion */
      if (payload.schemaVersion !== "2.0") {
        respondJobError(res, 400, "REQUEST_SCHEMA_INVALID", "schemaVersion must be 2.0", null, { ...ctx, rejectionStage: "schema" });
        return;
      }

      /* Validate required fields */
      if (!payload.capabilityId) {
        respondJobError(res, 400, "REQUEST_SCHEMA_INVALID", "capabilityId is required", null, { ...ctx, rejectionStage: "schema" });
        return;
      }

      ctx.capabilityId = payload.capabilityId;
      const capability = getCapability(payload.capabilityId);
      if (!capability || capability.enabled === false) {
        respondJobError(res, 404, "CAPABILITY_NOT_FOUND", "Capability not found or disabled", null, { ...ctx, rejectionStage: "capability" });
        return;
      }

      const requestError = validateRequestShape(payload, clientId);
      if (requestError) {
        respondJobError(res, 400, "REQUEST_SCHEMA_INVALID", requestError, null, { ...ctx, rejectionStage: "schema" });
        return;
      }
      const activeJobs = jobRepo.getRecoverable(clientId);
      if (activeJobs.length >= (config.maxQueuedPerClient || 3)) {
        respondJobError(res, 429, "QUEUE_LIMIT_EXCEEDED", "Too many active jobs for this client", null, { ...ctx, rejectionStage: "queue" });
        return;
      }

      if (!payload.source || !payload.source.assetId) {
        respondJobError(res, 400, "REQUEST_SCHEMA_INVALID", "source.assetId is required", null, { ...ctx, rejectionStage: "schema" });
        return;
      }

      /* Verify source asset exists */
      const sourceAsset = getAsset(payload.source.assetId);
      if (!sourceAsset) {
        respondJobError(res, 422, "ASSET_NOT_FOUND", "Source asset not found or expired", null, { ...ctx, rejectionStage: "asset" });
        return;
      }

      if (sourceAsset.clientId !== clientId) {
        respondJobError(res, 422, "ASSET_NOT_FOUND", "Source asset is not owned by this client", null, { ...ctx, rejectionStage: "asset-owner" });
        return;
      }
      if (sourceAsset.kind !== "source") {
        respondJobError(res, 422, "ASSET_KIND_INVALID", "source.assetId must reference a source asset", null, { ...ctx, rejectionStage: "asset-kind" });
        return;
      }

      const contractError = validateInputContract(payload, capability, clientId);
      if (contractError) {
        respondJobError(res, 422, contractError.code, contractError.message, null, { ...ctx, rejectionStage: "contract" });
        return;
      }

      const parameterError = validateParameters(payload.parameters || {}, capability.parameterSchema || {});
      if (parameterError) {
        respondJobError(res, 400, "REQUEST_SCHEMA_INVALID", parameterError, null, { ...ctx, rejectionStage: "parameter" });
        return;
      }

      const availability = capability.availability || {};
      if (availability.state !== "ready" && availability.state !== "degraded") {
        respondJobError(res, 424, "CAPABILITY_NOT_READY", "Capability dependencies are not ready", safeDetails(availability.details), { ...ctx, rejectionStage: "availability" });
        return;
      }

      /* Idempotency check */
      if (payload.idempotencyKey) {
        const existing = jobRepo.findByIdempotencyKey(payload.idempotencyKey, clientId);
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

      /* Create job — log acceptance before writing response */
      logger.info("job.create.accepted", {
        component: "jobs-route",
        data: {
          capabilityId: payload.capabilityId,
          correlationId: ctx.correlationId,
          traceId: traceId,
          clientId: (clientId || "").substring(0, 8) + "...",
          durationMs: Date.now() - startMs,
        },
      });

      const job = jobRepo.create({
        clientId,
        correlationId: payload.correlationId || ("gw-" + Date.now().toString(36)),
        idempotencyKey: payload.idempotencyKey || null,
        capabilityId: payload.capabilityId,
        profile: (payload.options && payload.options.profile) || "quality_16gb",
        params: payload.parameters || null,
        input: {
          source: payload.source,
          inputs: payload.inputs || {},
          options: payload.options || {},
        },
      });

      enqueue(job.id);

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
        respondJobError(res, 409, "INVALID_STATE_TRANSITION", e.message, null, { ...ctx, rejectionStage: "state-transition" });
      } else if (e.code === "PAYLOAD_TOO_LARGE") {
        respondJobError(res, 400, "REQUEST_TOO_LARGE", "Job request exceeds configured limit", null, { ...ctx, rejectionStage: "payload-size" });
      } else if (e.message && e.message.indexOf("JSON") !== -1) {
        respondJobError(res, 400, "REQUEST_SCHEMA_INVALID", "Invalid JSON body", null, { ...ctx, rejectionStage: "json-parse" });
      } else {
        respondJobError(res, 500, "JOB_CREATE_FAILED", e.message, null, { ...ctx, rejectionStage: "catch" });
      }
  }
}

async function readJsonBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error("Payload too large");
      error.code = "PAYLOAD_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validateInputContract(payload, capability, clientId) {
  const input = capability.input || {};
  if (input.source && payload.source.scope !== input.source) {
    return { code: "INPUT_SOURCE_INVALID", message: "Source scope does not satisfy this capability" };
  }
  const inputs = payload.inputs || {};
  if ((input.mask === "required" || input.editMask === "required") && !inputs.editMaskAssetId) {
    return { code: "INPUT_MASK_REQUIRED", message: "An edit mask is required" };
  }
  if (input.subjectMask === "required" && !inputs.subjectMaskAssetId) {
    return { code: "SUBJECT_MASK_REQUIRED", message: "A subject mask is required" };
  }
  if (input.points === "two" && (!Array.isArray(inputs.points) || inputs.points.length !== 2)) {
    return { code: "POINTS_REQUIRED", message: "Exactly two points are required" };
  }
  for (const key of ["editMaskAssetId", "subjectMaskAssetId"]) {
    if (inputs[key]) {
      const asset = getAsset(inputs[key]);
      if (!asset || asset.clientId !== clientId) {
        return { code: "ASSET_NOT_FOUND", message: "Referenced input asset is missing or not owned by this client" };
      }
      const expectedKind = key === "editMaskAssetId" ? "editMask" : "subjectMask";
      if (asset.kind !== expectedKind) {
        return { code: "ASSET_KIND_INVALID", message: key + " must reference a " + expectedKind + " asset" };
      }
    }
  }
  if (inputs.referenceAssetIds !== undefined) {
    if (!Array.isArray(inputs.referenceAssetIds) || inputs.referenceAssetIds.length > 5) {
      return { code: "REFERENCE_ASSETS_INVALID", message: "referenceAssetIds must contain at most five asset IDs" };
    }
    for (const assetId of inputs.referenceAssetIds) {
      const asset = getAsset(assetId);
      if (!asset || asset.clientId !== clientId || asset.kind !== "reference") {
        return { code: "ASSET_NOT_FOUND", message: "Reference asset is missing, invalid, or not owned by this client" };
      }
    }
  }
  if (inputs.points !== undefined) {
    if (!Array.isArray(inputs.points) || inputs.points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      return { code: "POINTS_INVALID", message: "Each point must contain finite x and y coordinates" };
    }
  }
  return null;
}

function validateRequestShape(payload, clientId) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(clientId)) return "Invalid X-Client-Id";
  if (typeof payload.capabilityId !== "string" || payload.capabilityId.length > 128) return "Invalid capabilityId";
  if (payload.correlationId !== undefined && (typeof payload.correlationId !== "string" || payload.correlationId.length > 256)) return "Invalid correlationId";
  if (payload.idempotencyKey !== undefined && (typeof payload.idempotencyKey !== "string" || payload.idempotencyKey.length > 512)) return "Invalid idempotencyKey";

  const source = payload.source;
  if (!source || typeof source.assetId !== "string" || !/^[A-Za-z0-9_-]+$/.test(source.assetId)) return "Invalid source.assetId";
  if (!["document", "selection", "subject"].includes(source.scope)) return "Invalid source.scope";
  if (!isBounds(source.bounds)) return "Invalid source.bounds";
  if (source.document !== undefined && !isDocument(source.document)) return "Invalid source.document";

  if (payload.parameters !== undefined && !isPlainObject(payload.parameters)) return "parameters must be an object";
  if (payload.inputs !== undefined && !isPlainObject(payload.inputs)) return "inputs must be an object";
  if (payload.options !== undefined && !isPlainObject(payload.options)) return "options must be an object";
  if (payload.options && payload.options.profile !== undefined && !["quality_16gb", "balanced_16gb", "safe_low_vram"].includes(payload.options.profile)) return "Invalid options.profile";
  return null;
}

function isBounds(bounds) {
  return isPlainObject(bounds) && Number.isFinite(bounds.left) && bounds.left >= 0 &&
    Number.isFinite(bounds.top) && bounds.top >= 0 && Number.isFinite(bounds.width) &&
    bounds.width >= 1 && Number.isFinite(bounds.height) && bounds.height >= 1;
}

function isDocument(document) {
  return isPlainObject(document) &&
    (document.id === undefined || typeof document.id === "string") &&
    (document.width === undefined || (Number.isInteger(document.width) && document.width >= 1)) &&
    (document.height === undefined || (Number.isInteger(document.height) && document.height >= 1)) &&
    (document.colorMode === undefined || typeof document.colorMode === "string") &&
    (document.bitDepth === undefined || (Number.isInteger(document.bitDepth) && document.bitDepth >= 1 && document.bitDepth <= 32));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateParameters(parameters, schema) {
  const properties = schema.properties || {};
  for (const [key, value] of Object.entries(parameters)) {
    const rule = properties[key];
    if (!rule) return "Unknown parameter: " + key;
    if (rule.enum && !rule.enum.includes(value)) return "Invalid value for parameter: " + key;
    if ((rule.type === "number" || rule.type === "integer") && !Number.isFinite(value)) return "Parameter must be numeric: " + key;
    if (rule.type === "integer" && !Number.isInteger(value)) return "Parameter must be an integer: " + key;
    if (rule.minimum !== undefined && value < rule.minimum) return "Parameter below minimum: " + key;
    if (rule.maximum !== undefined && value > rule.maximum) return "Parameter above maximum: " + key;
    if (rule.type === "string" && rule.maxLength !== undefined && String(value).length > rule.maxLength) return "Parameter too long: " + key;
  }
  for (const key of schema.required || []) {
    if (parameters[key] === undefined) return "Missing required parameter: " + key;
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════
 * GET /v2/jobs/{id} — get job status
 * ═══════════════════════════════════════════════════════════════════ */

export async function handleGetJob(req, res, routeParams) {
  const jobId = routeParams.id;
  const job = jobRepo.getById(jobId);
  if (!job || !isJobOwnedBy(req, job)) {
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
    artifacts: getJobArtifacts(job.id),
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
  const clientId = req.headers["x-client-id"] || "default";
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
  if (!job || !isJobOwnedBy(req, job)) {
    v2NotFound(res, "JOB_NOT_FOUND", "Job not found: " + jobId);
    return;
  }

  if (!isActive(job.state)) {
    v2Conflict(res, "JOB_ALREADY_TERMINAL", "Job is already in terminal state: " + job.state);
    return;
  }

  if (!cancelQueued(jobId)) {
    jobRepo.updateState(jobId, "canceled", { message: "Canceled by user" });
  }
  writeJson(res, 200, { jobId, state: "canceled" });

  logger.info("job.canceled_v2", { component: "jobs-route", data: { jobId } });
}

/* ═══════════════════════════════════════════════════════════════════
 * POST /v2/jobs/{id}/retry — retry failed job
 * ═══════════════════════════════════════════════════════════════════ */

export async function handleRetryJob(req, res, routeParams) {
  const jobId = routeParams.id;
  const job = jobRepo.getById(jobId);
  if (!job || !isJobOwnedBy(req, job)) {
    v2NotFound(res, "JOB_NOT_FOUND", "Job not found: " + jobId);
    return;
  }

  if (job.state !== "failed") {
    v2Conflict(res, "JOB_NOT_FAILED", "Only failed jobs can be retried. Current state: " + job.state);
    return;
  }

  /* A terminal job cannot be moved back to queued. The v2 schema currently
     stores only sanitized parameters, not the source/mask asset graph needed
     to safely clone a job. Returning a stable conflict is safer than throwing
     INVALID_STATE_TRANSITION (500) or silently reusing stale assets. */
  v2Conflict(res, "RETRY_REQUIRES_RESUBMIT", "Retry requires submitting the source assets again");
}

/* ═══════════════════════════════════════════════════════════════════
 * GET /v2/jobs/{id}/events — SSE event stream
 * ═══════════════════════════════════════════════════════════════════ */

export async function handleJobEvents(req, res, routeParams, queryParams) {
  const jobId = routeParams.id;
  const job = jobRepo.getById(jobId);
  if (!job || !isJobOwnedBy(req, job, queryParams)) {
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
      const artifacts = getJobArtifacts(jobId);
      _sendSSE(res, "complete", { state: current.state, artifacts: artifacts });

      /* Send audit summary as a separate named event */
      const auditSummary = buildAuditSummary(jobId, current.trace_id || current.correlationId, current, artifacts);
      _sendSSE(res, "audit_complete", auditSummary);

      logger.info("sse.audit.sent", {
        component: "jobs-route",
        jobId: jobId,
        data: { artifactCount: artifacts.length },
      });

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

function getJobArtifacts(jobId) {
  return getDb().prepare(`
    SELECT artifacts.id, artifacts.role, assets.mime, assets.sha256, assets.size_bytes, artifacts.placement_json
    FROM artifacts
    JOIN assets ON assets.id = artifacts.asset_id
    WHERE artifacts.job_id = ?
    ORDER BY artifacts.created_at ASC
  `).all(jobId).map(artifact => ({
    id: artifact.id,
    role: artifact.role,
    mimeType: artifact.mime,
    sha256: artifact.sha256,
    sizeBytes: artifact.size_bytes,
    downloadUrl: "/v2/artifacts/" + artifact.id,
    placement: artifact.placement_json ? JSON.parse(artifact.placement_json) : {},
  }));
}

function isJobOwnedBy(req, job, queryParams) {
  const headerClientId = req.headers["x-client-id"];
  const queryClientId = queryParams && queryParams.get("clientId");
  const clientId = headerClientId || queryClientId || "default";
  return job.clientId === clientId;
}

function _sendSSE(res, event, data, id) {
  if (id) res.write("id: " + id + "\n");
  res.write("event: " + event + "\n");
  res.write("data: " + JSON.stringify(data) + "\n\n");
}

/* ═══════════════════════════════════════════════════════════════════
 * GET /v2/jobs/{id}/audit — replay task audit timeline
 * ═══════════════════════════════════════════════════════════════════ */

export async function handleGetJobAudit(req, res, routeParams) {
  const jobId = routeParams.id;
  const job = jobRepo.getById(jobId);
  if (!job || !isJobOwnedBy(req, job)) {
    v2NotFound(res, "JOB_NOT_FOUND", "Job not found: " + jobId);
    return;
  }
  const limit = parseInt(req.url && req.url.indexOf("limit=") !== -1 ? new URLSearchParams(req.url.split("?")[1]).get("limit") : "200", 10) || 200;
  const events = getAuditEvents(jobId, Math.min(limit, 500));
  writeJson(res, 200, {
    jobId: jobId,
    traceId: job.trace_id || job.correlationId,
    state: job.state,
    events: events,
  });

  logger.info("job.audit.served", {
    component: "jobs-route",
    jobId: jobId,
    data: { eventCount: events.length },
  });
}

/* ═══════════════════════════════════════════════════════════════════
 * POST /v2/jobs/{id}/client-events — plugin reports download/placement
 * ═══════════════════════════════════════════════════════════════════ */

export async function handleClientEvent(req, res, routeParams) {
  const jobId = routeParams.id;
  const job = jobRepo.getById(jobId);
  if (!job || !isJobOwnedBy(req, job)) {
    v2NotFound(res, "JOB_NOT_FOUND", "Job not found: " + jobId);
    return;
  }

  const body = await readJsonBody(req, 16 * 1024);
  const allowedEvents = [
    "artifact.download.started", "artifact.download.completed",
    "placement.started", "placement.completed", "placement.failed",
    "placement.acknowledged",
  ];

  const event = body.event;
  if (!event || !allowedEvents.includes(event)) {
    v2BadRequest(res, "REQUEST_SCHEMA_INVALID", "Unknown or disallowed client event: " + (event || ""));
    return;
  }

  const data = body.data || {};
  /* Mark plugin-reported events clearly */
  data.reportedBy = "plugin";

  writeAuditEvent(jobId, job.trace_id || job.correlationId, event, "info", data);

  logger.info("client." + event, {
    component: "jobs-route",
    jobId: jobId,
    traceId: job.trace_id || job.correlationId,
    data: data,
  });

  writeJson(res, 201, { acknowledged: true, event: event });
}
