/* loader.js — Load .capability.json files from disk
 *
 * Recursively scans the capabilities directory. Parse errors on one file
 * don't crash the whole load — they're reported in the errors array.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import logger from "../utils/logger.js";

/* ═══════════════════════════════════════════════════════════════════
 * loadAll(capDir) → { capabilities, byId, errors, revision }
 * ═══════════════════════════════════════════════════════════════════ */

export function loadAll(capDir) {
  const capabilities = [];
  const byId = {};
  const errors = [];
  let latestMtime = 0;

  if (!capDir || !existsSync(capDir)) {
    logger.warn("capabilities.no_dir", { component: "capability-loader", data: { dir: capDir } });
    return { capabilities, byId, errors, revision: "none" };
  }

  _scanDir(capDir, capabilities, byId, errors, { latestMtime });

  const revision = latestMtime ? "cap-" + latestMtime.toString(36) : "unknown";

  logger.info("capabilities.loaded", {
    component: "capability-loader",
    data: { count: capabilities.length, errors: errors.length, revision },
  });

  return { capabilities, byId, errors, revision };
}

function _scanDir(dir, capabilities, byId, errors, stats) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    errors.push({ dir, error: e.message });
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      _scanDir(fullPath, capabilities, byId, errors, stats);
    } else if (entry.name.endsWith(".capability.json")) {
      try {
        const raw = readFileSync(fullPath, "utf8");
        const cap = JSON.parse(raw);

        /* Track latest modification time */
        const mtime = statSync(fullPath).mtimeMs;
        if (mtime > stats.latestMtime) stats.latestMtime = mtime;

        if (!cap.id) {
          errors.push({ file: fullPath, error: "Missing id field" });
          continue;
        }

        if (byId[cap.id]) {
          errors.push({ file: fullPath, error: "Duplicate capability id: " + cap.id });
          continue;
        }

        byId[cap.id] = cap;
        capabilities.push(cap);
      } catch (e) {
        errors.push({ file: fullPath, error: e.message });
        logger.warn("capabilities.parse_error", {
          component: "capability-loader",
          data: { file: fullPath, error: e.message },
        });
      }
    }
  }
}

export default { loadAll };
