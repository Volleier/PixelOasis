#!/usr/bin/env node
/* tools/download-models.mjs — Model download script
 *
 * ImplList §10.2 — Downloads models per models.manifest.yaml using the
 * mirror priority from config.yaml.
 *
 * Usage: node tools/download-models.mjs [model-id]
 *   Without arguments: download all required models.
 *   With model-id: download only that model.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { loadConfig, PROJECT_ROOT } from "./lib/config.mjs";
import { downloadFile } from "./lib/download.mjs";
import { hashFile } from "./lib/hash.mjs";
import { parse as parseYaml } from "yaml";

console.log("PixelOasis Model Download\n");

function formatBytesForLog(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

const config = loadConfig();
const manifestPath = resolve(PROJECT_ROOT, "services", "model-gateway", "models", "models.manifest.yaml");

if (!existsSync(manifestPath)) {
  console.error("Error: models.manifest.yaml not found.");
  process.exit(1);
}

const raw = readFileSync(manifestPath, "utf-8");
const manifest = parseYaml(raw);
const models = manifest.models || [];

const mirrors = (config.models?.mirrors) || ["modelscope", "huggingface-mirror", "huggingface", "manual"];
const cacheDir = config.models?.cache_dir || resolve(PROJECT_ROOT, "tools", "cache", "models");
const comfyModelsDir = config.comfyui?.models_dir ||
  (config.comfyui?.root ? join(config.comfyui.root, "models") : "");

if (!comfyModelsDir) {
  console.error("Error: comfyui.models_dir or comfyui.root must be set in config.yaml.");
  process.exit(1);
}

const targetId = process.argv[2] || null;

/* Ensure cache directory */
if (!existsSync(cacheDir)) {
  mkdirSync(cacheDir, { recursive: true });
}

let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const model of models) {
  if (!model.required) continue;
  if (targetId && model.id !== targetId) continue;

  const destDir = join(comfyModelsDir, model.folder || "");
  const destPath = join(destDir, model.name);

  /* Skip if already exists and hash matches */
  if (existsSync(destPath)) {
    if (config.models?.verify_hash && model.sha256) {
      try {
        const actual = await hashFile(destPath);
        if (actual === model.sha256.toLowerCase()) {
          console.log("  [SKIP] " + model.name + " (already exists, hash OK)");
          skipped++;
          continue;
        }
      } catch (_) { /* re-download if hash check fails */ }
    } else {
      console.log("  [SKIP] " + model.name + " (already exists)");
      skipped++;
      continue;
    }
  }

  console.log("\n  Model: " + model.name + " (" + (model.sizeGb || "?") + " GB)");

  /* Ensure destination directory */
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  /* Try each mirror in priority order */
  let success = false;

  for (const mirrorType of mirrors) {
    if (mirrorType === "manual") {
      console.log("  [MANUAL] " + (model.sources?.find(function(s) {
        return s.type === "manual";
      })?.note || "Download manually and place in " + destDir));
      failed++;
      success = true; /* don't try other mirrors after manual */
      break;
    }

    const source = (model.sources || []).find(function(s) { return s.type === mirrorType; });
    if (!source || !source.url) {
      continue;
    }

    console.log("  Trying " + mirrorType + ": " + source.url);

    try {
      /* Download to cache first */
      const cachePath = join(cacheDir, model.name);

      /* Remove any stale 0-byte cache file from a previous failed attempt */
      if (existsSync(cachePath)) {
        try {
          const st = statSync(cachePath);
          if (st.size === 0) {
            console.log("  Removing stale 0-byte cache file...");
            unlinkSync(cachePath);
          } else if (st.size > 0) {
            /* Partial / existing cache — verify and reuse if hash matches */
            if (config.models?.verify_hash && model.sha256) {
              try {
                const existingHash = await hashFile(cachePath);
                if (existingHash === model.sha256.toLowerCase()) {
                  console.log("  Using cached file (hash OK, " + formatBytesForLog(st.size) + ")");
                  copyFileSync(cachePath, destPath);
                  console.log("  [OK] Copied from cache to " + destPath);
                  downloaded++;
                  success = true;
                  break;
                } else {
                  console.log("  Cached file hash mismatch — re-downloading...");
                  unlinkSync(cachePath);
                }
              } catch (_) {
                console.log("  Cached file unreadable — re-downloading...");
                try { unlinkSync(cachePath); } catch (__) {}
              }
            } else {
              /* No hash configured — reuse existing cache file */
              console.log("  Using cached file (" + formatBytesForLog(st.size) + ")");
              copyFileSync(cachePath, destPath);
              console.log("  [OK] Copied from cache to " + destPath);
              downloaded++;
              success = true;
              break;
            }
          }
        } catch (_) { /* proceed to download */ }
      }

      await downloadFile(source.url, cachePath);

      /* Verify the downloaded file is non-empty before hash check */
      try {
        const st = statSync(cachePath);
        if (st.size === 0) {
          console.error("  Downloaded file is empty (0 bytes). Removing.");
          unlinkSync(cachePath);
          continue;
        }
      } catch (_) { /* continue to hash check */ }

      /* Verify hash */
      if (config.models?.verify_hash && model.sha256) {
        const actualHash = await hashFile(cachePath);
        if (actualHash !== model.sha256.toLowerCase()) {
          console.error("  Hash mismatch! Removing cached file.");
          try { unlinkSync(cachePath); } catch (_) {}
          continue;
        }
      }

      /* Copy to ComfyUI models directory */
      copyFileSync(cachePath, destPath);
      console.log("  [OK] Downloaded to " + destPath);
      downloaded++;
      success = true;
      break;
    } catch (err) {
      /* Clean up any partial download */
      const cachePath = join(cacheDir, model.name);
      try { if (existsSync(cachePath)) unlinkSync(cachePath); } catch (_) {}
      console.error("  Failed: " + err.message);
      if (err.cause) {
        console.error("    Cause: " + (err.cause.code || err.cause.message || String(err.cause)));
      }
      if (mirrorType === "huggingface") {
        console.error("    Hint: Hugging Face may require a token or the URL may have changed.");
        console.error("    Try one of:");
        console.error("      - Set up a HF mirror in config.yaml models.mirrors");
        console.error("      - Download manually: see models.manifest.yaml for the manual note");
      }
    }
  }

  if (!success && mirrors.indexOf("manual") === -1) {
    console.error("  [FAILED] All mirrors exhausted for " + model.name);
    failed++;
  }
}

console.log("\nDone: " + downloaded + " downloaded, " + skipped + " skipped, " + failed + " failed.");

if (failed > 0) {
  process.exit(1);
}
