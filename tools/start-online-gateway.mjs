#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFiles } from "../services/model-gateway-online/src/env.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const serviceDir = resolve(projectRoot, "services", "model-gateway-online");

loadEnvFiles([projectRoot, serviceDir]);

const apiKey = process.env.PO_ONLINE_API_KEY || process.env.ONLINE_API_KEY;
if (!apiKey) {
  console.error("PO_ONLINE_API_KEY is required (can be set in .env.local or environment variable).");
  console.error('$env:PO_ONLINE_API_KEY = "sk-..."');
  process.exit(1);
}

const baseUrl = process.env.PO_ONLINE_BASE_URL || process.env.ONLINE_BASE_URL || process.env.PO_ONLINE_DRAW_URL;
if (!baseUrl) {
  console.warn("[WARN] PO_ONLINE_BASE_URL is not set.");
  console.warn('Set it before generating images: $env:PO_ONLINE_BASE_URL = "https://<upstream-host>"');
}

const child = spawn(process.execPath, [resolve(serviceDir, "src", "server.js")], {
  cwd: serviceDir,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", code => process.exit(code ?? 0));
