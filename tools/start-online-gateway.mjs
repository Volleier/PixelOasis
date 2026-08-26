#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const serviceDir = resolve(projectRoot, "services", "model-gateway-online");

if (!process.env.FEIFEIMIAO_API_KEY) {
  console.error("FEIFEIMIAO_API_KEY is required.");
  console.error('$env:FEIFEIMIAO_API_KEY = "sk-..."');
  process.exit(1);
}

const child = spawn(process.execPath, [resolve(serviceDir, "src", "server.js")], {
  cwd: serviceDir,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", code => process.exit(code ?? 0));
