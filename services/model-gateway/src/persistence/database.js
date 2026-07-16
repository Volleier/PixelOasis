/* database.js — SQLite database singleton with WAL mode and migration support
 *
 * GatewayOrchestrationDesign §5.3 — persistence layer.
 * Uses better-sqlite3 synchronous API (appropriate for single-user local gateway).
 */

import Database from "better-sqlite3";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../utils/logger.js";
import config from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db = null;

/* ── Get database instance (creates on first call) ── */
export function getDb() {
  if (_db) return _db;

  const dataDir = config.dataDir || config.sqliteDir || "E:/PixelOasisData";
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = config.sqlitePath || resolve(dataDir, "gateway.sqlite");
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  logger.info("database.opening", {
    component: "database",
    data: { path: dbPath },
  });

  _db = new Database(dbPath);

  /* Performance and safety settings */
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("busy_timeout = 5000");
  _db.pragma("cache_size = -64000"); /* 64 MB cache */

  /* Run migrations */
  runMigrations();

  logger.info("database.ready", {
    component: "database",
    data: { path: dbPath, wal: true },
  });

  return _db;
}

/* ── Close database ── */
export function closeDb() {
  if (_db) {
    try { _db.close(); } catch (e) { /* ignore */ }
    _db = null;
    logger.info("database.closed", { component: "database" });
  }
}

/* ── Run all pending migrations ── */
export function runMigrations() {
  const db = getDb();

  /* Ensure migrations tracking table exists */
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const migrationsDir = resolve(__dirname, "migrations");
  if (!existsSync(migrationsDir)) {
    logger.warn("database.no_migrations_dir", {
      component: "database",
      data: { dir: migrationsDir },
    });
    return;
  }

  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort(); /* 001_xxx.sql, 002_xxx.sql, ... */

  const applied = new Set(
    db.prepare("SELECT name FROM _migrations").all().map(r => r.name)
  );

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(migrationsDir, file), "utf8");
    logger.info("database.migration_running", {
      component: "database",
      data: { file },
    });

    db.exec(sql);
    db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    count++;

    logger.info("database.migration_applied", {
      component: "database",
      data: { file },
    });
  }

  if (count > 0) {
    logger.info("database.migrations_complete", {
      component: "database",
      data: { applied: count },
    });
  }
}

/* ── Generate ULID ── */
export function generateId(prefix) {
  const ts = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 0x100000000).toString(36).padStart(8, "0");
  return (prefix || "id") + "_" + ts + rnd;
}

export default { getDb, closeDb, runMigrations, generateId };
