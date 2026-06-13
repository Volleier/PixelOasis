
/* ===== scripts/ui-text.js ===== */
window.PO = window.PO || {};

window.PO.TEXT = {
  ready: "ready",
  shellReady: "uxp shell ready",
  noDocument: "No active document.",
  noSelection: "No active selection.",
  settings: "设置",
  settingsOpened: "settings opened",
  settingsClosed: "settings closed",
  themeMode: "亮暗模式",
  themeHint: "仅显示界面，逻辑暂未接入",
  themeClicked: "theme toggle clicked",
  gatewayUrlLabel: "网关地址",
  gatewayUrlPlaceholder: "http://127.0.0.1:8787",
  previewTitle: "预览区",
  previewAction: "抓取当前选区",
  previewEmpty: "暂无预览内容",
  selectRectTool: "选择矩形选框工具",
  captureSelection: "抓取当前选区",
  sections: [
    { id: "retouch", title: "人像精修", hint: "功能按钮待接入" },
    { id: "composition", title: "构图工具", hint: "当前分区已接入基础操作" },
    { id: "lighting", title: "光影风格", hint: "功能按钮待接入" },
    { id: "fx", title: "视觉特效", hint: "功能按钮待接入" },
    { id: "quality", title: "画质提升", hint: "功能按钮待接入" },
  ],
};



/* ===== scripts/state.js ===== */
window.PO = window.PO || {};

window.PO.state = {
  settingsOpen: false,
  themePressed: false,
  gatewayUrl: "http://127.0.0.1:8787",
  status: "ready",
  capture: null,
  transientTimer: null,
  logging: {
    enabled: true,
    level: "info",
    maxFileBytes: 1024 * 1024,
    retainFiles: 5,
    logPromptText: false,
  },
};

window.PO.clearTransientTimer = function () {
  if (window.PO.state.transientTimer) {
    clearTimeout(window.PO.state.transientTimer);
    window.PO.state.transientTimer = null;
  }
};



/* ===== scripts/logger.js ===== */
/* logger.js — PixelOasis plugin-side JSONL logger
 *
 * Writes structured log entries to <UXP data folder>/logs/pixeloasis-plugin.jsonl.
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

    try {
      var entries = await dir.getEntries();
      var existing = null;

      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isFolder && entries[i].name === "pixeloasis-plugin.jsonl") {
          existing = entries[i];
          break;
        }
      }

      if (existing) {
        currentFileSize = existing.length || 0;
        logFile = existing;
      } else {
        logFile = await dir.createFile("pixeloasis-plugin.jsonl", { overwrite: true });
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

      /* Shift existing files */
      for (var n = cfg.retainFiles - 1; n >= 1; n--) {
        try {
          var oldFile = await logDir.getEntry("pixeloasis-plugin." + n + ".jsonl");
          if (oldFile) {
            await oldFile.moveTo(logDir, "pixeloasis-plugin." + (n + 1) + ".jsonl", { overwrite: true });
          }
        } catch (e) { /* file doesn't exist, skip */ }
      }

      /* Rename current to .1 */
      if (logFile) {
        try {
          await logFile.moveTo(logDir, "pixeloasis-plugin.1.jsonl", { overwrite: true });
        } catch (e) { /* ignore */ }
      }

      /* Create fresh */
      logFile = await logDir.createFile("pixeloasis-plugin.jsonl", { overwrite: true });
      currentFileSize = 0;
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
        if (!entries[i].isFolder && /^pixeloasis-plugin(\.\d+)?\.jsonl$/.test(entries[i].name)) {
          try { await entries[i].delete(); } catch (e) { /* ignore */ }
        }
      }

      logFile = null;
      currentFileSize = 0;

      /* Create fresh */
      logFile = await dir.createFile("pixeloasis-plugin.jsonl", { overwrite: true });
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
    exportRecent: exportRecent,
  };
})();



/* ===== scripts/ui-template.js ===== */
window.PO = window.PO || {};

window.PO.buildSections = function () {
  var TEXT = window.PO.TEXT;

  function sectionBody(section) {
    if (section.id === "composition") {
      return [
        '<div class="po-action-row">',
        '<button class="po-button" type="button" data-workflow="composition.remove.basic">移除</button>',
        '<button class="po-button" type="button" data-workflow="composition.outpaint.basic">扩图</button>',
        "</div>",
      ].join("");
    }
    if (section.id === "quality") {
      return [
        '<div class="po-action-row">',
        '<button class="po-button" type="button" data-workflow="quality.upscale.basic">超分放大</button>',
        '<button class="po-button" type="button" data-workflow="quality.realism-enhance.basic">真实感增强</button>',
        "</div>",
      ].join("");
    }
    return '<div class="po-section__placeholder">' + section.hint + "</div>";
  }

  return TEXT.sections
    .map(function (section) {
      return [
        '<section class="po-section" data-section="',
        section.id,
        '">',
        '<div class="po-section__header">',
        '<h2 class="po-section__title">',
        section.title,
        "</h2>",
        "</div>",
        '<div class="po-section__body">',
        sectionBody(section),
        "</div>",
        "</section>",
      ].join("");
    })
    .join("");
};

window.PO.buildTemplate = function () {
  var TEXT = window.PO.TEXT;
  return [
    '<div class="po-root">',

    /* ── Main content ── */
    '<main class="po-main">',
    '<div class="po-main-scroll">',
    window.PO.buildSections(),
    "</div>",
    "</main>",

    /* ── Preview area (in normal flow, below main) ── */
    '<section class="po-preview">',
    '<div class="po-preview__viewport">',
    '<img id="preview-image" class="po-preview__image" alt="selection preview" />',
    '<div id="preview-empty" class="po-preview__empty">' + TEXT.previewEmpty + "</div>",
    "</div>",
    "</section>",

    /* ── Bottom bar ── */
    '<footer class="po-bottom-bar">',
    '<div id="status" class="po-status">' + TEXT.ready + "</div>",
    '<button id="settings-btn" class="po-bottom-button" type="button">' + TEXT.settings + "</button>",
    "</footer>",

    /* ── 设置区 (overlay + drawer, root-level, covers main + preview) ── */
    '<div id="settings-overlay" class="po-settings-overlay" hidden></div>',
    '<aside id="settings-drawer" class="po-settings-drawer" hidden>',
    '<div class="po-settings-drawer__body">',
    '<div class="po-setting-row">',
    '<div class="po-setting-copy">',
    '<div class="po-setting-row__label">' + TEXT.themeMode + "</div>",
    '<div class="po-setting-row__hint">' + TEXT.themeHint + "</div>",
    "</div>",
    '<button id="theme-toggle-btn" class="po-toggle" type="button" aria-pressed="false">',
    '<span class="po-toggle__thumb"></span>',
    "</button>",
    "</div>",

    /* Gateway URL */
    '<div class="po-setting-group">',
    '<label class="po-setting-row__label" for="gateway-url-input">' + TEXT.gatewayUrlLabel + "</label>",
    '<input id="gateway-url-input" class="po-settings-url-input" type="text" placeholder="' + TEXT.gatewayUrlPlaceholder + '" />',
    "</div>",

    /* Log settings */
    '<div class="po-setting-group">',
    '<div class="po-setting-row">',
    '<span class="po-setting-row__label">日志记录</span>',
    '<button id="log-toggle-btn" class="po-toggle" type="button" aria-pressed="true">',
    '<span class="po-toggle__thumb"></span>',
    "</button>",
    "</div>",
    '<div class="po-setting-row" style="margin-top:8px;">',
    '<label class="po-setting-row__label" for="log-level-select">日志级别</label>',
    '<select id="log-level-select" class="po-param-select" style="width:120px;">',
    '<option value="debug">debug</option>',
    '<option value="info" selected>info</option>',
    '<option value="warn">warn</option>',
    '<option value="error">error</option>',
    "</select>",
    "</div>",
    '<div class="po-setting-row" style="margin-top:8px;">',
    '<span id="log-path-display" class="po-setting-row__hint" style="font-size:10px;">(loading...)</span>',
    "</div>",
    '<button id="log-clear-btn" class="po-button po-button--secondary" type="button" style="margin-top:8px;width:100%;">清空日志</button>',
    "</div>",

    "</div>",
    "</aside>",

    /* ── 参数页 (full-screen overlay, covers main + preview, not bottom bar) ── */
    window.PO.buildParameterPage ? window.PO.buildParameterPage() : "",

    "</div>",
  ].join("");
};



/* ===== scripts/ui-workflows.js ===== */
window.PO = window.PO || {};

/* ── Sampler / scheduler option sets ── */

