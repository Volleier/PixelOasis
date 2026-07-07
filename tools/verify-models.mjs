#!/usr/bin/env node
/* tools/verify-models.mjs — Model file verification
 *
 * ImplList §10.3 — Checks model existence and optional hash verification.
 */

import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { loadConfig, PROJECT_ROOT } from "./lib/config.mjs";
import { parse as parseYaml } from "yaml";
import { hashFile } from "./lib/hash.mjs";

console.log("PixelOasis Model Verification\n");

const config = loadConfig();
const manifestPath = resolve(PROJECT_ROOT, "services", "model-gateway", "models", "models.manifest.yaml");

if (!existsSync(manifestPath)) {
  console.error("Error: models.manifest.yaml not found at " + manifestPath);
  process.exit(1);
}

const raw = readFileSync(manifestPath, "utf-8");
const manifest = parseYaml(raw);
const models = manifest.models || [];

const comfyModelsDir = config.comfyui?.models_dir ||
  (config.comfyui?.root ? join(config.comfyui.root, "models") : "");

if (!comfyModelsDir) {
  console.error("Error: comfyui.models_dir or comfyui.root must be set in config.yaml.");
  process.exit(1);
}

let missingCount = 0;
let hashFailCount = 0;
let okCount = 0;

for (const model of models) {
  if (!model.required) continue;

  const modelPath = join(comfyModelsDir, model.folder || "", model.name);
  const exists = existsSync(modelPath);

  console.log((exists ? "  [OK]" : "  [MISSING]") + " " + model.name +
    " (" + (model.folder || "unknown") + ")");

  if (exists) {
    if (model.sha256 && model.sha256.trim()) {
      try {
        const actual = await hashFile(modelPath);
        if (actual === model.sha256.toLowerCase()) {
          console.log("    Hash: OK");
          okCount++;
        } else {
          console.log("    Hash: MISMATCH — expected " + model.sha256 + ", got " + actual);
          hashFailCount++;
        }
      } catch (err) {
        console.log("    Hash: ERROR — " + err.message);
        hashFailCount++;
      }
    } else {
      console.log("    Hash: not configured (skipped)");
      okCount++;
    }
  } else {
    missingCount++;
    /* Show download sources */
    if (model.sources) {
      for (const src of model.sources) {
        if (src.type === "manual") {
          console.log("    → Manual: " + (src.note || ""));
        } else if (src.url) {
          console.log("    → " + src.type + ": " + src.url);
        }
      }
    }
  }
}

console.log("");
console.log("Summary: " + okCount + " OK, " + missingCount + " missing, " + hashFailCount + " hash failures");

if (missingCount > 0) {
  console.log("Run: node tools/download-models.mjs");
}

if (missingCount > 0 || hashFailCount > 0) {
  process.exit(1);
}
