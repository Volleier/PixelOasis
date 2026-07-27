/* asset-store.js — Asset lifecycle management
 *
 * GatewayOrchestrationDesign §3.2 — files on disk, metadata in SQLite.
 * Asset storage: <data_dir>/assets/<first2chars_of_id>/<id>
 *
 * Dedup: same SHA-256 + client_id → reuse existing asset.
 * TTL: configurable per asset kind (source=24h, artifact=7d).
 */

import { getDb, generateId } from "../persistence/database.js";
import { existsSync, mkdirSync, unlinkSync, copyFileSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import config from "../config.js";
import logger from "../utils/logger.js";

const DEFAULT_TTL_HOURS = 24;
const ARTIFACT_TTL_HOURS = 168; /* 7 days */

/* ═══════════════════════════════════════════════════════════════════
 * getAssetDir(id) → resolved filesystem path
 * ═══════════════════════════════════════════════════════════════════ */

function getAssetDir(id) {
  const dataDir = config.dataDir || "E:/PixelOasisData";
  const prefix = id.substring(0, 2).replace(/[^A-Za-z0-9]/g, "a");
  return resolve(dataDir, "assets", prefix);
}

function getAssetPath(id) {
  return resolve(getAssetDir(id), id);
}

/* ═══════════════════════════════════════════════════════════════════
 * storeAsset(opts) → { id, path, sha256, ... }
 * ═══════════════════════════════════════════════════════════════════ */

export function storeAsset(opts) {
  const db = getDb();

  if (!opts.filePath) throw new Error("filePath is required");

  /* Check for SHA-256 dedup within same client */
  if (opts.sha256 && opts.clientId) {
    const existing = findBySha256(opts.sha256, opts.clientId);
    if (existing) {
      if (opts.moveFile) {
        try { unlinkSync(opts.filePath); } catch (_) { /* best effort temporary-file cleanup */ }
      }
      logger.info("asset.dedup_reused", {
        component: "asset-store",
        data: { sha256: opts.sha256.substring(0, 12), existingId: existing.id },
      });
      return Object.assign({}, existing, { reused: true });
    }
  }

  const id = opts.id || generateId("ast");
  const assetDir = getAssetDir(id);
  const destPath = getAssetPath(id);
  const now = new Date().toISOString();
  const ttlHours = opts.ttlHours || (opts.kind === "artifact" ? ARTIFACT_TTL_HOURS : DEFAULT_TTL_HOURS);
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  /* Ensure directory exists */
  if (!existsSync(assetDir)) {
    mkdirSync(assetDir, { recursive: true });
  }

  /* Copy or move the file */
  try {
    if (opts.moveFile) {
      renameSync(opts.filePath, destPath);
    } else {
      copyFileSync(opts.filePath, destPath);
    }
  } catch (e) {
    /* If rename fails (cross-device), fall back to copy */
    if (opts.moveFile) {
      copyFileSync(opts.filePath, destPath);
      try { unlinkSync(opts.filePath); } catch (_) { /* ignore */ }
    } else {
      throw e;
    }
  }

  /* Compute SHA-256 if not provided */
  let sha256 = opts.sha256;
  if (!sha256) {
    try {
      const fileBuf = readFileSync(destPath);
      sha256 = createHash("sha256").update(fileBuf).digest("hex");
    } catch (e) {
      sha256 = "unknown";
    }
  }

  /* Compute size if not provided */
  let sizeBytes = opts.sizeBytes;
  if (!sizeBytes) {
    try {
      const { size } = require("fs").statSync(destPath);
      sizeBytes = size;
    } catch (e) {
      sizeBytes = 0;
    }
  }

  /* Insert into database */
  db.prepare(`
    INSERT INTO assets (id, client_id, kind, path, mime, width, height, sha256, size_bytes, expires_at, created_at, trace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.clientId || "default",
    opts.kind || "source",
    destPath,
    opts.mime || "image/png",
    opts.width || null,
    opts.height || null,
    sha256,
    sizeBytes,
    expiresAt,
    now,
    opts.traceId || ""
  );

  logger.info("asset.stored", {
    component: "asset-store",
    traceId: opts.traceId,
    data: { id, kind: opts.kind, sha256: sha256.substring(0, 12), sizeBytes, width: opts.width || null, height: opts.height || null },
  });

  return { id, path: destPath, mime: opts.mime || "image/png", sha256, sizeBytes, width: opts.width, height: opts.height, traceId: opts.traceId || "", expiresAt };
}

/* ═══════════════════════════════════════════════════════════════════
 * getAsset(id) → asset record | null
 * ═══════════════════════════════════════════════════════════════════ */

export function getAsset(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM assets WHERE id = ?").get(id);
  if (!row) return null;

  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    _removeAssetRecordAndFile(row);
    return null;
  }

  /* Check if file still exists */
  if (!existsSync(row.path)) {
    logger.warn("asset.file_missing", {
      component: "asset-store",
      data: { id, path: row.path },
    });
    db.prepare("DELETE FROM assets WHERE id = ?").run(id);
    return null;
  }

  return {
    id: row.id,
    clientId: row.client_id,
    kind: row.kind,
    path: row.path,
    mime: row.mime,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    traceId: row.trace_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/* ═══════════════════════════════════════════════════════════════════
 * findBySha256(sha256, clientId) → asset | null
 * ═══════════════════════════════════════════════════════════════════ */

export function findBySha256(sha256, clientId) {
  if (!sha256) return null;
  const db = getDb();
  const row = db.prepare(
    "SELECT id FROM assets WHERE sha256 = ? AND client_id = ? AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 1"
  ).get(sha256, clientId || "default");
  return row ? getAsset(row.id) : null;
}

/* ═══════════════════════════════════════════════════════════════════
 * deleteAsset(id) → boolean
 * ═══════════════════════════════════════════════════════════════════ */

export function deleteAsset(id) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM assets WHERE id = ?").get(id);
  if (!row) return false;
  _removeAssetRecordAndFile(row);
  return true;
}

function _removeAssetRecordAndFile(row) {
  try {
    if (existsSync(row.path)) unlinkSync(row.path);
  } catch (e) {
    logger.warn("asset.delete_file_failed", {
      component: "asset-store",
      error: e,
      data: { id: row.id },
    });
  }
  getDb().prepare("DELETE FROM assets WHERE id = ?").run(row.id);
}

/* ═══════════════════════════════════════════════════════════════════
 * cleanupExpired() → number cleaned up
 * ═══════════════════════════════════════════════════════════════════ */

export function cleanupExpired() {
  const db = getDb();
  const now = new Date().toISOString();

  const expired = db.prepare(
    "SELECT id, path FROM assets WHERE expires_at IS NOT NULL AND expires_at < ?"
  ).all(now);

  let count = 0;
  for (const row of expired) {
    try {
      if (existsSync(row.path)) {
        unlinkSync(row.path);
      }
      db.prepare("DELETE FROM assets WHERE id = ?").run(row.id);
      count++;
    } catch (e) {
      logger.warn("asset.cleanup_failed", {
        component: "asset-store",
        error: e,
        data: { id: row.id },
      });
    }
  }

  if (count > 0) {
    logger.info("asset.cleanup_expired", {
      component: "asset-store",
      data: { count },
    });
  }

  return count;
}

export default { storeAsset, getAsset, findBySha256, deleteAsset, cleanupExpired, getAssetPath, getAssetDir };
