/* logger.js — PixelOasis Gateway unified .log writer
 *
 * One .log file per gateway run: logs/pixeloasis-logs-YYYY-MM-DD-HH-mm-ss.log
 * No rotation, no second file during the same run.
 * All writes go through a serial promise queue for line integrity.
 *
 * API:
 *   import logger from "./utils/logger.js";
 *   logger.init(config)          → writes gateway.run_started, returns runId
 *   logger.close()               → writes gateway.run_stopped, flushes queue
 *   logger.debug(event, opts)
 *   logger.info(event, opts)
 *   logger.warn(event, opts)
 *   logger.error(event, opts)
 *   logger.forTrace(traceCtx)    → returns bound logger with preset fields
 *
 *   opts: { component, traceId, correlationId, jobId, promptId, workflowId,
 *           durationMs, httpStatus, data, error, message, asset }
 */

import fs from "node:fs";
import path from "node:path";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/* ── Mutable state ── */
let config = {
  enabled: true,
  level: "info",
  dir: "logs",
  retainRuns: 14,
  warnFileSizeMb: 256,
  logPromptText: false,
};

let runId = null;
let runStartedAt = null;
let logFilePath = null;
let writeQueue = Promise.resolve();
let lineCount = 0;
let errorCount = 0;
let closed = false;

/* ── Sensitive field filter ── */
const SENSITIVE_KEYS = [
  "imagePngBase64", "maskPngBase64", "previewJpegBase64",
  "imageBase64", "base64", "pngBytes", "pixelData",
  "rawData", "imageData", "imageBuffer", "workflow",
];

const BINARY_TYPES = ["Buffer", "ArrayBuffer", "Uint8Array"];