window.PO.SAMPLER_OPTIONS = [
  "dpmpp_2m",
  "euler",
  "euler_ancestral",
  "ddim",
  "uni_pc",
];

window.PO.SCHEDULER_OPTIONS = [
  "karras",
  "normal",
  "simple",
  "ddim_uniform",
  "sg_uniform",
];

/* ── Workflow registry ──
 *
 * Each workflow declares its id, display title, category, and default
 * parameter values.  The parameter page reads these defaults on first open
 * and persists user edits per workflowId in window.PO.workflowParams.
 */

window.PO.WORKFLOWS = {

  /* ═══ 构图工具 ═══ */

  "composition.remove.basic": {
    id: "composition.remove.basic",
    title: "移除",
    category: "composition",
    defaults: {
      prompt: "clean background, remove selected object, natural continuation, preserve surrounding texture and lighting",
      negativePrompt: "object remains, blurry, distorted, duplicate object, artifacts, bad texture",
      seed: -1,
      steps: 28,
      cfg: 6.5,
      denoise: 0.85,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },

  "composition.outpaint.basic": {
    id: "composition.outpaint.basic",
    title: "扩图",
    category: "composition",
    defaults: {
      prompt: "extend the scene naturally, consistent perspective, consistent lighting, seamless background continuation",
      negativePrompt: "hard edge, visible seam, distorted perspective, repeated pattern, artifacts",
      seed: -1,
      steps: 30,
      cfg: 7,
      denoise: 0.9,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },

  "composition.inpaint.basic": {
    id: "composition.inpaint.basic",
    title: "局部修复",
    category: "composition",
    defaults: {
      prompt: "",
      negativePrompt: "",
      seed: -1,
      steps: 28,
      cfg: 7,
      denoise: 0.75,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },

  /* ═══ 画质提升 ═══ */

  "quality.upscale.basic": {
    id: "quality.upscale.basic",
    title: "超分放大",
    category: "quality",
    defaults: {
      prompt: "enhance detail, clean texture, sharp but natural, preserve original structure",
      negativePrompt: "over-sharpened, plastic skin, noisy, artifacts, changed identity, changed shape",
      seed: -1,
      steps: 18,
      cfg: 5,
      denoise: 0.25,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },

  "quality.realism-enhance.basic": {
    id: "quality.realism-enhance.basic",
    title: "真实感增强",
    category: "quality",
    defaults: {
      prompt: "make the selected area more photorealistic, natural lighting, realistic texture, preserve identity, preserve composition",
      negativePrompt: "overprocessed, plastic, waxy skin, distorted, changed face, changed object shape, artifacts",
      seed: -1,
      steps: 24,
      cfg: 5.5,
      denoise: 0.35,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },

  /* ═══ 后续扩展 ═══ */

  "portrait.skin-retouch.basic": {
    id: "portrait.skin-retouch.basic",
    title: "皮肤精修",
    category: "portrait",
    defaults: {
      prompt: "",
      negativePrompt: "",
      seed: -1,
      steps: 28,
      cfg: 7,
      denoise: 0.75,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },

  "lighting.relight.basic": {
    id: "lighting.relight.basic",
    title: "光影调整",
    category: "lighting",
    defaults: {
      prompt: "",
      negativePrompt: "",
      seed: -1,
      steps: 20,
      cfg: 7,
      denoise: 0.6,
      sampler: "dpmpp_2m",
      scheduler: "karras",
    },
  },

  "effects.style-transfer.basic": {
    id: "effects.style-transfer.basic",
    title: "风格迁移",
    category: "effects",
    defaults: {
      prompt: "",
      negativePrompt: "",
      seed: -1,
      steps: 30,
      cfg: 7,
      denoise: 0.8,
      sampler: "euler",
      scheduler: "normal",
    },
  },
};



/* ===== scripts/vendor/png-encoder.js ===== */
/* vendor/png-encoder.js — Pure-JS PNG encoder for UXP
 *
 * Produces valid PNGs without relying on Adobe imaging.encodeImageData,
 * whose PNG output is documented primarily as a JPEG/base64 helper and
 * whose alpha-channel fidelity is not guaranteed by the API contract.
 *
 * Compression: Deflate stored blocks (BTYPE=00).
 *   Correct, self-contained, and produces valid PNG bytes without zlib.
 *   Trade-off: no LZ77 compression → output is ~raw-size.
 *   Future: upgrade to fixed-Huffman (BTYPE=01) or full LZ77 if upload
 *   size becomes a bottleneck.
 *
 * Color-type constants (PNG spec):
 *   2 — RGB  (3 bytes / pixel)
 *   6 — RGBA (4 bytes / pixel)
 *
 * Usage:
 *   var b64 = window.PO.PngEncoder.encode(width, height, pixelData, 6);
 *   // pixelData is a Uint8Array in row-major order, samples interleaved.
 */

window.PO = window.PO || {};

window.PO.PngEncoder = (function () {
  "use strict";

  /* ── CRC-32 (IEEE 802.3 polynomial, reflected) ── */

  var crcTable = new Uint32Array(256);
  (function buildCrcTable() {
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c;
    }
  })();

  function crc32(data, offset, length) {
    var crc = 0xFFFFFFFF;
    for (var i = offset; i < offset + length; i++) {
      crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /* ── Adler-32 (zlib checksum) ── */
  /* s1 and s2 are MOD 65521.  We update per-byte but reduce periodically. */

  function adler32(data, offset, length) {
    var s1 = 1;
    var s2 = 0;
    var end = offset + length;
    for (var i = offset; i < end; i++) {
      s1 = (s1 + data[i]) % 65521;
      s2 = (s2 + s1) % 65521;
    }
    return ((s2 << 16) | s1) >>> 0;
  }

  /* ── Base64 encode (Uint8Array → string) ── */

  var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function toBase64(bytes) {
    var result = "";
    var len = bytes.length;
    for (var i = 0; i < len; i += 3) {
      var b0 = bytes[i];
      var b1 = i + 1 < len ? bytes[i + 1] : 0;
      var b2 = i + 2 < len ? bytes[i + 2] : 0;
      var triple = (b0 << 16) | (b1 << 8) | b2;
      result += base64Chars.charAt((triple >> 18) & 0x3F);
      result += base64Chars.charAt((triple >> 12) & 0x3F);
      result += i + 1 < len ? base64Chars.charAt((triple >> 6) & 0x3F) : "=";
      result += i + 2 < len ? base64Chars.charAt(triple & 0x3F) : "=";
    }
    return result;
  }

  /* ── Deflate stored-block compressor ──
   *
   * RFC 1951 §3.2.4 — stored (BTYPE=00) blocks.
   * Each block: 1-bit BFINAL + 2-bit BTYPE + pad to byte + LEN + NLEN + data.
   * Max data per block = 65535 bytes.
   */

  var MAX_STORED_BLOCK = 65535;

  /* Returns total deflate byte count.  Writes into `out` at `outOffset`. */
  function deflateStored(data, dataOffset, dataLength, out, outOffset) {
    var pos = outOffset;
    var remaining = dataLength;
    var srcPos = dataOffset;

    while (remaining > 0) {
      var blockLen = remaining < MAX_STORED_BLOCK ? remaining : MAX_STORED_BLOCK;
      var isFinal = blockLen === remaining ? 1 : 0;

      /* Block header: 3 bits (BFINAL + BTYPE), padded to byte boundary.
       * Since we're at a fresh byte (guaranteed by previous block ending
       * on a byte boundary), we write a full byte: BFINAL << 0 | BTYPE << 1
       * Wait — in Deflate bit order (LSB first):
       *   Bit 0 = BFINAL, Bits 1-2 = BTYPE (00).
       * So the byte is just (isFinal ? 1 : 0).
       * But we're writing 8 bits starting at a byte boundary:
       *   value = (isFinal ? 1 : 0) (3 bits used, 5 padding zeros)
       * In LSB-first byte: bits 0-2 = value, bits 3-7 = 0.
       */
      out[pos] = isFinal ? 1 : 0;
      pos += 1;

      /* LEN (2 bytes, little-endian) */
      out[pos] = blockLen & 0xFF;
      out[pos + 1] = (blockLen >> 8) & 0xFF;
      pos += 2;

      /* NLEN = one's complement of LEN (2 bytes, little-endian) */
      var nlen = blockLen ^ 0xFFFF;
      out[pos] = nlen & 0xFF;
      out[pos + 1] = (nlen >> 8) & 0xFF;
      pos += 2;

      /* Copy data */
      for (var j = 0; j < blockLen; j++) {
        out[pos + j] = data[srcPos + j];
      }
      pos += blockLen;
      srcPos += blockLen;
      remaining -= blockLen;
    }

    return pos - outOffset; /* bytes written */
  }

  /* ── Zlib wrapper ──
   *
   * RFC 1950:
   *   CMF (1 byte): compression method (4 bits) + window (4 bits)
   *                 CM=8 (deflate), CINFO=7 (32K window) → 0x78
   *   FLG (1 byte): flags + check bits. 0x01 = no dict, level 0.
   *                 FCHECK makes CMF*256+FLG a multiple of 31.
   *                 0x78*256 + 0x01 = 0x7801.  0x7801 % 31 = ... let's compute:
   *                 0x7801 = 30721.  30721 / 31 = 991.  991*31 = 30721.  Yes, divisible!
   *   ... compressed data ...
   *   Adler-32 (4 bytes, big-endian)
   */

  function zlibWrap(deflated, deflatedLen, rawData, rawOffset, rawLen, out, outOffset) {
    var pos = outOffset;
    /* CMF */
    out[pos] = 0x78;
    pos += 1;
    /* FLG — level 0 (stored), FCHECK makes it divisible by 31.
     * 0x78 * 256 + 0x01 = 0x7801 ≡ 0 (mod 31), so FLG = 0x01 works. */
    out[pos] = 0x01;
    pos += 1;
    /* Deflate data */
    for (var i = 0; i < deflatedLen; i++) {
      out[pos + i] = deflated[i];
    }
    pos += deflatedLen;
    /* Adler-32 (big-endian) */
    var adler = adler32(rawData, rawOffset, rawLen);
    out[pos] = (adler >> 24) & 0xFF;
    out[pos + 1] = (adler >> 16) & 0xFF;
    out[pos + 2] = (adler >> 8) & 0xFF;
    out[pos + 3] = adler & 0xFF;
    pos += 4;
    return pos - outOffset;
  }

  /* ── 32-bit big-endian write ── */

  function writeUint32BE(buf, offset, value) {
    buf[offset] = (value >> 24) & 0xFF;
    buf[offset + 1] = (value >> 16) & 0xFF;
    buf[offset + 2] = (value >> 8) & 0xFF;
    buf[offset + 3] = value & 0xFF;
  }

  /* ── Main PNG encoder ──
   *
   * @param {number}  width     Image width in pixels
   * @param {number}  height    Image height in pixels
   * @param {Uint8Array} pixels Raw pixel data, row-major, samples interleaved
   * @param {number}  colorType 2=RGB (3 bpp), 6=RGBA (4 bpp)
   * @returns {string} Base64-encoded PNG
   */

  function encode(width, height, pixels, colorType) {
    var bytesPerPixel = colorType === 6 ? 4 : 3;
    var samplesPerPixel = bytesPerPixel; /* No palette — samples == bytes */
    var bitDepth = 8;

    /* ── Build filtered pixel data ──
     * Each row: 1 filter byte (0x00 = None) + raw pixel bytes.
     * Total raw = height * (1 + width * bytesPerPixel)
     */
    var rowLen = 1 + width * bytesPerPixel;
    var rawLen = height * rowLen;
    var raw = new Uint8Array(rawLen);
    for (var y = 0; y < height; y++) {
      /* Filter byte = 0x00 (None) */
      raw[y * rowLen] = 0;
      /* Copy pixel row */
      var srcRowStart = y * width * bytesPerPixel;
      for (var x = 0; x < width * bytesPerPixel; x++) {
        raw[y * rowLen + 1 + x] = pixels[srcRowStart + x];
      }
    }

    /* ── Deflate ──
     * Worst-case deflated size: ~rawLen + (rawLen / 65535 + 1) * 5
     * Each stored block adds 5 header bytes per ≤65535 bytes.
     */
    var maxDeflated = rawLen + Math.ceil(rawLen / MAX_STORED_BLOCK) * 5;
    var deflated = new Uint8Array(maxDeflated);
    var deflatedLen = deflateStored(raw, 0, rawLen, deflated, 0);

    /* ── Zlib ──
     * Zlib header (2) + deflate data + Adler-32 (4)
     */
    var zlibLen = 2 + deflatedLen + 4;
    var zlib = new Uint8Array(zlibLen);
    zlibWrap(deflated, deflatedLen, raw, 0, rawLen, zlib, 0);

    /* ── PNG assembly ── */

    /* Signature (8 bytes) */
    var signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

    /* IHDR (25 bytes) */
    var ihdr = new Uint8Array(25);
    writeUint32BE(ihdr, 0, 13); /* data length */
    ihdr[4] = 73; ihdr[5] = 72; ihdr[6] = 68; ihdr[7] = 82; /* "IHDR" */
    writeUint32BE(ihdr, 8, width);
    writeUint32BE(ihdr, 12, height);
    ihdr[16] = bitDepth;    /* bit depth */
    ihdr[17] = colorType;   /* color type */
    ihdr[18] = 0;           /* compression (0 = deflate) */
    ihdr[19] = 0;           /* filter method (0 = adaptive with 5 types) */
    ihdr[20] = 0;           /* interlace (0 = none) */
    writeUint32BE(ihdr, 21, crc32(ihdr, 4, 17));

    /* IDAT (12 + zlibLen bytes) */
    var idatDataLen = zlibLen;
    var idat = new Uint8Array(12 + idatDataLen);
    writeUint32BE(idat, 0, idatDataLen);
    idat[4] = 73; idat[5] = 68; idat[6] = 65; idat[7] = 84; /* "IDAT" */
    for (var i2 = 0; i2 < idatDataLen; i2++) {
      idat[8 + i2] = zlib[i2];
    }
    writeUint32BE(idat, 8 + idatDataLen, crc32(idat, 4, 4 + idatDataLen));

    /* IEND (12 bytes) */
    var iend = new Uint8Array(12);
    writeUint32BE(iend, 0, 0); /* data length = 0 */
    iend[4] = 73; iend[5] = 69; iend[6] = 78; iend[7] = 68; /* "IEND" */
    writeUint32BE(iend, 8, crc32(iend, 4, 4));

    /* Concatenate */
    var pngLen = signature.length + ihdr.length + idat.length + iend.length;
    var png = new Uint8Array(pngLen);
    var pos = 0;
    png.set(signature, pos); pos += signature.length;
    png.set(ihdr, pos);      pos += ihdr.length;
    png.set(idat, pos);      pos += idat.length;
    png.set(iend, pos);      /* pos += iend.length; */

    return toBase64(png);
  }

  return { encode: encode };
})();



/* ===== scripts/gateway-client.js ===== */
/* gateway-client.js — PixelOasis HTTP client for local model-gateway
 *
 * DevList §8-P3 / §4 protocol.
 *
 * Usage:
 *   var ok  = await window.PO.GatewayClient.health();
 *   var res = await window.PO.GatewayClient.generate(requestPayload);
 */

window.PO = window.PO || {};

window.PO.GatewayClient = (function () {
  "use strict";

  var DEFAULT_URL = "http://127.0.0.1:8787";
  var HEALTH_TIMEOUT_MS = 5000;
  var GENERATE_TIMEOUT_MS = 120000; /* 2 min — generation can be slow */

  function getBaseUrl() {
    return (window.PO.state && window.PO.state.gatewayUrl) || DEFAULT_URL;
  }

  /* ── Health check ── */

  async function health() {
    var base = getBaseUrl();
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, HEALTH_TIMEOUT_MS);

    var healthStart = Date.now();
    try {
      var resp = await fetch(base + "/health", {
        method: "GET",
        signal: controller.signal,
      });
      var ok = resp.ok;
      window.PO.Logger.info("gateway.health.completed", {
        component: "gateway",
        durationMs: Date.now() - healthStart,
        data: { url: base, healthy: ok },
      });
      return ok;
    } catch (e) {
      window.PO.Logger.warn("gateway.health.failed", {
        component: "gateway",
        durationMs: Date.now() - healthStart,
        error: e,
        data: { url: base },
      });
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ── Generate ── */

  async function generate(requestPayload) {
    var base = getBaseUrl();
    var body = JSON.stringify(requestPayload);
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, GENERATE_TIMEOUT_MS);

    var generateStart = Date.now();
    var corrId = requestPayload.correlationId || "";

    window.PO.Logger.info("gateway.generate.started", {
      component: "gateway",
      correlationId: corrId,
      workflowId: requestPayload.workflowId,
      data: { url: base },
    });

    try {
      var resp = await fetch(base + "/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        signal: controller.signal,
      });

      if (!resp.ok) {
        var errorText = "";
        try { errorText = await resp.text(); } catch (e) { /* ignore */ }
        window.PO.Logger.error("gateway.generate.failed", {
          component: "gateway",
          correlationId: corrId,
          workflowId: requestPayload.workflowId,
          durationMs: Date.now() - generateStart,
          data: { status: resp.status },
          error: { code: "HTTP_" + resp.status, message: errorText },
        });
        return {
          correlationId: corrId,
          status: "failed",
          error: {
            code: "HTTP_" + resp.status,
            message: errorText || "Gateway returned " + resp.status,
          },
        };
      }

      var data = await resp.json();

      window.PO.Logger.info("gateway.generate.completed", {
        component: "gateway",
        correlationId: corrId,
        workflowId: requestPayload.workflowId,
        durationMs: Date.now() - generateStart,
        data: { status: data.status },
      });

      return data;
    } catch (e) {
      var errCode = "NETWORK_ERROR";
      var errMsg = e instanceof Error ? e.message : String(e);

      if (e && e.name === "AbortError") {
        errCode = "TIMEOUT";
        errMsg = "Gateway request timed out after " + (GENERATE_TIMEOUT_MS / 1000) + "s";
      }

      window.PO.Logger.error("gateway.generate.failed", {
        component: "gateway",
        correlationId: corrId,
        workflowId: requestPayload.workflowId,
        durationMs: Date.now() - generateStart,
        error: { code: errCode, message: errMsg },
      });

      return {
        correlationId: corrId,
        status: "failed",
        error: {
          code: errCode,
          message: errMsg,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    health: health,
    generate: generate,
  };
})();



/* ===== scripts/photoshop.js ===== */
window.PO = window.PO || {};

/* ── Normalization helpers ── */

window.PO.normalizeNumber = function (value) {
  if (typeof value === "number" && isFinite(value)) return value;
  if (value && typeof value === "object") {
    if (typeof value._value === "number") return value._value;
    if (typeof value.value === "number") return value.value;
  }
  return null;
};

window.PO.normalizeSelectionBounds = function (candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  var left = window.PO.normalizeNumber(candidate.left);
  var top = window.PO.normalizeNumber(candidate.top);
  var right = window.PO.normalizeNumber(candidate.right);
  var bottom = window.PO.normalizeNumber(candidate.bottom);
  if (left === null || top === null || right === null || bottom === null) {
    return null;
  }
  return {
    left: left,
    top: top,
    width: right - left,
    height: bottom - top,
  };
};

window.PO.clampBoundsToCanvas = function (bounds, canvasWidth, canvasHeight) {
  return {
    left: Math.max(0, Math.min(bounds.left, canvasWidth)),
    top: Math.max(0, Math.min(bounds.top, canvasHeight)),
    right: Math.max(0, Math.min(bounds.right, canvasWidth)),
    bottom: Math.max(0, Math.min(bounds.bottom, canvasHeight)),
  };
};

window.PO.formatSelectionBounds = function (bounds) {
  return (
    "selection: " +
    bounds.left +
    "," +
    bounds.top +
    " " +
    bounds.width +
    "x" +
    bounds.height
  );
};

/* ── Pixel buffer helpers ── */

window.PO.createRgbBufferFromGrayscale = function (source, width, height) {
  var pixelCount = width * height;
  var Constructor = source.constructor;
  var target = new Constructor(pixelCount * 3);

  for (var index = 0; index < pixelCount; index += 1) {
    var value = source[index];
    var targetIndex = index * 3;
    target[targetIndex] = value;
    target[targetIndex + 1] = value;
    target[targetIndex + 2] = value;
  }

  return target;
};

window.PO.createOpaqueJpegPreviewBuffer = function (source, width, height, components) {
  var pixelCount = width * height;
  var rgbBuffer = new Uint8Array(pixelCount * 3);
  var matte = { r: 43, g: 43, b: 43 };

  for (var index = 0; index < pixelCount; index += 1) {
    var src = index * components;
    var dest = index * 3;

    if (components >= 4) {
      var alpha = source[src + 3] / 255;
      rgbBuffer[dest] = Math.round(source[src] * alpha + matte.r * (1 - alpha));
      rgbBuffer[dest + 1] = Math.round(
        source[src + 1] * alpha + matte.g * (1 - alpha),
      );
      rgbBuffer[dest + 2] = Math.round(
        source[src + 2] * alpha + matte.b * (1 - alpha),
      );
    } else {
      rgbBuffer[dest] = source[src];
      rgbBuffer[dest + 1] = source[src + 1];
      rgbBuffer[dest + 2] = source[src + 2];
    }
  }

  return rgbBuffer;
};

window.PO.toDataUrl = function (base64Payload, mimeType) {
  return base64Payload && base64Payload.startsWith("data:")
    ? base64Payload
    : "data:" + mimeType + ";base64," + base64Payload;
};

/* ── Source-bounds padding ──
 *
 * Adobe notes that getPixels / getSelection may return sourceBounds that are
 * tighter than the requested bounds (cropped to actual pixel content).  When
 * that happens the image, mask and preview dimensions drift apart, which will
 * cause misalignment in the ComfyUI inpaint pipeline.
 *
 * This helper detects the drift and pads the returned ImageData back to the
 * originally-requested rectangle so every output is exactly selection-sized.
 */

window.PO.padImageDataToBounds = async function (imageData, requestedBounds, actualSourceBounds, fillValue) {
  var offsetLeft = actualSourceBounds.left - requestedBounds.left;
  var offsetTop = actualSourceBounds.top - requestedBounds.top;
  var reqW = requestedBounds.right - requestedBounds.left;
  var reqH = requestedBounds.bottom - requestedBounds.top;
  var actW = actualSourceBounds.right - actualSourceBounds.left;
  var actH = actualSourceBounds.bottom - actualSourceBounds.top;

  /* Fast path — no padding needed */
  if (offsetLeft === 0 && offsetTop === 0 && actW === reqW && actH === reqH) {
    return imageData;
  }

  var photoshop = window.require("photoshop");
  var imaging = photoshop.imaging;
  var components = imageData.components || 3;
  var rawData = await imageData.getData({ chunky: true });
  var is16Bit = imageData.componentSize === 16;

  var PaddedCtor = is16Bit ? Uint16Array : Uint8Array;
  var paddedBuffer = new PaddedCtor(reqW * reqH * components);

  /* Fill background */
  for (var i = 0; i < paddedBuffer.length; i++) {
    paddedBuffer[i] = fillValue;
  }

  /* Copy actual pixels at the correct offset */
  var srcStride = actW * components;
  var destStride = reqW * components;
  for (var y = 0; y < actH; y++) {
    var srcStart = y * srcStride;
    var destStart = (y + offsetTop) * destStride + offsetLeft * components;
    for (var x = 0; x < srcStride; x++) {
      paddedBuffer[destStart + x] = rawData[srcStart + x];
    }
  }

  var createOpts = Object.assign({
    width: reqW,
    height: reqH,
    components: components,
    colorSpace: "RGB",
    colorProfile: "sRGB IEC61966-2.1",
    chunky: true,
  }, is16Bit ? { fullRange: false } : {});

  var paddedImageData = await imaging.createImageDataFromBuffer(paddedBuffer, createOpts);

  /* Dispose the cropped original — caller owns the padded copy */
  imageData.dispose();

  return paddedImageData;
};

/* ── Image encoding ──
 *
 * Formal image & mask → vendor/png-encoder.js (pure JS, produces real PNG bytes).
 * UI preview           → Adobe imaging.encodeImageData (JPEG, safe for <img> display).
 *
 * DevList §8-P1: Do NOT rely on imaging.encodeImageData as the formal PNG encoder.
 */

window.PO.encodeFormalImagePng = async function (imageData) {
  var rawData = await imageData.getData({ chunky: true });
  var components = imageData.components || 3;
  return window.PO.PngEncoder.encode(
    imageData.width,
    imageData.height,
    rawData,
    components >= 4 ? 6 /* RGBA */ : 2 /* RGB */,
  );
};

window.PO.encodeFormalMaskPng = async function (maskImageData) {
  var grayscaleBuffer = await maskImageData.getData({ chunky: true });
  var rgbBuffer = window.PO.createRgbBufferFromGrayscale(
    grayscaleBuffer,
    maskImageData.width,
    maskImageData.height,
  );
  return window.PO.PngEncoder.encode(
    maskImageData.width,
    maskImageData.height,
    rgbBuffer,
    2 /* RGB */,
  );
};

window.PO.encodePreviewJpegBase64 = async function (previewImageData) {
  var photoshop = window.require("photoshop");
  var imaging = photoshop.imaging;
  var source = await previewImageData.getData({ chunky: true });
  var components =
    typeof previewImageData.components === "number"
      ? previewImageData.components
      : 4;

  var rgbBuffer = window.PO.createOpaqueJpegPreviewBuffer(
    source,
    previewImageData.width,
    previewImageData.height,
    components,
  );

  var rgbPreviewImageData = await imaging.createImageDataFromBuffer(rgbBuffer, {
    width: previewImageData.width,
    height: previewImageData.height,
    components: 3,
    colorSpace: "RGB",
    colorProfile: "sRGB IEC61966-2.1",
    chunky: true,
  });

  try {
    return await imaging.encodeImageData({
      imageData: rgbPreviewImageData,
      type: "image/jpeg",
      base64: true,
    });
  } finally {
    rgbPreviewImageData.dispose();
  }
};

/* ── Selection & capture ── */

window.PO.getSelectionBounds = async function () {
  var photoshop = window.require("photoshop");
  var app = photoshop.app;
  var action = photoshop.action;
  var documentRef = app.activeDocument;
  if (!documentRef) throw new Error("No active document.");

  var result = await action.batchPlay(
    [
      {
        _obj: "get",
        _target: [
          { _property: "selection" },
          { _ref: "document", _id: documentRef.id },
          { _ref: "application" },
        ],
        _options: { dialogOptions: "dontDisplay" },
      },
    ],
    {},
  );

  var selection =
    window.PO.normalizeSelectionBounds(result[0].selection) ||
    window.PO.normalizeSelectionBounds(result[0].selection && result[0].selection.bounds) ||
    window.PO.normalizeSelectionBounds(result[0].bounds);

  if (!selection || selection.width <= 0 || selection.height <= 0) {
    throw new Error("No active selection.");
  }

  window.PO.Logger.info("selection.detected", {
    component: "photoshop",
    data: {
      left: selection.left,
      top: selection.top,
      width: selection.width,
      height: selection.height,
    },
  });

  return selection;
};

window.PO.captureSelectionData = async function () {
  var photoshop = window.require("photoshop");
  var app = photoshop.app;
  var action = photoshop.action;
  var imaging = photoshop.imaging;
  var core = photoshop.core;
  var documentRef = app.activeDocument;
  if (!documentRef) throw new Error("No active document.");

  return core.executeAsModal(
    async function () {
      var result = await action.batchPlay(
        [
          {
            _obj: "get",
            _target: [
              { _property: "selection" },
              { _ref: "document", _id: documentRef.id },
              { _ref: "application" },
            ],
            _options: { dialogOptions: "dontDisplay" },
          },
        ],
        {},
      );

      var selection =
        window.PO.normalizeSelectionBounds(result[0].selection) ||
        window.PO.normalizeSelectionBounds(result[0].selection && result[0].selection.bounds) ||
        window.PO.normalizeSelectionBounds(result[0].bounds);

      if (!selection || selection.width <= 0 || selection.height <= 0) {
        throw new Error("No active selection.");
      }

      var captureBounds = window.PO.clampBoundsToCanvas(
        {
          left: selection.left,
          top: selection.top,
          right: selection.left + selection.width,
          bottom: selection.top + selection.height,
        },
        documentRef.width,
        documentRef.height,
      );

      /* ── Formal image (full resolution, RGBA) ── */
      var imageResult = await imaging.getPixels({
        documentID: documentRef.id,
        sourceBounds: captureBounds,
        colorSpace: "RGB",
        colorProfile: "sRGB IEC61966-2.1",
        componentSize: 8,
        applyAlpha: true, /* preserve transparency for formal PNG */
      });

      /* ── UI preview (thumbnail, RGBA) ── */
      var previewResult = await imaging.getPixels({
        documentID: documentRef.id,
        sourceBounds: captureBounds,
        targetSize: { width: 320 },
        colorSpace: "RGB",
        colorProfile: "sRGB IEC61966-2.1",
        componentSize: 8,
        applyAlpha: true,
      });

      /* ── Selection mask ── */
      var selectionResult = await imaging.getSelection({
        documentID: documentRef.id,
        sourceBounds: captureBounds,
      });

      try {
        /* Pad image & mask back to the originally-requested captureBounds
         * so every output is exactly selection-sized for the inpaint pipeline. */
        var paddedImageData = await window.PO.padImageDataToBounds(
          imageResult.imageData,
          captureBounds,
          imageResult.sourceBounds || captureBounds,
          0, /* fill transparent black for RGBA */
        );

        var paddedMaskData = await window.PO.padImageDataToBounds(
          selectionResult.imageData,
          captureBounds,
          selectionResult.sourceBounds || captureBounds,
          0, /* fill black = not-selected for grayscale mask */
        );

        /* Encode with vendor PNG encoder — real PNG bytes, preserves alpha */
        var imagePngBase64 = await window.PO.encodeFormalImagePng(paddedImageData);
        var maskPngBase64 = await window.PO.encodeFormalMaskPng(paddedMaskData);
        var previewJpegBase64 = await window.PO.encodePreviewJpegBase64(
          previewResult.imageData,
        );

        return {
          documentId: String(documentRef.id),
          bounds: selection,
          captureBounds: captureBounds,
          imagePngBase64: imagePngBase64,
          maskPngBase64: maskPngBase64,
          previewJpegBase64: previewJpegBase64,
          colorMode: String(documentRef.mode),
          resolution: documentRef.resolution,
        };
      } finally {
        /* paddedImageData / paddedMaskData own the buffers; the originals
         * were disposed by padImageDataToBounds. */
        try { paddedImageData.dispose(); } catch (e) { /* ignore */ }
        try { paddedMaskData.dispose(); } catch (e) { /* ignore */ }
        previewResult.imageData.dispose();
      }
    },
    { commandName: "PixelOasis Capture Selection Data" },
  );
};



/* ===== scripts/photoshop-place-layer.js ===== */
window.PO = window.PO || {};

window.PO.placeGeneratedLayer = async function (imagePngBase64, maskPngBase64, bounds, workflowTitle) {
  if (!imagePngBase64) throw new Error("No image data to place.");

  var photoshop = window.require("photoshop");
  var app = photoshop.app;
  var action = photoshop.action;
  var core = photoshop.core;
  var documentRef = app.activeDocument;
  if (!documentRef) throw new Error("No active document.");

  function base64ToBytes(base64) {
    var raw = base64.indexOf(",") !== -1 ? base64.split(",")[1] : base64;
    var binary = atob(raw);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  async function writeTempFile(filename, bytes) {
    var storage = require("uxp").storage;
    var folder = await storage.localFileSystem.getDataFolder();
    var file = await folder.createFile(filename, { overwrite: true });
    await file.write(bytes);
    return file.nativePath;
  }

  function normalizeBounds(layerBounds) {
    if (!layerBounds) return null;
    return {
      left: window.PO.normalizeNumber(layerBounds.left),
      top: window.PO.normalizeNumber(layerBounds.top),
      right: window.PO.normalizeNumber(layerBounds.right),
      bottom: window.PO.normalizeNumber(layerBounds.bottom),
    };
  }

  function getActiveLayerBounds() {
    var layer = app.activeDocument && app.activeDocument.activeLayer;
    if (!layer) return null;
    var normalized = normalizeBounds(layer.bounds);
    if (
      normalized &&
      typeof normalized.left === "number" &&
      typeof normalized.top === "number"
    ) {
      return normalized;
    }
    return null;
  }

  async function placePng(path) {
    await action.batchPlay(
      [
        {
          _obj: "placeEvent",
          null: { _path: path, _kind: "local" },
          freeTransformCenterState: {
            _enum: "quadCenterState",
            _value: "QCSAverage",
          },
          offset: {
            _obj: "offset",
            horizontal: { _unit: "pixelsUnit", _value: 0 },
            vertical: { _unit: "pixelsUnit", _value: 0 },
          },
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
    return app.activeDocument.activeLayer;
  }

  async function selectLayerById(layerId) {
    await action.batchPlay(
      [
        {
          _obj: "select",
          _target: [{ _ref: "layer", _id: layerId }],
          makeVisible: false,
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  async function moveActiveLayerTo(targetBounds) {
    if (!targetBounds || typeof targetBounds.left !== "number" || typeof targetBounds.top !== "number") {
      return;
    }

    var current = getActiveLayerBounds();
    if (!current) return;

    var offsetX = targetBounds.left - current.left;
    var offsetY = targetBounds.top - current.top;
    if (offsetX === 0 && offsetY === 0) return;

    await action.batchPlay(
      [
        {
          _obj: "move",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          to: {
            _obj: "offset",
            horizontal: { _unit: "pixelsUnit", _value: offsetX },
            vertical: { _unit: "pixelsUnit", _value: offsetY },
          },
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  async function loadActiveRedChannelAsSelection() {
    await action.batchPlay(
      [
        {
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          to: { _ref: "channel", _enum: "channel", _value: "red" },
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  async function deleteActiveLayer() {
    await action.batchPlay(
      [
        {
          _obj: "delete",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  async function makeMaskFromSelection() {
    await action.batchPlay(
      [
        {
          _obj: "make",
          new: { _class: "channel" },
          at: { _ref: "channel", _enum: "channel", _value: "mask" },
          using: { _enum: "userMaskEnabled", _value: "revealSelection" },
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  async function renameActiveLayer(layerName) {
    await action.batchPlay(
      [
        {
          _obj: "set",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          to: { _obj: "layer", name: layerName },
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  return core.executeAsModal(
    async function () {
      var placeStart = Date.now();
      window.PO.Logger.info("placement.started", {
        component: "placement",
        correlationId: window.PO.state.capture ? "po-place-" + Date.now().toString(36) : undefined,
        workflowId: workflowTitle,
        data: {
          hasImage: !!imagePngBase64,
          hasMask: !!maskPngBase64,
          imageLength: imagePngBase64 ? imagePngBase64.length : 0,
        },
      });

      var imagePath = await writeTempFile(
        "po-result-" + Date.now() + ".png",
        base64ToBytes(imagePngBase64),
      );

      var resultLayer = await placePng(imagePath);
      var resultLayerId = resultLayer && resultLayer.id;
      await moveActiveLayerTo(bounds);

      if (maskPngBase64) {
        var maskPath = await writeTempFile(
          "po-mask-" + Date.now() + ".png",
          base64ToBytes(maskPngBase64),
        );

        var maskLayer = await placePng(maskPath);
        var maskLayerId = maskLayer && maskLayer.id;
        await moveActiveLayerTo(bounds);
        await loadActiveRedChannelAsSelection();

        if (maskLayerId) {
          await selectLayerById(maskLayerId);
        }
        await deleteActiveLayer();

        if (resultLayerId) {
          await selectLayerById(resultLayerId);
        }
        await makeMaskFromSelection();
      }

      var layerName = (workflowTitle || "PixelOasis") + " - " + new Date().toLocaleString();
      await renameActiveLayer(layerName);

      window.PO.Logger.info("placement.completed", {
        component: "placement",
        workflowId: workflowTitle,
        durationMs: Date.now() - placeStart,
        data: { layerName: layerName },
      });

      return { layerName: layerName };
    },
    { commandName: "PixelOasis Place Generated Layer" },
  );
};



/* ===== scripts/ui-status.js ===== */
window.PO = window.PO || {};

window.PO.setStatus = function (message) {
  window.PO.state.status = message;
  if (window.PO.elements && window.PO.elements.statusNode) {
    window.PO.elements.statusNode.textContent = message;
  }
};

window.PO.showTransientStatus = function (message) {
  window.PO.clearTransientTimer();
  window.PO.setStatus(message);
  window.PO.state.transientTimer = setTimeout(function () {
    window.PO.refreshSelectionStatus();
  }, 1500);
};

window.PO.refreshSelectionStatus = async function () {
  window.PO.clearTransientTimer();
  try {
    var bounds = await window.PO.getSelectionBounds();
    window.PO.setStatus(window.PO.formatSelectionBounds(bounds));
  } catch (error) {
    window.PO.setStatus(error instanceof Error ? error.message : String(error));
  }
};



/* ===== scripts/ui-preview.js ===== */
window.PO = window.PO || {};

/* Simplified preview — image only, no metadata rows */
window.PO.updatePreview = function (capture) {
  window.PO.state.capture = capture;

  var els = window.PO.elements;
  if (!capture) {
    els.previewEmpty.hidden = false;
    els.previewImage.hidden = true;
    els.previewImage.removeAttribute("src");
    return;
  }

  els.previewImage.setAttribute(
    "src",
    window.PO.toDataUrl(capture.previewJpegBase64, "image/jpeg"),
  );
  els.previewImage.hidden = false;
  els.previewEmpty.hidden = true;
};



/* ===== scripts/ui-settings.js ===== */
window.PO = window.PO || {};

window.PO.toggleSettings = function () {
  var state = window.PO.state;
  var els = window.PO.elements;

  state.settingsOpen = !state.settingsOpen;

  if (state.settingsOpen) {
    els.settingsOverlay.hidden = false;
    els.settingsDrawer.hidden = false;
    els.settingsDrawer.setAttribute("aria-hidden", "false");
  } else {
    els.settingsOverlay.hidden = true;
    els.settingsDrawer.hidden = true;
    els.settingsDrawer.setAttribute("aria-hidden", "true");
  }
};

window.PO.initSettings = function () {
  var els = window.PO.elements;

  els.settingsButton.addEventListener("click", window.PO.toggleSettings);

  els.settingsOverlay.addEventListener("click", function () {
    if (window.PO.state.settingsOpen) {
      window.PO.toggleSettings();
    }
  });

  els.themeToggleButton.addEventListener("click", function () {
    var state = window.PO.state;
    state.themePressed = !state.themePressed;
    els.themeToggleButton.setAttribute(
      "aria-pressed",
      state.themePressed ? "true" : "false",
    );
    window.PO.showTransientStatus("theme toggle clicked");
  });

  /* Gateway URL — save on change */
  if (els.gatewayUrlInput) {
    els.gatewayUrlInput.value = window.PO.state.gatewayUrl || "http://127.0.0.1:8787";
    els.gatewayUrlInput.addEventListener("change", function () {
      var val = els.gatewayUrlInput.value.trim();
      if (val) {
        window.PO.state.gatewayUrl = val;
        window.PO.showTransientStatus("网关地址已更新");
      }
    });
  }

  /* ── Log settings ── */
  var logToggleBtn = document.getElementById("log-toggle-btn");
  var logLevelSelect = document.getElementById("log-level-select");
  var logClearBtn = document.getElementById("log-clear-btn");
  var logPathNode = document.getElementById("log-path-display");

  if (logToggleBtn) {
    logToggleBtn.setAttribute("aria-pressed", window.PO.state.logging.enabled ? "true" : "false");
    logToggleBtn.addEventListener("click", function () {
      window.PO.state.logging.enabled = !window.PO.state.logging.enabled;
      logToggleBtn.setAttribute("aria-pressed", window.PO.state.logging.enabled ? "true" : "false");
      window.PO.showTransientStatus("日志已" + (window.PO.state.logging.enabled ? "开启" : "关闭"));
    });
  }

  if (logLevelSelect) {
    logLevelSelect.value = window.PO.state.logging.level || "info";
    logLevelSelect.addEventListener("change", function () {
      window.PO.state.logging.level = logLevelSelect.value;
      window.PO.showTransientStatus("日志级别: " + logLevelSelect.value);
    });
  }

  if (logClearBtn) {
    logClearBtn.addEventListener("click", async function () {
      try {
        await window.PO.Logger.clearLogs();
        window.PO.showTransientStatus("日志已清空");
      } catch (e) {
        window.PO.showTransientStatus("清空日志失败: " + (e.message || e));
      }
    });
  }

  /* Display log path */
  if (logPathNode) {
    window.PO.Logger.getLogPath().then(function (p) {
      logPathNode.textContent = p;
    });
  }
};



/* ===== scripts/ui-parameters.js ===== */
window.PO = window.PO || {};

/* ── Per-workflow parameter persistence ── */
window.PO.workflowParams = {};

/* ── Currently open workflow id (null when page is closed) ── */
window.PO.activeWorkflowId = null;

/* ── Build parameter page HTML (called once, cached in DOM) ── */

window.PO.buildParameterPage = function () {
  return [
    '<div id="param-page" class="po-param-page" hidden>',

    /* Header */
    '<div class="po-param-page__header">',
    '<button id="param-back-btn" class="po-param-back-btn" type="button">← 返回</button>',
    '<span id="param-title" class="po-param-title"></span>',
    "</div>",

    /* Scrollable body */
    '<div class="po-param-page__scroll">',

    /* Prompt */
    '<div class="po-param-group">',
    '<label class="po-param-label" for="param-prompt">提示词</label>',
    '<textarea id="param-prompt" class="po-param-textarea" rows="3" placeholder="描述你希望生成的内容…"></textarea>',
    "</div>",

    /* Negative prompt */
    '<div class="po-param-group">',
    '<label class="po-param-label" for="param-neg-prompt">负面提示词</label>',
    '<textarea id="param-neg-prompt" class="po-param-textarea" rows="2" placeholder="描述你希望避免的内容…"></textarea>',
    "</div>",

    /* Seed + random toggle */
    '<div class="po-param-row">',
    '<div class="po-param-col">',
    '<label class="po-param-label" for="param-seed">Seed</label>',
    '<input id="param-seed" class="po-param-input" type="number" value="-1" />',
    "</div>",
    '<div class="po-param-col po-param-col--shrink">',
    '<button id="param-random-seed" class="po-param-toggle-btn" type="button">随机</button>',
    "</div>",
    "</div>",

    /* Steps */
    '<div class="po-param-group">',
    '<div class="po-param-range-header">',
    '<label class="po-param-label" for="param-steps">Steps</label>',
    '<span id="param-steps-val" class="po-param-range-val">28</span>',
    "</div>",
    '<input id="param-steps" class="po-param-range" type="range" min="1" max="100" value="28" />',
    "</div>",

    /* CFG */
    '<div class="po-param-group">',
    '<div class="po-param-range-header">',
    '<label class="po-param-label" for="param-cfg">CFG</label>',
    '<span id="param-cfg-val" class="po-param-range-val">7</span>',
    "</div>",
    '<input id="param-cfg" class="po-param-range" type="range" min="1" max="30" step="0.5" value="7" />',
    "</div>",

    /* Denoise */
    '<div class="po-param-group">',
    '<div class="po-param-range-header">',
    '<label class="po-param-label" for="param-denoise">Denoise</label>',
    '<span id="param-denoise-val" class="po-param-range-val">0.75</span>',
    "</div>",
    '<input id="param-denoise" class="po-param-range" type="range" min="0" max="1" step="0.01" value="0.75" />',
    "</div>",

    /* Sampler */
    '<div class="po-param-group">',
    '<label class="po-param-label" for="param-sampler">Sampler</label>',
    '<select id="param-sampler" class="po-param-select"></select>',
    "</div>",

    /* Scheduler */
    '<div class="po-param-group">',
    '<label class="po-param-label" for="param-scheduler">Scheduler</label>',
    '<select id="param-scheduler" class="po-param-select"></select>',
    "</div>",

    "</div>", /* end scroll */

    /* Action buttons (pinned at bottom of param page) */
    '<div class="po-param-actions">',
    '<button id="param-run-btn" class="po-button po-button--primary" type="button">生成</button>',
    '<button id="param-back-btn-bottom" class="po-button" type="button">返回</button>',
    "</div>",

    "</div>",
  ].join("");
};

/* ── Populate sampler / scheduler <select> options ── */

window.PO.populateSelectOptions = function (selectEl, options, selectedValue) {
  selectEl.innerHTML = "";
  for (var i = 0; i < options.length; i++) {
    var opt = document.createElement("option");
    opt.value = options[i];
    opt.textContent = options[i];
    if (options[i] === selectedValue) {
      opt.selected = true;
    }
    selectEl.appendChild(opt);
  }
};

/* ── Open parameter page for a workflow ── */

window.PO.openParameterPage = function (workflowId) {
  /* Check both WORKFLOWS and ENTRY_WORKFLOWS registries */
  var workflow = window.PO.WORKFLOWS[workflowId] || (window.PO.ENTRY_WORKFLOWS || {})[workflowId];
  if (!workflow) return;

  window.PO.activeWorkflowId = workflowId;

  /* Load persisted params or defaults */
  var saved = window.PO.workflowParams[workflowId];
  var params = saved || Object.assign({}, workflow.defaults);

  /* Populate UI */
  var els = window.PO.paramElements;
  els.title.textContent = workflow.title;
  els.prompt.value = params.prompt || "";
  els.negPrompt.value = params.negativePrompt || "";
  els.seed.value = params.seed;
  els.steps.value = params.steps;
  els.stepsVal.textContent = params.steps;
  els.cfg.value = params.cfg;
  els.cfgVal.textContent = params.cfg;
  els.denoise.value = params.denoise;
  els.denoiseVal.textContent = params.denoise;

  window.PO.populateSelectOptions(els.sampler, window.PO.SAMPLER_OPTIONS, params.sampler);
  window.PO.populateSelectOptions(els.scheduler, window.PO.SCHEDULER_OPTIONS, params.scheduler);

  /* Show */
  els.page.hidden = false;
};

/* ── Close parameter page (save current values first) ── */

window.PO.closeParameterPage = function () {
  window.PO.saveParameterPage();
  window.PO.activeWorkflowId = null;
  if (window.PO.paramElements) {
    window.PO.paramElements.page.hidden = true;
  }
};

/* ── Read current UI values and persist to workflowParams ── */

window.PO.saveParameterPage = function () {
  var workflowId = window.PO.activeWorkflowId;
  if (!workflowId) return;

  var els = window.PO.paramElements;
  window.PO.workflowParams[workflowId] = {
    prompt: els.prompt.value,
    negativePrompt: els.negPrompt.value,
    seed: parseInt(els.seed.value, 10) || -1,
    steps: parseInt(els.steps.value, 10) || 28,
    cfg: parseFloat(els.cfg.value) || 7,
    denoise: parseFloat(els.denoise.value) || 0.75,
    sampler: els.sampler.value,
    scheduler: els.scheduler.value,
  };
};

/* ── Build request payload from current params + capture state ── */

window.PO.assembleGenerateRequest = function () {
  var workflowId = window.PO.activeWorkflowId;
  if (!workflowId) return null;

  var params = window.PO.workflowParams[workflowId];
  if (!params) {
    var workflow = window.PO.WORKFLOWS[workflowId];
    params = workflow ? workflow.defaults : {};
  }

  var capture = window.PO.state.capture;
  var req = {
    correlationId: "po-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1000).toString(36),
    workflowId: workflowId,
    selection: capture ? {
      documentId: capture.documentId || "",
      bounds: capture.bounds || {},
      imagePngBase64: capture.imagePngBase64 || "",
      maskPngBase64: capture.maskPngBase64 || "",
      previewJpegBase64: capture.previewJpegBase64 || "",
      colorMode: capture.colorMode || "RGB",
      resolution: capture.resolution || 72,
    } : null,
    parameters: {
      prompt: params.prompt || "",
      negativePrompt: params.negativePrompt || "",
      seed: params.seed,
      steps: params.steps,
      cfg: params.cfg,
      denoise: params.denoise,
      sampler: params.sampler,
      scheduler: params.scheduler,
    },
  };

  window.PO.Logger.info("request.assembled", {
    component: "parameters",
    correlationId: req.correlationId,
    workflowId: workflowId,
    data: {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      seed: params.seed,
      steps: params.steps,
      cfg: params.cfg,
      denoise: params.denoise,
      sampler: params.sampler,
      scheduler: params.scheduler,
      hasSelection: !!capture,
    },
  });

  return req;
};

/* ── Event binding for parameter controls ── */

window.PO.initParameterPage = function () {
  var els = window.PO.paramElements;
  if (!els || !els.page) return;

  /* Back buttons */
  function doClose() { window.PO.closeParameterPage(); }
  els.backBtn.addEventListener("click", doClose);
  els.backBtnBottom.addEventListener("click", doClose);

  /* Random seed */
  els.randomSeedBtn.addEventListener("click", function () {
    var randomSeed = Math.floor(Math.random() * 2147483647);
    els.seed.value = randomSeed;
  });

  /* Range sliders → value display */
  els.steps.addEventListener("input", function () {
    els.stepsVal.textContent = els.steps.value;
  });

  els.cfg.addEventListener("input", function () {
    els.cfgVal.textContent = parseFloat(els.cfg.value).toFixed(1);
  });

  els.denoise.addEventListener("input", function () {
    els.denoiseVal.textContent = parseFloat(els.denoise.value).toFixed(2);
  });

  /* Run button — P3: send to gateway */
  els.runBtn.addEventListener("click", async function () {
    window.PO.saveParameterPage();
    var req = window.PO.assembleGenerateRequest();
    if (!req) {
      window.PO.showTransientStatus("无法组装请求");
      return;
    }
    if (!req.selection) {
      window.PO.showTransientStatus("请先抓取选区再生成");
      return;
    }

    var genStart = Date.now();
    var corrId = req.correlationId;

    /* Progress: check gateway */
    window.PO.setStatus("checking gateway...");
    window.PO.Logger.info("generation.started", {
      component: "parameters",
      correlationId: corrId,
      workflowId: req.workflowId,
    });

    var healthy = await window.PO.GatewayClient.health();
    if (!healthy) {
      window.PO.showTransientStatus("网关不可达 — 请确认 " + (window.PO.state.gatewayUrl || "http://127.0.0.1:8787") + " 已启动");
      window.PO.Logger.error("generation.failed", {
        component: "parameters",
        correlationId: corrId,
        workflowId: req.workflowId,
        error: { message: "Gateway unreachable" },
      });
      return;
    }

    /* Progress: sending */
    window.PO.setStatus("sending request...");
    els.runBtn.disabled = true;
    els.runBtn.textContent = "生成中...";

    try {
      var result = await window.PO.GatewayClient.generate(req);

      /* Accept both protocol name (imagePngBase64) and legacy mock name (imageBase64) */
      var returnedImage = (result && result.result && (result.result.imagePngBase64 || result.result.imageBase64)) || null;

      if (result && result.status === "succeeded" && returnedImage) {
        window.PO.state.lastResult = result;

        window.PO.Logger.info("generation.completed", {
          component: "parameters",
          correlationId: corrId,
          workflowId: req.workflowId,
          durationMs: Date.now() - genStart,
          data: {
            resultWidth: result.result.width,
            resultHeight: result.result.height,
            seed: result.result.seed,
          },
        });

        /* P4 — Place returned image as a new layer in Photoshop */
        window.PO.setStatus("placing layer...");
        var capture = window.PO.state.capture;
        var placeBounds = capture
          ? { left: capture.bounds.left, top: capture.bounds.top, width: capture.bounds.width, height: capture.bounds.height }
          : null;
        var workflowTitle = (window.PO.WORKFLOWS[req.workflowId] || {}).title || req.workflowId;

        try {
          var placeInfo = await window.PO.placeGeneratedLayer(
            returnedImage,
            capture ? capture.maskPngBase64 : null,
            placeBounds,
            workflowTitle,
          );
          window.PO.showTransientStatus("生成完成 — " + placeInfo.layerName);
        } catch (placeErr) {
          window.PO.showTransientStatus("生成完成但置入失败: " + (placeErr.message || placeErr));
          window.PO.Logger.error("placement.failed", {
            component: "parameters",
            correlationId: corrId,
            workflowId: req.workflowId,
            error: placeErr,
          });
        }
      } else {
        var errMsg = (result && result.error && result.error.message)
          ? result.error.message
          : "生成失败";
        window.PO.Logger.error("generation.failed", {
          component: "parameters",
          correlationId: corrId,
          workflowId: req.workflowId,
          durationMs: Date.now() - genStart,
          error: { message: errMsg },
        });
        window.PO.showTransientStatus(errMsg);
      }
    } catch (error) {
      window.PO.Logger.error("generation.failed", {
        component: "parameters",
        correlationId: corrId,
        workflowId: req.workflowId,
        durationMs: Date.now() - genStart,
        error: error,
      });
      window.PO.showTransientStatus(error instanceof Error ? error.message : String(error));
    } finally {
      els.runBtn.disabled = false;
      els.runBtn.textContent = "生成";
    }
  });
};



/* ===== scripts/actions.js ===== */
window.PO = window.PO || {};

/* Capture current selection + update preview.
 * Returns the capture object on success, null if no selection. */
window.PO.captureAndPreview = async function () {
  try {
    var captureStart = Date.now();
    window.PO.setStatus("capturing...");
    window.PO.Logger.info("capture.started", { component: "capture" });

    var capture = await window.PO.captureSelectionData();

    window.PO.updatePreview(capture);
    window.PO.showTransientStatus(window.PO.formatSelectionBounds(capture.bounds));

    window.PO.Logger.info("capture.completed", {
      component: "capture",
      durationMs: Date.now() - captureStart,
      data: {
        width: capture.bounds.width,
        height: capture.bounds.height,
        hasMask: !!capture.maskPngBase64,
        documentId: capture.documentId,
      },
    });
    return capture;
  } catch (error) {
    window.PO.updatePreview(null);
    window.PO.setStatus(error instanceof Error ? error.message : String(error));

    window.PO.Logger.error("capture.failed", {
      component: "capture",
      error: error,
    });
    return null;
  }
};

/* Workflow button handler — capture → preview → open param page */
window.PO.handleWorkflowButton = async function (workflowId) {
  var startTime = Date.now();
  window.PO.Logger.info("workflow.clicked", {
    component: "actions",
    workflowId: workflowId,
  });

  await window.PO.captureAndPreview();
  window.PO.openParameterPage(workflowId);
};

window.PO.bindEvents = function () {
  /* Settings (overlay + drawer) */
  window.PO.initSettings();

  /* Workflow buttons — any [data-workflow] element */
  var workflowBtns = document.querySelectorAll("[data-workflow]");
  for (var i = 0; i < workflowBtns.length; i++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        var workflowId = btn.getAttribute("data-workflow");
        if (workflowId) {
          window.PO.handleWorkflowButton(workflowId);
        }
      });
    })(workflowBtns[i]);
  }
};



/* ===== index.js ===== */
/* PixelOasis — Assembly & startup
 *
 * Dependencies (loaded via <script> tags in index.html, in order):
 *   scripts/ui-text.js        → window.PO.TEXT
 *   scripts/state.js           → window.PO.state, clearTransientTimer
 *   scripts/ui-template.js     → window.PO.buildTemplate
 *   scripts/ui-workflows.js    → window.PO.WORKFLOWS, CATEGORY_WORKFLOW
 *   scripts/vendor/png-encoder.js → window.PO.PngEncoder
 *   scripts/photoshop.js       → PS API wrappers
 *   scripts/ui-status.js      → setStatus, showTransientStatus, refreshSelectionStatus
 *   scripts/ui-preview.js      → updatePreview
 *   scripts/ui-settings.js     → toggleSettings, initSettings
 *   scripts/ui-parameters.js   → buildParameterPage, open/close/save, initParameterPage
 *   scripts/actions.js         → handleCapture, handleSelectTool, bindEvents
 */

(function () {
  try {
    /* ── Startup log ── */
    window.PO.Logger.info("plugin.started", {
      component: "startup",
      message: "PixelOasis initializing",
      data: { version: "0.1.0" },
    });

    /* ── Render template ── */
    var appRoot = document.getElementById("app");
    if (!appRoot) throw new Error("PixelOasis root element not found.");
    appRoot.innerHTML = window.PO.buildTemplate();

    /* ── Query DOM elements ── */
    window.PO.elements = {
      settingsButton: document.getElementById("settings-btn"),
      settingsOverlay: document.getElementById("settings-overlay"),
      settingsDrawer: document.getElementById("settings-drawer"),
      themeToggleButton: document.getElementById("theme-toggle-btn"),
      gatewayUrlInput: document.getElementById("gateway-url-input"),
      statusNode: document.getElementById("status"),
      previewEmpty: document.getElementById("preview-empty"),
      previewImage: document.getElementById("preview-image"),
    };

    /* ── Query parameter page elements ── */
    window.PO.paramElements = {
      page: document.getElementById("param-page"),
      title: document.getElementById("param-title"),
      backBtn: document.getElementById("param-back-btn"),
      backBtnBottom: document.getElementById("param-back-btn-bottom"),
      prompt: document.getElementById("param-prompt"),
      negPrompt: document.getElementById("param-neg-prompt"),
      seed: document.getElementById("param-seed"),
      randomSeedBtn: document.getElementById("param-random-seed"),
      steps: document.getElementById("param-steps"),
      stepsVal: document.getElementById("param-steps-val"),
      cfg: document.getElementById("param-cfg"),
      cfgVal: document.getElementById("param-cfg-val"),
      denoise: document.getElementById("param-denoise"),
      denoiseVal: document.getElementById("param-denoise-val"),
      sampler: document.getElementById("param-sampler"),
      scheduler: document.getElementById("param-scheduler"),
      runBtn: document.getElementById("param-run-btn"),
    };

    var els = window.PO.elements;

    /* Validate critical elements */
    if (
      !els.settingsButton ||
      !els.settingsOverlay ||
      !els.settingsDrawer ||
      !els.themeToggleButton ||
      !els.statusNode ||
      !els.previewEmpty ||
      !els.previewImage
    ) {
      throw new Error("PixelOasis UI element not found.");
    }

    /* ── Bind events ── */
    window.PO.bindEvents();

    /* ── Init parameter page ── */
    window.PO.initParameterPage();

    /* ── Startup ── */
    try {
      var photoshop = window.require("photoshop");
      if (photoshop && photoshop.app) {
        window.PO.updatePreview(null);
        window.PO.refreshSelectionStatus();
      } else {
        window.PO.setStatus("uxp shell ready");
      }
    } catch (error) {
      window.PO.setStatus(error instanceof Error ? error.message : String(error));
    }
  } catch (error) {
    window.PO.Logger.error("plugin.initialization_failed", {
      component: "startup",
      error: error,
    });
    document.body.innerHTML =
      '<pre class="po-fatal">' +
      (error instanceof Error ? error.stack || error.message : String(error)) +
      "</pre>";
  }
})();

