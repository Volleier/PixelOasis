/* event-repository.js — Job event log for SSE replay
 *
 * GatewayOrchestrationDesign §5.3: job_events table.
 *
 * Events are append-only.  The sequence number (auto-increment) provides
 * ordering for SSE Last-Event-ID replay.
 */

import { getDb } from "../persistence/database.js";
import logger from "../utils/logger.js";

/* ═══════════════════════════════════════════════════════════════════
 * recordEvent(jobId, type, payload) → sequence number
 * ═══════════════════════════════════════════════════════════════════ */

export function recordEvent(jobId, type, payload, traceId) {
  const db = getDb();
  const payloadJson = payload ? JSON.stringify(payload) : null;

  const result = db.prepare(`
    INSERT INTO job_events (job_id, type, payload_json, trace_id)
    VALUES (?, ?, ?, ?)
  `).run(jobId, type, payloadJson, traceId || "");

  return result.lastInsertRowid;
}

/* ═══════════════════════════════════════════════════════════════════
 * getEvents(jobId, sinceSeq) → [{ seq, type, payload, created_at }]
 * ═══════════════════════════════════════════════════════════════════ */

export function getEvents(jobId, sinceSeq) {
  const db = getDb();
  const since = sinceSeq || 0;

  const rows = db.prepare(`
    SELECT seq, type, payload_json, created_at
    FROM job_events
    WHERE job_id = ? AND seq > ?
    ORDER BY seq ASC
  `).all(jobId, since);

  return rows.map(r => ({
    seq: r.seq,
    type: r.type,
    payload: r.payload_json ? JSON.parse(r.payload_json) : null,
    createdAt: r.created_at,
  }));
}

/* ═══════════════════════════════════════════════════════════════════
 * getLatestSequence(jobId) → number
 * ═══════════════════════════════════════════════════════════════════ */

export function getLatestSequence(jobId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT MAX(seq) as max_seq FROM job_events WHERE job_id = ?
  `).get(jobId);
  return row ? (row.max_seq || 0) : 0;
}

/* ═══════════════════════════════════════════════════════════════════
 * deleteEvents(jobId) — cleanup on job deletion
 * ═══════════════════════════════════════════════════════════════════ */

export function deleteEvents(jobId) {
  const db = getDb();
  const result = db.prepare("DELETE FROM job_events WHERE job_id = ?").run(jobId);
  return result.changes;
}

export default { recordEvent, getEvents, getLatestSequence, deleteEvents };