function stripSensitive(obj, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 10) return "[max depth]";
  if (!obj || typeof obj !== "object") return obj;
  /* Detect binary types */
  if (obj.type === "Buffer" || ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) {
    return "[binary, length=" + (obj.byteLength || obj.length || "?") + "]";
  }
  if (Array.isArray(obj)) return obj.map(function (v) { return stripSensitive(v, depth + 1); });

  const out = {};
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (SENSITIVE_KEYS.indexOf(k) !== -1) {
      out[k] = "[redacted, length=" + (typeof obj[k] === "string" ? obj[k].length : "?") + "]";
    } else if (k === "details" && typeof obj[k] === "string") {
      out[k] = obj[k].length > 256 ? obj[k].substring(0, 256) + "…" : obj[k];
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
      if (config.logPromptText) {
        out[k] = String(data[k] || "");
      } else {
        out[k + "Length"] = String(data[k] || "").length;
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

/* ── ensure log directory ── */
let logDirEnsured = false;
function ensureLogDir() {
  if (logDirEnsured) return;
  const dirPath = path.resolve(config.dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  logDirEnsured = true;
}

/* ── Startup: prune old .log files ── */
function pruneOldLogs() {
  try {
    const dirPath = path.resolve(config.dir);
    if (!fs.existsSync(dirPath)) return;
    const files = fs.readdirSync(dirPath)
      .filter(function (f) { return /^pixeloasis-logs-.*\.log$/.test(f); })
      .map(function (f) {
        const full = path.join(dirPath, f);
        try { return { path: full, mtime: fs.statSync(full).mtimeMs }; } catch (_) { return null; }
      })
      .filter(Boolean)
      .sort(function (a, b) { return b.mtime - a.mtime; });

    const retain = config.retainRuns || 14;
    for (let i = retain; i < files.length; i++) {
      try { fs.unlinkSync(files[i].path); } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
}

/* ── Size warning check ── */
function checkSizeWarning() {
  try {
    const stat = fs.statSync(logFilePath);
    const warnBytes = (config.warnFileSizeMb || 256) * 1024 * 1024;
    if (stat.size > warnBytes) {
      /* Write once per run per threshold crossing */
      if (!checkSizeWarning._warned) {
        checkSizeWarning._warned = true;
        log("warn", "logging.size_warning", {
          component: "logger",
          data: { currentSizeMb: (stat.size / 1024 / 1024).toFixed(1), thresholdMb: config.warnFileSizeMb || 256 },
        });
      }
    }
  } catch (_) { /* ignore */ }
}
checkSizeWarning._warned = false;

/* ── Core write (appends to queue) ── */
function enqueueWrite(line) {
  writeQueue = writeQueue.then(function () {
    return new Promise(function (resolve) {
      try {
        fs.appendFileSync(logFilePath, line, "utf8");
        lineCount++;
        checkSizeWarning();
      } catch (e) {
        errorCount++;
        console.error("[logger] write failed:", e.message);
      }
      resolve();
    });
  });
  return writeQueue;
}

function log(level, event, opts) {
  if (!config.enabled || closed) return;

  const threshold = LEVELS[config.level] || LEVELS.info;
  if ((LEVELS[level] || 20) < threshold) return;

  opts = opts || {};

  try {
    ensureLogDir();
    if (!logFilePath) return; /* init() not called yet */

    const entry = {
      ts: new Date().toISOString(),
      runId: runId,
      level: level,
      source: "gateway",
      component: opts.component || "unknown",
      event: event,
    };

    /* Standard trace fields */
    if (opts.traceId) entry.traceId = opts.traceId;
    if (opts.correlationId) entry.correlationId = opts.correlationId;
    if (opts.jobId) entry.jobId = opts.jobId;
    if (opts.promptId) entry.promptId = opts.promptId;
    if (opts.workflowId) entry.workflowId = opts.workflowId;
    if (typeof opts.durationMs === "number") entry.durationMs = opts.durationMs;
    if (typeof opts.httpStatus === "number") entry.httpStatus = opts.httpStatus;
    if (opts.message) entry.message = opts.message;

    /* Asset metadata */
    if (opts.asset) {
      entry.asset = stripSensitive(opts.asset);
    }

    /* Sanitized data */
    if (opts.data) {
      const cleaned = stripSensitive(opts.data);
      entry.data = sanitizePrompt(cleaned);
    }

    /* Error */
    if (opts.error) {
      entry.error = formatError(opts.error);
    }

    const line = JSON.stringify(entry) + "\n";
    enqueueWrite(line);
  } catch (e) {
    console.error("[logger] log construction failed:", e.message);
  }
}

/* ── Init: write startup event, return runId ── */
function init(cfg) {
  if (cfg) {
    if (cfg.logging) {
      config = Object.assign(config, cfg.logging);
    } else if (cfg.retainRuns !== undefined || cfg.level !== undefined) {
      config = Object.assign(config, cfg);
    }
  }

  /* Generate run metadata */
  const now = new Date();
  runStartedAt = now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0") + "-" +
    String(now.getHours()).padStart(2, "0") + "-" +
    String(now.getMinutes()).padStart(2, "0") + "-" +
    String(now.getSeconds()).padStart(2, "0");
  runId = "run_" + now.getTime().toString(36);

  logDirEnsured = false;
  checkSizeWarning._warned = false;
  closed = false;
  lineCount = 0;
  errorCount = 0;

  /* Set log file path once */
  ensureLogDir();
  logFilePath = path.resolve(config.dir, "pixeloasis-logs-" + runStartedAt + ".log");

  /* Prune old logs */
  pruneOldLogs();

  /* Write startup event */
  const entry = {
    ts: new Date().toISOString(),
    runId: runId,
    level: "info",
    source: "gateway",
    component: "logger",
    event: "gateway.run_started",
    data: {
      version: "0.2.0",
      pid: process.pid,
      nodeVersion: process.version,
      host: cfg && cfg.host ? cfg.host : "127.0.0.1",
      port: cfg && cfg.port ? cfg.port : 8787,
      logFile: path.basename(logFilePath),
      retainRuns: config.retainRuns,
    },
  };

  try {
    fs.appendFileSync(logFilePath, JSON.stringify(entry) + "\n", "utf8");
    lineCount++;
  } catch (e) {
    console.error("[logger] init write failed:", e.message);
  }

  return runId;
}

/* ── Close: flush queue, write stop event ── */
async function close() {
  if (closed) return;
  closed = true;

  /* Wait for pending writes */
  try {
    await writeQueue;
  } catch (_) { /* ignore */ }

  if (!logFilePath) return;

  const stopEntry = {
    ts: new Date().toISOString(),
    runId: runId,
    level: "info",
    source: "gateway",
    component: "logger",
    event: "gateway.run_stopped",
    data: {
      runId: runId,
      totalLines: lineCount,
      writeErrors: errorCount,
      uptimeSeconds: runStartedAt ? Math.round((Date.now() - new Date(runStartedAt.replace(/-/g, "/")).getTime()) / 1000) : 0,
    },
  };

  try {
    fs.appendFileSync(logFilePath, JSON.stringify(stopEntry) + "\n", "utf8");
  } catch (e) {
    console.error("[logger] close write failed:", e.message);
  }

  logFilePath = null;
}

/* ── Convenience: bound logger with preset trace fields ── */
function forTrace(traceCtx) {
  if (!traceCtx) return { debug: _noop, info: _noop, warn: _noop, error: _noop };

  var defaults = {
    traceId: traceCtx.traceId || traceCtx.correlationId,
    correlationId: traceCtx.correlationId || traceCtx.traceId,
    jobId: traceCtx.jobId,
    promptId: traceCtx.promptId,
  };

  return {
    debug: function (event, opts) { debug(event, Object.assign({}, defaults, opts || {})); },
    info:  function (event, opts) { info(event,  Object.assign({}, defaults, opts || {})); },
    warn:  function (event, opts) { warn(event,  Object.assign({}, defaults, opts || {})); },
    error: function (event, opts) { errorLog(event, Object.assign({}, defaults, opts || {})); },
  };
}

function _noop() {}

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
  close: close,
  forTrace: forTrace,
  getRunId: function () { return runId; },
  LEVELS: LEVELS,
};
