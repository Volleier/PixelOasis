/* audit-repository.js — Task-level audit persistence
 *
 * Persists structured audit events per job. NOT a second file log —
 * these go into SQLite (job_audit_events table) and are served back
 * to Photoshop via SSE audit_complete and GET /v2/jobs/{id}/audit.
 *
 * Limits:
 *   - Max 500 events per job
 *   - Single payload max 16 KB
 *   - Exceeding either writes audit.truncated and stops
 */

import { getDb, generateId } from "../persistence/database.js";
import logger from "../utils/logger.js";

const MAX_EVENTS_PER_JOB = 500;
const MAX_PAYLOAD_BYTES = 16 * 1024; /* 16 KB */

/* ── Write an audit event ── */
export function writeAuditEvent(jobId, traceId, event, level, payload) {
  const db = getDb();

  /* Check count */
  const count = db.prepare(
    "SELECT COUNT(*) as cnt FROM job_audit_events WHERE job_id = ?"
  ).get(jobId);

  if (count && count.cnt >= MAX_EVENTS_PER_JOB) {
    if (count.cnt === MAX_EVENTS_PER_JOB) {
      /* Write truncation marker exactly once */
      db.prepare(`
        INSERT INTO job_audit_events (id, job_id, trace_id, event, level, payload_json, created_at)
        VALUES (?, ?, ?, 'audit.truncated', 'warn', ?, datetime('now'))
      `).run(generateId("aev"), jobId, traceId || "", JSON.stringify({ reason: "max events reached", limit: MAX_EVENTS_PER_JOB }));
    }
    return;
  }

  /* Limit payload size */
  let payloadStr = null;
  if (payload) {
    try {
      payloadStr = JSON.stringify(payload);
      if (payloadStr.length > MAX_PAYLOAD_BYTES) {
        payloadStr = JSON.stringify({ _truncated: true, originalBytes: payloadStr.length });
      }
    } catch (_) {
      payloadStr = JSON.stringify({ _serializeError: true });
    }
  }

  db.prepare(`
    INSERT INTO job_audit_events (id, job_id, trace_id, event, level, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(generateId("aev"), jobId, traceId || "", event, level || "info", payloadStr);
}

/* ── Get all audit events for a job ── */
export function getAuditEvents(jobId, limit) {
  const db = getDb();
  const rows = db.prepare(
    "SELECT id, event, level, payload_json, created_at FROM job_audit_events WHERE job_id = ? ORDER BY created_at ASC LIMIT ?"
  ).all(jobId, limit || MAX_EVENTS_PER_JOB);

  return rows.map(function (row) {
    let payload = null;
    if (row.payload_json) {
      try { payload = JSON.parse(row.payload_json); } catch (_) { /* ignore */ }
    }
    return {
      id: row.id,
      event: row.event,
      level: row.level,
      payload: payload,
      createdAt: row.created_at,
    };
  });
}

/* ── Build audit summary for SSE ── */
export function buildAuditSummary(jobId, traceId, job, artifacts) {
  const db = getDb();
  const eventCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM job_audit_events WHERE job_id = ?"
  ).get(jobId);

  return {
    traceId: traceId || (job ? job.correlationId : null),
    jobId: jobId,
    state: job ? job.state : "unknown",
    eventCount: eventCount ? eventCount.cnt : 0,
    artifacts: (artifacts || []).map(function (a) {
      return {
        id: a.id,
        role: a.role,
        mimeType: a.mime,
        sha256Prefix: a.sha256 ? a.sha256.substring(0, 12) : null,
        sizeBytes: a.sizeBytes,
        width: a.width,
        height: a.height,
        previewOnly: a.previewOnly || false,
      };
    }),
  };
}

export default { writeAuditEvent, getAuditEvents, buildAuditSummary };
