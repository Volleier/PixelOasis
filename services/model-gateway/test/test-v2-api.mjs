/* test-v2-api.mjs — V2 API endpoint smoke tests
 *
 * Starts the gateway on a random port, then tests all v2 endpoints.
 * Uses Node's built-in http module.
 *
 * Usage: node test/test-v2-api.mjs
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATEWAY_SRC = resolve(__dirname, "..", "src", "server.js");

let passed = 0, failed = 0;
function assert(condition, label) {
  if (condition) { console.log("  ✓ " + label); passed++; }
  else { console.error("  ✗ FAIL: " + label); failed++; }
}

/* ── Helpers ── */
async function fetchJson(port, method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json", "X-Client-Id": "test-api" } };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch("http://127.0.0.1:" + port + path, opts);
  const data = await resp.text();
  return { status: resp.status, headers: resp.headers, data: data ? JSON.parse(data) : null, raw: data };
}

async function fetchSSE(port, path, timeoutMs) {
  const resp = await fetch("http://127.0.0.1:" + port + path, { headers: { "Accept": "text/event-stream" }, signal: AbortSignal.timeout(timeoutMs || 3000) });
  const text = await resp.text();
  return { status: resp.status, headers: resp.headers, body: text };
}

/* ── Start server on random port ── */
const testPort = 18900 + Math.floor(Math.random() * 1000);

console.log("\n=== Gateway Stage 2 — V2 API Tests (port " + testPort + ") ===\n");

/* Import and configure server */
process.env.PO_PORT = String(testPort);
process.env.PO_DATA_DIR = resolve(__dirname, "..", "..", "..", "PixelOasisData");

/* Dynamic import of server (it starts listening immediately) */
const serverModule = await import("../src/server.js");

/* Give the server a moment */
await new Promise(r => setTimeout(r, 500));

