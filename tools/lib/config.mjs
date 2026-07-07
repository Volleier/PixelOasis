/* tools/lib/config.mjs — Shared config.yaml reader for tools scripts */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..");

export function loadConfig() {
  const configPath = resolve(PROJECT_ROOT, "config.yaml");

  if (!existsSync(configPath)) {
    console.error("Error: config.yaml not found at " + configPath);
    console.error("Fill in your local paths and re-run.");
    process.exit(1);
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    return parseYaml(raw) || {};
  } catch (err) {
    console.error("Error: failed to parse config.yaml:", err.message);
    process.exit(1);
  }
}

export { PROJECT_ROOT };
