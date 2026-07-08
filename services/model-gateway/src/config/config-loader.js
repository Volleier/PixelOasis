/* config-loader.js — Load config.yaml from project root, merge with env vars
 *
 * ImplList §1.3 — Gateway config loader.
 *
 * Priority: env var > config.yaml > built-in defaults.
 * Locates the project root by walking up from this module's location.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

/* ── Project root resolution ──────────────────────────────
 *
 * This file lives at:  <project>/services/model-gateway/src/config/config-loader.js
 * Walk up 4 levels to reach the project root.                        */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/* ── Built-in defaults (lowest priority) ────────────────── */
const DEFAULTS = {
  photoshop: {
    plugin_path: "",
    min_major_version: 2026,
    min_host_version: "27.0.0",
  },
  comfyui: {
    root: "",
    url: "http://127.0.0.1:51818",
    models_dir: "",
  },
  model_gateway: {
    host: "127.0.0.1",
    port: 8787,
    provider: "comfyui",
    log_level: "info",
  },
  models: {
    mirrors: ["modelscope", "huggingface-mirror", "huggingface", "manual"],
    allow_large_models: true,
    verify_hash: true,
    cache_dir: "",
  },
  pixel_oasis: {
    debug_workflows: true,
    keep_intermediate_images: false,
    default_result_layer_group: "PixelOasis",
  },
};

/* ── Env var mapping ────────────────────────────────────── */
const ENV_MAP = {
  PO_HOST:              ["model_gateway", "host"],
  PO_PORT:              ["model_gateway", "port", "int"],
  PO_MODEL_PROVIDER:    ["model_gateway", "provider"],
  COMFYUI_URL:          ["comfyui", "url"],
  PO_LOG_LEVEL:         ["model_gateway", "log_level"],
  PO_LOG_DIR:           ["logging", "dir"],        // logging is merged separately
};

/* ── Normalize a path field ─────────────────────────────── */
function normalizePath(value) {
  if (typeof value !== "string" || value.trim() === "") return value;
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

/* ── Normalize paths in a config object ─────────────────── */
function normalizePaths(obj) {
  if (typeof obj !== "object" || obj === null) return;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === "string" && (key.endsWith("_path") || key.endsWith("_dir") || key === "root" || key === "cache_dir")) {
      obj[key] = normalizePath(val);
    } else if (typeof val === "object" && val !== null) {
      normalizePaths(val);
    }
  }
}

/* ── Apply env var overrides ────────────────────────────── */
function applyEnvOverrides(config) {
  for (const [envKey, target] of Object.entries(ENV_MAP)) {
    const raw = process.env[envKey];
    if (raw === undefined || raw === "") continue;

    const [section, key, type] = target;

    if (section === "logging") {
      // logging dir is a special case — stored under config.logging.dir
      if (!config.logging) config.logging = {};
      config.logging[key] = raw;
      continue;
    }

    if (!config[section]) config[section] = {};

    if (type === "int") {
      config[section][key] = parseInt(raw, 10);
    } else {
      config[section][key] = raw;
    }
  }
}

/* ── Deep merge (target is mutated, source is read-only) ── */
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      typeof source[key] === "object" &&
      source[key] !== null &&
      !Array.isArray(source[key]) &&
      typeof target[key] === "object" &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

/* ── Load ───────────────────────────────────────────────── */
export function loadConfig() {
  const warnings = [];

  /* 1. Start from defaults */
  const config = JSON.parse(JSON.stringify(DEFAULTS));

  /* 2. Layer on config.yaml (middle priority) */
  const configPath = path.join(PROJECT_ROOT, "config.yaml");

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = parseYaml(raw);

      if (parsed && typeof parsed === "object") {
        deepMerge(config, parsed);
      }
    } catch (err) {
      warnings.push("Failed to parse config.yaml: " + err.message);
    }
  } else {
    warnings.push("config.yaml not found at " + configPath + " — using defaults");
  }

  /* 3. Layer on env vars (highest priority) */
  applyEnvOverrides(config);

  /* 4. Normalize path fields */
  normalizePaths(config);

  /* 5. Coerce port to number (yaml may produce string) */
  if (config.model_gateway && typeof config.model_gateway.port === "string") {
    config.model_gateway.port = parseInt(config.model_gateway.port, 10);
  }

  return { config, warnings };
}
