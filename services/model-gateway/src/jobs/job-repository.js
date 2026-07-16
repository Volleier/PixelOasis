/* job-repository.js — Job CRUD on SQLite
 *
 * GatewayOrchestrationDesign §5.3: jobs + job_stages tables.
 *
 * All state changes go through the state machine validator.
 * Events are auto-recorded on state change.
 * Parameters stored as sanitized JSON (no base64, no full prompt).
 */

import { getDb, generateId } from "../persistence/database.js";
import { transition, isTerminal, isActive } from "./state-machine.js";
import { recordEvent } from "./event-repository.js";
import logger from "../utils/logger.js";

const JOB_TTL_HOURS = { succeeded: 168, failed: 24, canceled: 24 }; /* 7d / 24h */
const DEFAULT_TTL_HOURS = 24;

/* ═══════════════════════════════════════════════════════════════════
 * create(jobData) → job record
 * ═══════════════════════════════════════════════════════════════════ */

export function create(jobData) {
  const db = getDb();
  const id = jobData.id || generateId("job");
  const now = new Date().toISOString();
  const ttlHours = jobData.ttlHours || DEFAULT_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  const paramsJson = jobData.params ? JSON.stringify(jobData.params) : null;

  db.prepare(`
    INSERT INTO jobs (id, client_id, correlation_id, idempotency_key, capability_id, state, profile, params_json, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    jobData.clientId || "default",
    jobData.correlationId || "",
    jobData.idempotencyKey || null,
    jobData.capabilityId || "unknown",
    "queued",
    jobData.profile || "quality_16gb",
    paramsJson,
    now,
    now,
    expiresAt
  );

  /* Record creation event */
  recordEvent(id, "job_created", {
    capabilityId: jobData.capabilityId,
    clientId: jobData.clientId,
  });

  logger.info("job.created", {
    component: "job-repository",
    data: { jobId: id, capabilityId: jobData.capabilityId },
  });

  return getById(id);
}

/* ═══════════════════════════════════════════════════════════════════
 * getById(id) → job record with stages
 * ═══════════════════════════════════════════════════════════════════ */

export function getById(id) {
  const db = getDb();

  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  if (!job) return null;

  const stages = db.prepare(
    "SELECT * FROM job_stages WHERE job_id = ? ORDER BY ordinal ASC"
  ).all(id);

  return {
    id: job.id,
    clientId: job.client_id,
    correlationId: job.correlation_id,
    idempotencyKey: job.idempotency_key,
    capabilityId: job.capability_id,
    state: job.state,
    profile: job.profile,
    params: job.params_json ? JSON.parse(job.params_json) : null,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    expiresAt: job.expires_at,
    stages: (stages || []).map(s => ({
      id: s.id,
      name: s.name,
      ordinal: s.ordinal,
      state: s.state,
      attempt: s.attempt,
      input: s.input_json ? JSON.parse(s.input_json) : null,
      output: s.output_json ? JSON.parse(s.output_json) : null,
      error: s.error_json ? JSON.parse(s.error_json) : null,
      startedAt: s.started_at,
      endedAt: s.ended_at,
    })),
  };
}

/* ═══════════════════════════════════════════════════════════════════
 * findByIdempotencyKey(key) → job | null
 * ═══════════════════════════════════════════════════════════════════ */

export function findByIdempotencyKey(key) {
  if (!key) return null;
  const db = getDb();
  const job = db.prepare(
    "SELECT id FROM jobs WHERE idempotency_key = ?"
  ).get(key);
  return job ? getById(job.id) : null;
}

/* ═══════════════════════════════════════════════════════════════════
 * updateState(id, newState, opts) → job record
 * ═══════════════════════════════════════════════════════════════════ */

export function updateState(id, newState, opts) {
  opts = opts || {};
  const db = getDb();

  const current = db.prepare("SELECT state FROM jobs WHERE id = ?").get(id);
  if (!current) throw new Error("Job not found: " + id);

  /* Validate transition */
  const result = transition(current.state, newState);
  if (!result.allowed) {
    const err = new Error(result.error);
    err.code = "INVALID_STATE_TRANSITION";
    throw err;
  }

  const now = new Date().toISOString();
  const updates = { state: newState, updated_at: now };

  /* Update TTL for terminal states */
  if (isTerminal(newState) && !isTerminal(current.state)) {
    const ttlHours = JOB_TTL_HOURS[newState] || DEFAULT_TTL_HOURS;
    updates.expires_at = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  }

  /* Build SET clause */
  const setClauses = [];
  const values = [];
  for (const [col, val] of Object.entries(updates)) {
    setClauses.push(col + " = ?");
    values.push(val);
  }
  values.push(id);

  db.prepare("UPDATE jobs SET " + setClauses.join(", ") + " WHERE id = ?").run(...values);

  /* Record state change event */
  const eventPayload = {
    prevState: current.state,
    newState,
    ...(opts.progress !== undefined ? { progress: opts.progress } : {}),
    ...(opts.message ? { message: opts.message } : {}),
  };
  recordEvent(id, "state_change", eventPayload);

  logger.info("job.state_changed", {
    component: "job-repository",
    data: { jobId: id, from: current.state, to: newState },
  });

  return getById(id);
}

/* ═══════════════════════════════════════════════════════════════════
 * listByClient(clientId, state) → [job]
 * ═══════════════════════════════════════════════════════════════════ */

export function listByClient(clientId, state) {
  const db = getDb();
  let sql = "SELECT id FROM jobs WHERE client_id = ?";
  const params = [clientId];

  if (state) {
    sql += " AND state = ?";
    params.push(state);
  }

  sql += " ORDER BY created_at DESC";
  const rows = db.prepare(sql).all(...params);
  return rows.map(r => getById(r.id)).filter(Boolean);
}

/* ═══════════════════════════════════════════════════════════════════
 * getActive() → [job] — all non-terminal jobs
 * ═══════════════════════════════════════════════════════════════════ */

export function getActive() {
  const db = getDb();
  const terminalStates = ["succeeded", "failed", "canceled"];
  const placeholders = terminalStates.map(() => "?").join(", ");
  const rows = db.prepare(
    "SELECT id FROM jobs WHERE state NOT IN (" + placeholders + ") ORDER BY created_at ASC"
  ).all(...terminalStates);
  return rows.map(r => getById(r.id)).filter(Boolean);
}

/* ═══════════════════════════════════════════════════════════════════
 * getRecoverable(clientId) → [job] — active jobs for a client
 * ═══════════════════════════════════════════════════════════════════ */

export function getRecoverable(clientId) {
  const db = getDb();
  const terminalStates = ["succeeded", "failed", "canceled"];
  const placeholders = terminalStates.map(() => "?").join(", ");
  const rows = db.prepare(
    "SELECT id FROM jobs WHERE client_id = ? AND state NOT IN (" + placeholders + ") ORDER BY created_at ASC"
  ).all(clientId, ...terminalStates);
  return rows.map(r => getById(r.id)).filter(Boolean);
}

/* ═══════════════════════════════════════════════════════════════════
 * addStage(jobId, stageData) → stage record
 * ═══════════════════════════════════════════════════════════════════ */

export function addStage(jobId, stageData) {
  const db = getDb();
  const now = new Date().toISOString();

  const inputJson = stageData.input ? JSON.stringify(stageData.input) : null;

  const result = db.prepare(`
    INSERT INTO job_stages (job_id, name, ordinal, state, attempt, input_json, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId,
    stageData.name,
    stageData.ordinal || 0,
    "pending",
    stageData.attempt || 0,
    inputJson,
    now
  );

  recordEvent(jobId, "stage_created", {
    stageId: result.lastInsertRowid,
    name: stageData.name,
    ordinal: stageData.ordinal,
  });

  return { id: result.lastInsertRowid, ...stageData };
}

/* ═══════════════════════════════════════════════════════════════════
 * updateStage(stageId, data) → boolean
 * ═══════════════════════════════════════════════════════════════════ */

export function updateStage(stageId, data) {
  const db = getDb();

  const setClauses = [];
  const values = [];

  if (data.state !== undefined) {
    setClauses.push("state = ?");
    values.push(data.state);
  }
  if (data.output !== undefined) {
    setClauses.push("output_json = ?");
    values.push(JSON.stringify(data.output));
  }
  if (data.error !== undefined) {
    setClauses.push("error_json = ?");
    values.push(JSON.stringify(data.error));
  }
  if (data.attempt !== undefined) {
    setClauses.push("attempt = ?");
    values.push(data.attempt);
  }
  if (data.endedAt !== undefined) {
    setClauses.push("ended_at = ?");
    values.push(data.endedAt);
  }

  if (setClauses.length === 0) return false;

  values.push(stageId);
  db.prepare("UPDATE job_stages SET " + setClauses.join(", ") + " WHERE id = ?").run(...values);
  return true;
}

/* ═══════════════════════════════════════════════════════════════════
 * deleteJob(id) → boolean
 * ═══════════════════════════════════════════════════════════════════ */

export function deleteJob(id) {
  const db = getDb();
  const result = db.prepare("DELETE FROM jobs WHERE id = ?").run(id);
  return result.changes > 0;
}

/* ═══════════════════════════════════════════════════════════════════
 * cleanupExpired() → number of jobs cleaned up
 * ═══════════════════════════════════════════════════════════════════ */

export function cleanupExpired() {
  const db = getDb();
  const now = new Date().toISOString();

  /* Find expired jobs */
  const expired = db.prepare(
    "SELECT id FROM jobs WHERE expires_at IS NOT NULL AND expires_at < ?"
  ).all(now);

  if (expired.length === 0) return 0;

  /* Delete (cascade removes stages, events, artifacts) */
  const ids = expired.map(r => r.id);
  const placeholders = ids.map(() => "?").join(", ");
  const result = db.prepare(
    "DELETE FROM jobs WHERE id IN (" + placeholders + ")"
  ).run(...ids);

  logger.info("job.cleanup_expired", {
    component: "job-repository",
    data: { count: result.changes },
  });

  return result.changes;
}

export default { create, getById, findByIdempotencyKey, updateState, listByClient, getActive, getRecoverable, addStage, updateStage, deleteJob, cleanupExpired };
