import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    const result = {};
    const content = readFileSync(filePath, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[key] = val;
    }
    return result;
  } catch {
    return {};
  }
}

export function loadEnvFiles(searchDirs = []) {
  const merged = {};
  for (const dir of searchDirs) {
    Object.assign(merged, parseEnvFile(resolve(dir, ".env")));
    Object.assign(merged, parseEnvFile(resolve(dir, ".env.local")));
  }

  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = value;
    }
  }

  return merged;
}
