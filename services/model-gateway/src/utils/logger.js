/* logger.js — Model Gateway JSONL logger
 *
 * Writes structured log entries to <config.logging.dir>/gateway-YYYY-MM-DD.jsonl.
 * One JSON object per line.  Never logs base64 image data.
 *
 * API:
 *   import logger from "./utils/logger.js";
 *   logger.debug(event, opts)
 *   logger.info(event, opts)
 *   logger.warn(event, opts)
 *   logger.error(event, opts)
 *
 *   opts: { component, correlationId, workflowId, durationMs, data, error, message }
 */

import fs from "node:fs";
import path from "node:path";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LEVEL_NAMES = ["debug", "info", "warn", "error"];

/* ── Config reference (set by init) ── */
let config = {
  enabled: true,
  level: "info",
  dir: "logs",
  maxFileBytes: 5 * 1024 * 1024,
  retainFiles: 10,
  logPromptText: false,
};

/* ── Sensitive field filter ── */
const SENSITIVE_KEYS = [
  "imagePngBase64",
  "maskPngBase64",
  "previewJpegBase64",
  "imageBase64",
  "base64",
  "pngBytes",
  "pixelData",
  "rawData",
  "imageData",
  "imageBuffer",
];

function stripSensitive(obj, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 10) return "[max depth]";
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(function (v) { return stripSensitive(v, depth + 1); });

  const out = {};
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (SENSITIVE_KEYS.indexOf(k) !== -1) {
      out[k] = "[redacted, length=" + (typeof obj[k] === "string" ? obj[k].length : "?") + "]";
    } else if (typeof obj[k] === "object" && obj[k] !== null) {
      out[k] = stripSensitive(obj[k], depth + 1);
    } else {
      out[k] = obj[k];
    }
  }
  return out;
}

/* ── Prompt privacy ── */
function sanitizePrompt(data) {
  if (!data || typeof data !== "object") return data;
  const out = {};
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k === "prompt" || k === "positivePrompt" || k === "negativePrompt") {
      const text = String(data[k] || "");
      if (config.logPromptText) {
        out[k] = text;
      } else {
        out[k + "Length"] = text.length;
      }
    } else if (typeof data[k] === "object" && data[k] !== null) {
      out[k] = sanitizePrompt(data[k]);
    } else {
      out[k] = data[k];
    }
  }
  return out;
}

/* ── Format error ── */
function formatError(err) {
  if (!err) return undefined;
  if (typeof err === "string") return { message: err };
  return {
    message: err.message || String(err),
    code: err.code || undefined,
    status: err.status || undefined,
    stack: err.stack ? String(err.stack).split("\n").slice(0, 5).map(function (s) { return s.trim(); }) : undefined,
  };
}

/* ── Ensure log directory exists ── */
let logDirEnsured = false;

function ensureLogDir() {
  if (logDirEnsured) return;
  const dirPath = path.resolve(config.dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  logDirEnsured = true;
}

/* ── Get today's log file path ── */
function getLogFilePath() {
  const today = new Date().toISOString().slice(0, 10);
  return path.resolve(config.dir, "gateway-" + today + ".jsonl");
}

/* ── Check rotation ── */
function checkRotation(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > config.maxFileBytes) {
      /* Rotate: rename current to .<timestamp> */
      const ts = Date.now();
      const rotated = filePath.replace(/\.jsonl$/, "." + ts + ".jsonl");
      fs.renameSync(filePath, rotated);

      /* Clean old rotated files */
      const dirPath = path.dirname(filePath);
      const files = fs.readdirSync(dirPath)
        .filter(function (f) { return /^gateway-.*\.jsonl$/.test(f); })
        .map(function (f) { return path.join(dirPath, f); })
        .sort(function (a, b) {
          return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
        });

      /* Delete excess */
      for (let i = config.retainFiles; i < files.length; i++) {
        try { fs.unlinkSync(files[i]); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) {
    /* File doesn't exist yet — fine */
  }
}

/* ── Core write ── */
function log(level, event, opts) {
  if (!config.enabled) return;

  const threshold = LEVELS[config.level] || LEVELS.info;
  if ((LEVELS[level] || 20) < threshold) return;

  opts = opts || {};

  try {
    ensureLogDir();
    const filePath = getLogFilePath();
    checkRotation(filePath);

    const entry = {
      ts: new Date().toISOString(),
      level: level,
      source: "gateway",
      component: opts.component || "unknown",
      event: event,
      correlationId: opts.correlationId || undefined,
      workflowId: opts.workflowId || undefined,
      durationMs: typeof opts.durationMs === "number" ? opts.durationMs : undefined,
      message: opts.message || undefined,
    };

    /* Attach sanitized data */
    if (opts.data) {
      const cleaned = stripSensitive(opts.data);
      entry.data = sanitizePrompt(cleaned);
    }

    /* Attach error info */
    if (opts.error) {
      entry.error = formatError(opts.error);
    }

    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(filePath, line, "utf8");
  } catch (e) {
    /* Last resort: console.error so the gateway process can show it */
    console.error("[logger] write failed:", e.message);
  }
}

/* ── Init with config ── */
function init(cfg) {
  if (cfg) {
    config = Object.assign(config, cfg.logging || cfg);
  }
  logDirEnsured = false;
}

/* ── Public API ── */

function debug(event, opts) { log("debug", event, opts); }
function info(event, opts) { log("info", event, opts); }
function warn(event, opts) { log("warn", event, opts); }
function errorLog(event, opts) { log("error", event, opts); }

export default {
  debug: debug,
  info: info,
  warn: warn,
  error: errorLog,
  init: init,
  LEVELS: LEVELS,
};
