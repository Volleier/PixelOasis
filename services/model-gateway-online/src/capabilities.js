import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import config from "./config.js";

let cache = null;

function localized(value) {
  if (typeof value === "string") return value;
  return value?.["zh-CN"] || value?.default || Object.values(value || {})[0] || "";
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : (entry.name.endsWith(".capability.json") ? [path] : []);
  });
}

export function getCapabilities() {
  if (cache) return cache;
  cache = walk(config.capabilitiesDir).map(path => {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
      ...raw,
      title: localized(raw.title),
      description: localized(raw.description),
      variants: [{ id: "online", profile: "online", priority: 100, enabled: true }],
      availability: { state: config.upstream.apiKey ? "ready" : "blocked", profile: "online", details: config.upstream.apiKey ? null : { reason: "API_KEY_MISSING" } },
      online: { provider: "online", model: config.upstream.model },
    };
  }).filter(capability => capability.enabled !== false);
  return cache;
}

export function getCapability(id) {
  return getCapabilities().find(capability => capability.id === id) || null;
}
