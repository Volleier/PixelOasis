/* 003_trace_observability — Add trace/audit columns for unified logging
 *
 * Adds trace_id to jobs, assets, and job_events tables.
 * Creates job_audit_events for task-level audit retention.
 * Adds width/height to artifacts for image metadata.
 */

/* ── jobs: add trace_id ── */
ALTER TABLE jobs ADD COLUMN trace_id TEXT NOT NULL DEFAULT '';

/* Backfill: derive trace_id from correlation_id or generate legacy ID */
UPDATE jobs SET trace_id = COALESCE(
  NULLIF(correlation_id, ''),
  'legacy_' || id
) WHERE trace_id = '';

CREATE INDEX IF NOT EXISTS idx_jobs_trace_id ON jobs(trace_id);

/* ── assets: add trace_id ── */
ALTER TABLE assets ADD COLUMN trace_id TEXT NOT NULL DEFAULT '';

/* ── job_events: add trace_id ── */
ALTER TABLE job_events ADD COLUMN trace_id TEXT NOT NULL DEFAULT '';

/* ── artifacts: add width and height ── */
ALTER TABLE artifacts ADD COLUMN width INTEGER;
ALTER TABLE artifacts ADD COLUMN height INTEGER;

/* ── job_audit_events: task-level audit for Photoshop replay ── */
CREATE TABLE IF NOT EXISTS job_audit_events (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL,
  trace_id      TEXT NOT NULL,
  event         TEXT NOT NULL,
  level         TEXT NOT NULL DEFAULT 'info',
  payload_json  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_job_audit_events_job_id ON job_audit_events(job_id);
CREATE INDEX IF NOT EXISTS idx_job_audit_events_trace_id ON job_audit_events(trace_id);
