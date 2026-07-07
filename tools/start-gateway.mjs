#!/usr/bin/env node
/* tools/start-gateway.mjs — Gateway launcher
 *
 * ImplList §10.5 — Reads config.yaml, sets environment variables, starts the gateway.
 *
 * Usage: node tools/start-gateway.mjs
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadConfig, PROJECT_ROOT } from "./lib/config.mjs";

console.log("PixelOasis Gateway Launcher\n");

const config = loadConfig();

/* ── Set environment variables from config ── */
const env = { ...process.env };

/* Gateway settings */
const gw = config.model_gateway || {};
if (gw.host) env.PO_HOST = gw.host;
if (gw.port) env.PO_PORT = String(gw.port);
if (gw.provider) env.PO_MODEL_PROVIDER = gw.provider;
if (gw.log_level) env.PO_LOG_LEVEL = gw.log_level;

/* ComfyUI URL */
const comfyUrl = config.comfyui?.url;
if (comfyUrl) env.COMFYUI_URL = comfyUrl;

/* Logging */
env.PO_LOG_ENABLED = "1";

console.log("  Gateway: http://" + (env.PO_HOST || "127.0.0.1") + ":" + (env.PO_PORT || "8787"));
console.log("  Provider: " + (env.PO_MODEL_PROVIDER || "comfyui"));
console.log("  ComfyUI: " + (env.COMFYUI_URL || "http://127.0.0.1:8000"));
console.log("");

const serverPath = resolve(PROJECT_ROOT, "services", "model-gateway", "src", "server.js");

console.log("Starting model-gateway...\n");

const child = spawn("node", [serverPath], {
  cwd: resolve(PROJECT_ROOT, "services", "model-gateway"),
  env: env,
  stdio: "inherit",
  shell: true,
});

child.on("error", function (err) {
  console.error("Failed to start gateway:", err.message);
  process.exit(1);
});

child.on("exit", function (code) {
  console.log("\nGateway exited with code " + code);
  process.exit(code || 0);
});

/* Forward SIGINT / SIGTERM */
process.on("SIGINT", function () { child.kill("SIGINT"); });
process.on("SIGTERM", function () { child.kill("SIGTERM"); });
