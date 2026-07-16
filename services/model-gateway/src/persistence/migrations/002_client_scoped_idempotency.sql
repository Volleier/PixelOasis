/* Idempotency keys identify a submission within one plugin client.
 * The initial schema made them globally unique, which incorrectly caused a
 * second local client with the same key to fail at INSERT time. */

PRAGMA foreign_keys = OFF;

CREATE TABLE jobs_rebuilt (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT,
  capability_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  profile TEXT,
  params_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);

INSERT INTO jobs_rebuilt (
  id, client_id, correlation_id, idempotency_key, capability_id, state,
  profile, params_json, created_at, updated_at, expires_at
)
SELECT
  id, client_id, correlation_id, idempotency_key, capability_id, state,
  profile, params_json, created_at, updated_at, expires_at
FROM jobs;

DROP TABLE jobs;
ALTER TABLE jobs_rebuilt RENAME TO jobs;

CREATE INDEX idx_jobs_client ON jobs(client_id);
CREATE INDEX idx_jobs_state ON jobs(state);
CREATE UNIQUE INDEX idx_jobs_client_idempotency
  ON jobs(client_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

PRAGMA foreign_keys = ON;
