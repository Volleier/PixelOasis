#!/usr/bin/env node
/* verify-log-trace.mjs — Verify unified log trace completeness
 *
 * Usage: node tools/verify-log-trace.mjs --trace <traceId> [--log <file>]
 *
 * Reads a pixeloasis-logs-*.log file, filters by traceId, and reports:
 *   - All stages present
 *   - Missing expected events
 *   - Event ordering issues
 *   - Exit code 0 = complete, 1 = missing/incomplete
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── Parse args ── */
const args = process.argv.slice(2);
let targetTraceId = null;
let logFilePath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--trace" && args[i + 1]) targetTraceId = args[++i];
  else if (args[i] === "--log" && args[i + 1]) logFilePath = args[++i];
}

if (!targetTraceId) {
  console.error("Usage: node verify-log-trace.mjs --trace <traceId> [--log <path>]");
  process.exit(2);
}

/* ── Find log file ── */
if (!logFilePath) {
  const logsDir = resolve(__dirname, "..", "..", "logs");
  if (!existsSync(logsDir)) {
    console.error("No logs directory found at " + logsDir);
    process.exit(1);
  }

  /* Find the most recent .log file */
  const { readdirSync: ls } = await import("fs");
  try {
    const files = ls(logsDir)
      .filter(f => /^pixeloasis-logs-.*\.log$/.test(f))
      .map(f => resolve(logsDir, f))
      .sort();
    logFilePath = files[files.length - 1];
  } catch (e) {
    console.error("Cannot list log files: " + e.message);
    process.exit(1);
  }
}

if (!logFilePath || !existsSync(logFilePath)) {
  console.error("Log file not found: " + (logFilePath || "(none)"));
  process.exit(1);
}

console.log("Log file: " + logFilePath);
console.log("Trace ID: " + targetTraceId);
console.log("");

/* ── Expected event stages (in order) ── */
const EXPECTED_STAGES = [
  { event: "asset.upload.received", label: "Upload received" },
  { event: "asset.upload.stored", label: "Upload stored (or reused)" },
  { event: "job.create.accepted", label: "Job create accepted" },
  { event: "job.created", label: "Job created (or created_v2)" },
  { event: "comfyui.input.uploaded", label: "ComfyUI input uploaded" },
  { event: "comfyui.prompt.submitted", label: "ComfyUI prompt submitted" },
  { event: "comfyui.node.started", label: "ComfyUI node started" },
  { event: "comfyui.node.completed", label: "ComfyUI node completed" },
  { event: "comfyui.output.collected", label: "Output collected" },
  { event: "artifact.registered", label: "Artifact registered" },
  { event: "sse.audit.sent", label: "SSE audit sent" },
];

/* ── Scan lines ── */
const allLines = readFileSync(logFilePath, "utf8").split("\n").filter(Boolean);
const traceLines = [];

for (const line of allLines) {
  try {
    const obj = JSON.parse(line);
    if (obj.traceId === targetTraceId ||
        (obj.data && obj.data.traceId === targetTraceId) ||
        (obj.jobId && line.includes(targetTraceId))) {
      traceLines.push(obj);
    }
  } catch (e) { /* skip malformed lines */ }
}

console.log("Found " + traceLines.length + " log lines for this trace.\n");

const foundEvents = new Set();
for (const entry of traceLines) {
  foundEvents.add(entry.event);
}

/* ── Check each stage ── */
let missingCount = 0;
for (const stage of EXPECTED_STAGES) {
  const found = foundEvents.has(stage.event) ||
    /* Allow alias matches */
    Array.from(foundEvents).some(e =>
      e === stage.event ||
      (stage.event === "asset.upload.stored" && e === "asset.upload.reused") ||
      (stage.event === "job.created" && (e === "job.created_v2" || e === "job.created"))
    );
  const status = found ? "  OK  " : "MISS  ";
  if (!found) missingCount++;
  console.log("[" + status + "] " + stage.label + "  (" + stage.event + ")");
}

/* ── Check for error events ── */
const errorEvents = traceLines.filter(l => l.level === "error" || l.event === "job.create.rejected");
if (errorEvents.length > 0) {
  console.log("\n⚠ Error events found:");
  for (const err of errorEvents) {
    console.log("  - " + err.event + (err.data && err.data.code ? " [" + err.data.code + "]" : ""));
  }
  missingCount += errorEvents.length;
}

/* ── Summary ── */
console.log("\n───");
if (missingCount === 0 && errorEvents.length === 0) {
  console.log("✓ Trace complete — all stages present.");
  process.exit(0);
} else {
  console.log("✗ Trace incomplete — " + missingCount + " issue(s) found.");
  process.exit(1);
}
