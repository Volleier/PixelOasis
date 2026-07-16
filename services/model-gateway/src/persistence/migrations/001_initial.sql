/* 001_initial.sql — Gateway v2 initial schema
 *
 * Tables: jobs, job_stages, job_events, assets, artifacts
 * Per GatewayOrchestrationDesign §5.3
 */

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  capability_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  profile TEXT,
  params_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS job_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempt INTEGER NOT NULL DEFAULT 0,
  input_json TEXT,
  output_json TEXT,
  error_json TEXT,
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS job_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'image/png',
  width INTEGER,
  height INTEGER,
  sha256 TEXT,
  size_bytes INTEGER,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  placement_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

/* Indexes */
CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
CREATE INDEX IF NOT EXISTS idx_jobs_idempotency ON jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_job_stages_job ON job_stages(job_id);
CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id);
CREATE INDEX IF NOT EXISTS idx_assets_sha256 ON assets(sha256);
CREATE INDEX IF NOT EXISTS idx_assets_client ON assets(client_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts(job_id);