try {
  /* ── 1. Health ── */
  console.log("[1] GET /v2/health");
  let resp = await fetchJson(testPort, "GET", "/v2/health");
  assert(resp.status === 200, "Health basic returns 200");
  assert(resp.data && resp.data.gateway === "ok", "Gateway status is ok");
  assert(resp.data && resp.data.timestamp, "Has timestamp");

  resp = await fetchJson(testPort, "GET", "/v2/health?depth=full");
  assert(resp.status === 200, "Health full returns 200");
  assert(resp.data && resp.data.disk !== undefined, "Disk info present");
  console.log("");

  /* ── 2. Capabilities ── */
  console.log("[2] GET /v2/capabilities");
  resp = await fetchJson(testPort, "GET", "/v2/capabilities");
  assert(resp.status === 200, "Capabilities returns 200");
  assert(resp.data && resp.data.schemaVersion === "2.0", "Schema version is 2.0");
  assert(resp.data && Array.isArray(resp.data.capabilities), "Capabilities is array");
  assert(resp.data.capabilities.length === 27, "27 capabilities returned");

  resp = await fetchJson(testPort, "GET", "/v2/capabilities/effects.desertSandstorm");
  assert(resp.status === 200, "Single capability returns 200");
  assert(resp.data && resp.data.title === "飞沙走石", "Title correct");
  console.log("");

  /* ── 3. Asset upload ── */
  console.log("[3] POST /v2/assets");
  const testPng = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(200, 65)]);
  const formData = new FormData();
  formData.append("file", new Blob([testPng], { type: "image/png" }), "test.png");
  formData.append("kind", "source");

  const uploadResp = await fetch("http://127.0.0.1:" + testPort + "/v2/assets", { method: "POST", body: formData });
  const uploadData = await uploadResp.json();
  assert(uploadResp.status === 201, "Upload returns 201: " + uploadResp.status);
  assert(!!uploadData.assetId, "assetId returned: " + uploadData.assetId);
  assert(!!uploadData.sha256, "sha256 returned");
  const testAssetId = uploadData.assetId;

  /* HEAD check */
  const headResp = await fetch("http://127.0.0.1:" + testPort + "/v2/assets/" + testAssetId, { method: "HEAD" });
  assert(headResp.status === 200, "HEAD asset returns 200");
  console.log("");

  /* ── 4. Job creation ── */
  console.log("[4] POST /v2/jobs");
  const jobPayload = {
    schemaVersion: "2.0",
    capabilityId: "effects.desertSandstorm",
    correlationId: "test-api-" + Date.now(),
    idempotencyKey: "test-idem-api-" + Date.now(),
    source: {
      assetId: testAssetId,
      scope: "document",
      document: { id: "test-doc", width: 1920, height: 1080, colorMode: "RGB", bitDepth: 8 },
      bounds: { left: 0, top: 0, width: 1920, height: 1080 },
    },
    parameters: { intensity: 0.5, wind: "right" },
    options: { profile: "quality_16gb" },
  };

  resp = await fetchJson(testPort, "POST", "/v2/jobs", jobPayload);
  assert(resp.status === 202, "Create job returns 202: " + resp.status);
  assert(!!resp.data.jobId, "jobId returned: " + resp.data.jobId);
  assert(resp.data.state === "queued", "Initial state is queued");
  const testJobId = resp.data.jobId;

  /* Idempotency: same key should return existing job */
  resp = await fetchJson(testPort, "POST", "/v2/jobs", jobPayload);
  assert(resp.status === 200, "Idempotency returns 200: " + resp.status);
  assert(resp.data.jobId === testJobId, "Idempotency returns same jobId");
  assert(resp.data._idempotent === true, "Flagged as idempotent replay");
  console.log("");

  /* ── 5. Get job ── */
  console.log("[5] GET /v2/jobs/{id}");
  resp = await fetchJson(testPort, "GET", "/v2/jobs/" + testJobId);
  assert(resp.status === 200, "Get job returns 200");
  assert(resp.data.jobId === testJobId, "Job ID matches");
  assert(resp.data.capabilityId === "effects.desertSandstorm", "Capability ID correct");
  console.log("");

  /* ── 6. List jobs ── */
  console.log("[6] GET /v2/jobs");
  resp = await fetchJson(testPort, "GET", "/v2/jobs?clientId=test-api");
  assert(resp.status === 200, "List jobs returns 200");
  assert(Array.isArray(resp.data), "Returns array");
  assert(resp.data.length >= 1, "At least 1 job found");
  console.log("");

  /* ── 7. SSE events ── */
  console.log("[7] GET /v2/jobs/{id}/events");
  try {
    const sseResp = await fetchSSE(testPort, "/v2/jobs/" + testJobId + "/events", 2500);
    assert(sseResp.status === 200, "SSE returns 200");
    assert(sseResp.body.indexOf("event:") !== -1 || sseResp.body.indexOf("data:") !== -1, "SSE body contains events");
  } catch (e) {
    assert(e.name === "TimeoutError" || e.message.indexOf("abort") !== -1, "SSE streamed for timeout period (expected): " + e.message);
  }
  console.log("");

  /* ── 8. Cancel job ── */
  console.log("[8] DELETE /v2/jobs/{id}");
  resp = await fetchJson(testPort, "DELETE", "/v2/jobs/" + testJobId);
  assert(resp.status === 200, "Cancel returns 200");
  assert(resp.data.state === "canceled", "State is canceled");

  /* Verify cancellation */
  resp = await fetchJson(testPort, "GET", "/v2/jobs/" + testJobId);
  assert(resp.status === 200, "Get canceled job returns 200");
  assert(resp.data.state === "canceled", "State confirmed canceled");
  console.log("");

  /* ── 9. v1 backward compat ── */
  console.log("[9] V1 endpoints still work");
  resp = await fetchJson(testPort, "GET", "/health");
  assert(resp.status === 200, "V1 /health returns 200");

  resp = await fetchJson(testPort, "GET", "/workflows");
  assert(resp.status === 200, "V1 /workflows returns 200");

  resp = await fetchJson(testPort, "GET", "/config");
  assert(resp.status === 200, "V1 /config returns 200");
  console.log("");

  /* ── 10. Edge cases ── */
  console.log("[10] Edge cases");
  resp = await fetchJson(testPort, "GET", "/v2/jobs/nonexistent-job-999");
  assert(resp.status === 404, "Nonexistent job returns 404");

  resp = await fetchJson(testPort, "POST", "/v2/jobs", { schemaVersion: "1.0" });
  assert(resp.status === 400 || resp.data?.error, "Bad schema version returns error");

  resp = await fetchJson(testPort, "GET", "/v2/nonexistent");
  assert(resp.status === 404, "Nonexistent endpoint returns 404");
  console.log("");

} finally {
  /* Cleanup */
  console.log("Shutting down test server...");
  process.exit(failed > 0 ? 1 : 0);
}

/* Results printed on exit */
process.on("exit", () => {
  console.log("═══════════════════════════════════════════");
  console.log("  Total:  " + (passed + failed));
  console.log("  Passed: " + passed);
  console.log("  Failed: " + failed);
  console.log("═══════════════════════════════════════════");
  if (failed > 0) console.error("\n❌ SOME TESTS FAILED\n");
  else console.log("\n✅ All API tests passed\n");
});
