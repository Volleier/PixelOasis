/* logger.js — PixelOasis plugin-side JSONL logger
 *
 * Writes structured log entries to <UXP data folder>/logs/pixeloasis-logs-YYYY-MM-DD-HH-mm-ss.jsonl.
 * One JSON object per line.  Never logs base64 image data.
 *
 * API:
 *   window.PO.Logger.debug(event, opts)
 *   window.PO.Logger.info(event, opts)
 *   window.PO.Logger.warn(event, opts)
 *   window.PO.Logger.error(event, opts)
 *
 *   opts: { component, correlationId, workflowId, durationMs, data, error }
 *
 * Config (in window.PO.state.logging):
 *   enabled       — master switch
 *   level         — "debug" | "info" | "warn" | "error"
 *   maxFileBytes  — max bytes before rotation
 *   retainFiles   — number of rotated files to keep
 *   logPromptText — set true to include full prompt text (default false)
 */

window.PO = window.PO || {};

window.PO.Logger = (function () {
  "use strict";

  var LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
  var LEVEL_NAMES = ["debug", "info", "warn", "error"];

  var logDir = null;
  var logFile = null;
  var writeQueue = Promise.resolve();
  var currentFileSize = 0;

  /* ── Sensitive field filter ── */
  var SENSITIVE_KEYS = [
    "imagePngBase64",
    "maskPngBase64",
    "previewJpegBase64",
    "imageBase64",
    "base64",
    "pngBytes",
    "pixelData",
    "rawData",
  ];

  function stripSensitive(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map(stripSensitive);

    var out = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (SENSITIVE_KEYS.indexOf(k) !== -1) {
        out[k] = "[redacted, length=" + (typeof obj[k] === "string" ? obj[k].length : "?") + "]";
      } else if (typeof obj[k] === "object" && obj[k] !== null) {
        out[k] = stripSensitive(obj[k]);
      } else {
        out[k] = obj[k];
      }
    }
    return out;
  }

  /* ── Prompt privacy ── */
  function sanitizePrompt(data) {
    if (!data || typeof data !== "object") return data;
    var out = {};
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === "prompt" || k === "negativePrompt") {
        var text = String(data[k] || "");
        var logging = window.PO.state && window.PO.state.logging;
        if (logging && logging.logPromptText) {
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
      stack: Array.isArray(err.stack) ? err.stack : (err.stack ? String(err.stack).split("\n").slice(0, 3).map(function (s) { return s.trim(); }) : undefined),
    };
  }

  /* ── Get logging config ── */
  function getConfig() {
    var state = window.PO.state;
    if (!state || !state.logging) {
      return { enabled: true, level: "info", maxFileBytes: 1048576, retainFiles: 5, logPromptText: false };
    }
    return state.logging;
  }

  /* ── Get log file name (cached per session, seconds precision) ── */
  var cachedLogName = null;

  function getLogFileName() {
    if (cachedLogName) return cachedLogName;
    var now = new Date();
    var ts = now.getFullYear() + "-" +
      String(now.getMonth() + 1).padStart(2, "0") + "-" +
      String(now.getDate()).padStart(2, "0") + "-" +
      String(now.getHours()).padStart(2, "0") + "-" +
      String(now.getMinutes()).padStart(2, "0") + "-" +
      String(now.getSeconds()).padStart(2, "0");
    cachedLogName = "pixeloasis-logs-" + ts + ".jsonl";
    return cachedLogName;
  }

  /* ── Check log level ── */
  function shouldLog(level) {
    var cfg = getConfig();
    if (!cfg.enabled) return false;
    var threshold = LEVELS[cfg.level] || LEVELS.info;
    return (LEVELS[level] || 20) >= threshold;
  }

  /* ── Init log directory ── */
  async function ensureLogDir() {
    if (logDir) return logDir;

    try {
      var uxp = window.require("uxp");
      var storage = uxp.storage;
      var dataFolder = await storage.localFileSystem.getDataFolder();

      /* getDataFolder returns a Folder; get its sub-folders */
      var entries = await dataFolder.getEntries();
      var logsFolder = null;

      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isFolder && entries[i].name === "logs") {
          logsFolder = entries[i];
          break;
        }
      }

      if (!logsFolder) {
        logsFolder = await dataFolder.createFolder("logs");
      }

      logDir = logsFolder;
      return logDir;
    } catch (e) {
      /* If we can't init, silently skip logging */
      logDir = null;
      return null;
    }
  }

  /* ── Get or create log file ── */
  async function ensureLogFile() {
    var dir = await ensureLogDir();
    if (!dir) return null;

    var targetName = getLogFileName();

    /* If already holding the session file, reuse it */
    if (logFile && logFile.name === targetName) return logFile;

    try {
      var entries = await dir.getEntries();
      var existing = null;

      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isFolder && entries[i].name === targetName) {
          existing = entries[i];
          break;
        }
      }

      if (existing) {
        currentFileSize = existing.length || 0;
        logFile = existing;
      } else {
        logFile = await dir.createFile(targetName, { overwrite: true });
        currentFileSize = 0;
      }

      return logFile;
    } catch (e) {
      return null;
    }
  }

  /* ── Rotate log files ── */
  async function rotateLogs() {
    if (!logDir) return;

    try {
      var cfg = getConfig();
      var ts = Date.now();
      var rotatedName = getLogFileName().replace(/\.jsonl$/, "." + ts + ".jsonl");

      /* Rename current to timestamped */
      if (logFile) {
        try {
          await logFile.moveTo(logDir, rotatedName, { overwrite: true });
        } catch (e) { /* ignore */ }
      }

      /* Create fresh */
      logFile = await logDir.createFile(getLogFileName(), { overwrite: true });
      currentFileSize = 0;

      /* Clean old rotated files */
      var entries = await logDir.getEntries();
      var rotatedFiles = [];
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isFolder && /^pixeloasis-logs-.*\.\d+\.jsonl$/.test(entries[i].name)) {
          rotatedFiles.push(entries[i]);
        }
      }
      /* Sort by name descending (newer timestamps sort higher) */
      rotatedFiles.sort(function (a, b) { return b.name.localeCompare(a.name); });
      /* Delete excess */
      for (var j = cfg.retainFiles; j < rotatedFiles.length; j++) {
        try { await rotatedFiles[j].delete(); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
  }

  /* ── Core write ── */
  function log(level, event, opts) {
    if (!shouldLog(level)) return;

    opts = opts || {};

    writeQueue = writeQueue.then(async function () {
      try {
        var file = await ensureLogFile();
        if (!file) return;

        /* Check if rotation needed */
        var cfg = getConfig();
        if (currentFileSize > cfg.maxFileBytes) {
          await rotateLogs();
          file = logFile;
          if (!file) return;
        }

        var entry = {
          ts: new Date().toISOString(),
          level: level,
          source: "plugin",
          component: opts.component || "unknown",
          event: event,
          correlationId: opts.correlationId || undefined,
          jobId: opts.jobId || undefined,
          capabilityId: opts.capabilityId || undefined,
          workflowId: opts.workflowId || undefined,
          durationMs: typeof opts.durationMs === "number" ? opts.durationMs : undefined,
          message: opts.message || undefined,
        };

        /* Attach sanitized data */
        if (opts.data) {
          var cleaned = stripSensitive(opts.data);
          entry.data = sanitizePrompt(cleaned);
        }

        /* Attach error info */
        if (opts.error) {
          entry.error = formatError(opts.error);
        }

        var line = JSON.stringify(entry) + "\n";

        /* UXP file write — append mode */
        await file.write(line, { append: true });
        currentFileSize += line.length;
      } catch (e) {
        /* Silently drop — logging must not break app */
      }
    });
  }

  /* ── Public API ── */

  function debug(event, opts) { log("debug", event, opts); }
  function info(event, opts) { log("info", event, opts); }
  function warn(event, opts) { log("warn", event, opts); }
  function errorLog(event, opts) { log("error", event, opts); }

  /* Clear all logs */
  async function clearLogs() {
    try {
      var dir = await ensureLogDir();
      if (!dir) return;

      var entries = await dir.getEntries();
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isFolder && /^pixeloasis-logs-.*\.jsonl$/.test(entries[i].name)) {
          try { await entries[i].delete(); } catch (e) { /* ignore */ }
        }
      }

      logFile = null;
      currentFileSize = 0;
      info("log.cleared", { component: "logger", message: "All logs cleared" });
    } catch (e) { /* ignore */ }
  }

  /* Get log directory path for display */
  async function getLogPath() {
    try {
      var dir = await ensureLogDir();
      if (!dir) return "(unavailable)";
      return dir.nativePath || dir.name || "(unknown)";
    } catch (e) {
      return "(error)";
    }
  }

  /* Get log file path for opening */
  async function getLogFilePath() {
    try {
      var file = await ensureLogFile();
      if (!file) return "(unavailable)";
      return file.nativePath || "(unknown)";
    } catch (e) {
      return "(error)";
    }
  }

  /* Export recent log entries as text (for copy/debug) */
  async function exportRecent(maxLines) {
    maxLines = maxLines || 50;
    try {
      var file = await ensureLogFile();
      if (!file) return "";
      var text = await file.read({ format: "text" });
      var lines = text.split("\n").filter(Boolean);
      return lines.slice(-maxLines).join("\n");
    } catch (e) {
      return "";
    }
  }

  return {
    debug: debug,
    info: info,
    warn: warn,
    error: errorLog,
    clearLogs: clearLogs,
    getLogPath: getLogPath,
    getLogFilePath: getLogFilePath,
    exportRecent: exportRecent,
  };
})();
