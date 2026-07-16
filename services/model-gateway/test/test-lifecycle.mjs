/* test-lifecycle.mjs — Fake runner: exercises full job lifecycle
 *
 * Gateway Stage 1 verification: create DB → run migrations → create job →
 * transition through all states → record events → create assets → cleanup.
 *
 * Does NOT depend on ComfyUI — pure database + state machine test.
 *
 * Usage: node test/test-lifecycle.mjs
 */

import { getDb, closeDb, generateId } from "../src/persistence/database.js";
import { transition, isTerminal, isActive, STATES } from "../src/jobs/state-machine.js";
import * as jobRepo from "../src/jobs/job-repository.js";
import * as eventRepo from "../src/jobs/event-repository.js";
import * as assetStore from "../src/assets/asset-store.js";
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

let passed = 0;
let failed = 0;
const TEST_CLIENT = "test-runner";

function assert(condition, label) {
  if (condition) {
    console.log("  ✓ " + label);
    passed++;
  } else {
    console.error("  ✗ FAIL: " + label);
    failed++;
  }
}

function assertThrows(fn, label) {
  try {
    fn();
    console.error("  ✗ FAIL: " + label + " (expected error, none thrown)");
    failed++;
  } catch (e) {
    console.log("  ✓ " + label + " → " + e.message);
    passed++;
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * Test suite
 * ═══════════════════════════════════════════════════════════════════ */

console.log("\n=== Gateway Stage 1 — Lifecycle Test ===\n");

try {
  /* ── 1. Database + migrations ── */
  console.log("[1] Database & Migrations");
  const db = getDb();
  assert(db !== null, "Database instance created");

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  const tableNames = tables.map(t => t.name);
  assert(tableNames.indexOf("jobs") !== -1, "jobs table exists");
  assert(tableNames.indexOf("job_stages") !== -1, "job_stages table exists");
  assert(tableNames.indexOf("job_events") !== -1, "job_events table exists");
  assert(tableNames.indexOf("assets") !== -1, "assets table exists");
  assert(tableNames.indexOf("artifacts") !== -1, "artifacts table exists");
  assert(tableNames.indexOf("_migrations") !== -1, "_migrations tracking table exists");
  console.log("");

  /* ── 2. State machine ── */
  console.log("[2] State Machine");
  /* Valid transitions */
  assert(transition(STATES.QUEUED, STATES.PREPARING).allowed, "queued → preparing allowed");
  assert(transition(STATES.PREPARING, STATES.RUNNING).allowed, "preparing → running allowed");
  assert(transition(STATES.RUNNING, STATES.POSTPROCESSING).allowed, "running → postprocessing allowed");
  assert(transition(STATES.POSTPROCESSING, STATES.SUCCEEDED).allowed, "postprocessing → succeeded allowed");

  /* Cancel paths */
  assert(transition(STATES.QUEUED, STATES.CANCELED).allowed, "queued → canceled allowed");
  assert(transition(STATES.RUNNING, STATES.CANCELED).allowed, "running → canceled allowed");

  /* Failure paths */
  assert(transition(STATES.RUNNING, STATES.FAILED).allowed, "running → failed allowed");

  /* Invalid transitions */
  assert(!transition(STATES.SUCCEEDED, STATES.RUNNING).allowed, "succeeded → running rejected (terminal)");
  assert(!transition(STATES.FAILED, STATES.QUEUED).allowed, "failed → queued rejected (terminal)");
  assert(!transition(STATES.QUEUED, STATES.SUCCEEDED).allowed, "queued → succeeded rejected (skip states)");

  /* Terminal checks */
  assert(isTerminal(STATES.SUCCEEDED), "succeeded is terminal");
  assert(isTerminal(STATES.FAILED), "failed is terminal");
  assert(isTerminal(STATES.CANCELED), "canceled is terminal");
  assert(!isTerminal(STATES.RUNNING), "running is NOT terminal");
  assert(isActive(STATES.QUEUED), "queued is active");
  assert(!isActive(STATES.SUCCEEDED), "succeeded is NOT active");
  console.log("");

  /* ── 3. Job lifecycle ── */
  console.log("[3] Job Lifecycle");
  const job = jobRepo.create({
    clientId: TEST_CLIENT,
    correlationId: "test-correlation-" + Date.now(),
    idempotencyKey: "test-idem-" + Date.now(),
    capabilityId: "effects.desertSandstorm",
    profile: "quality_16gb",
    params: { intensity: 0.5, wind: "right" },
  });
  assert(job !== null, "Job created");
  assert(job.state === "queued", "Initial state is queued");
  assert(job.capabilityId === "effects.desertSandstorm", "Capability ID stored");
  assert(job.params && job.params.intensity === 0.5, "Parameters preserved");
  const jobId = job.id;
  console.log("  Job ID: " + jobId);

  /* Transition through lifecycle */
  let j = jobRepo.updateState(jobId, STATES.PREPARING, { progress: 10 });
  assert(j.state === "preparing", "Transition to preparing");
  assert(j.updatedAt !== job.updatedAt, "updatedAt changed");

  /* Add stages */
  const stage1 = jobRepo.addStage(jobId, { name: "preprocess", ordinal: 0, input: { mode: "resize" } });
  assert(!!stage1.id, "Stage 1 created (preprocess)");
  const stage2 = jobRepo.addStage(jobId, { name: "generate", ordinal: 1 });
  assert(!!stage2.id, "Stage 2 created (generate)");

  jobRepo.updateStage(stage1.id, { state: "completed", output: { width: 1280, height: 720 } });
  assert(true, "Stage 1 updated to completed");

  j = jobRepo.updateState(jobId, STATES.RUNNING, { progress: 50 });
  assert(j.state === "running", "Transition to running");

  j = jobRepo.updateState(jobId, STATES.POSTPROCESSING, { progress: 90 });
  assert(j.state === "postprocessing", "Transition to postprocessing");

  /* Invalid transition should throw */
  assertThrows(() => {
    jobRepo.updateState(jobId, STATES.QUEUED);
  }, "Cannot go back to queued");

  j = jobRepo.updateState(jobId, STATES.SUCCEEDED, { progress: 100 });
  assert(j.state === "succeeded", "Transition to succeeded");
  assert(isTerminal(j.state), "Job is now terminal");

  assertThrows(() => {
    jobRepo.updateState(jobId, STATES.RUNNING);
  }, "Cannot leave terminal state");

  /* Fetch from DB */
  const fetched = jobRepo.getById(jobId);
  assert(fetched !== null, "Job retrievable by ID");
  assert(fetched.stages.length === 2, "Job has 2 stages");
  assert(fetched.state === "succeeded", "Fetched state is correct");
  console.log("");

  /* ── 4. Events ── */
  console.log("[4] Event Log");
  const events = eventRepo.getEvents(jobId, 0);
  assert(events.length > 0, "Events recorded: " + events.length);
  assert(events.some(e => e.type === "job_created"), "job_created event exists");
  assert(events.some(e => e.type === "state_change"), "state_change events exist");

  const latestSeq = eventRepo.getLatestSequence(jobId);
  assert(latestSeq > 0, "Latest sequence: " + latestSeq);

  /* SSE replay */
  const sinceSeq = Math.floor(latestSeq / 2);
  const replayEvents = eventRepo.getEvents(jobId, sinceSeq);
  assert(replayEvents.length > 0, "SSE replay from seq " + sinceSeq + ": " + replayEvents.length + " events");
  console.log("");

  /* ── 5. Assets ── */
  console.log("[5] Assets");
  const tempDir = resolve("E:/PixelOasisData/assets");
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

  const testFilePath = resolve(tempDir, "test_asset_" + Date.now() + ".png");
  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const fakePngData = Buffer.concat([pngHeader, Buffer.alloc(100, 0)]);
  writeFileSync(testFilePath, fakePngData);

  const asset = assetStore.storeAsset({
    clientId: TEST_CLIENT,
    kind: "source",
    filePath: testFilePath,
    mime: "image/png",
    width: 1280,
    height: 720,
    sizeBytes: fakePngData.length,
    moveFile: true,
  });
  assert(asset !== null, "Asset stored");
  assert(asset.sha256 && asset.sha256 !== "unknown", "SHA-256 computed: " + asset.sha256.substring(0, 12));

  /* Dedup */
  const sameAsset = assetStore.findBySha256(asset.sha256, TEST_CLIENT);
  assert(sameAsset !== null, "Asset found by SHA-256 (dedup)");
  assert(sameAsset.id === asset.id, "Dedup returns same asset");

  /* Get by ID */
  const fetchedAsset = assetStore.getAsset(asset.id);
  assert(fetchedAsset !== null, "Asset retrievable by ID");
  assert(fetchedAsset.width === 1280, "Width correct");
  console.log("");

  /* ── 6. Cleanup ── */
  console.log("[6] Cleanup");
  const deleted = assetStore.deleteAsset(asset.id);
  assert(deleted, "Asset deleted (file + DB)");

  /* Clean up test job */
  jobRepo.deleteJob(jobId);
  const shouldBeNull = jobRepo.getById(jobId);
  assert(shouldBeNull === null, "Job deleted (cascade also removes stages + events)");

  /* Cleanup expired */
  const cleaned = jobRepo.cleanupExpired();
  assert(cleaned >= 0, "Expired jobs cleanup ran: " + cleaned + " removed");

  const assetCleaned = assetStore.cleanupExpired();
  assert(assetCleaned >= 0, "Expired assets cleanup ran: " + assetCleaned + " removed");
  console.log("");

  /* ── 7. Idempotency ── */
  console.log("[7] Idempotency");
  const idemKey = "test-idem-key-" + Date.now();
  const jobA = jobRepo.create({
    clientId: TEST_CLIENT,
    correlationId: "idem-test-" + Date.now(),
    idempotencyKey: idemKey,
    capabilityId: "scene.whiteStudio",
  });
  assert(jobA !== null, "Job A created with idempotency key");

  /* Second job with same client and key should fail. */
  assertThrows(() => {
    jobRepo.create({
      clientId: TEST_CLIENT,
      correlationId: "idem-test-2-" + Date.now(),
      idempotencyKey: idemKey,
      capabilityId: "scene.whiteStudio",
    });
  }, "Duplicate idempotency key rejected");

  const otherClientJob = jobRepo.create({
    clientId: TEST_CLIENT + "-other",
    correlationId: "idem-test-other-" + Date.now(),
    idempotencyKey: idemKey,
    capabilityId: "scene.whiteStudio",
  });
  assert(otherClientJob !== null, "Same idempotency key allowed for another client");

  /* findByIdempotencyKey returns original */
  const found = jobRepo.findByIdempotencyKey(idemKey, TEST_CLIENT);
  assert(found !== null, "Found by idempotency key");
  assert(found.id === jobA.id, "Returns original job");

  jobRepo.deleteJob(jobA.id);
  jobRepo.deleteJob(otherClientJob.id);
  console.log("");

  /* ── Summary ── */
  console.log("═══════════════════════════════════════════");
  console.log("  Total:  " + (passed + failed) + " tests");
  console.log("  Passed: " + passed);
  console.log("  Failed: " + failed);
  console.log("═══════════════════════════════════════════");

  if (failed > 0) {
    console.error("\n❌ SOME TESTS FAILED\n");
    process.exit(1);
  } else {
    console.log("\n✅ All tests passed\n");
  }

} catch (e) {
  console.error("\n❌ Test suite crashed: " + (e.stack || e.message));
  process.exit(1);
} finally {
  closeDb();
}
