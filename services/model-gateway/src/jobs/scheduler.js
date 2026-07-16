/* jobs/scheduler.js — GPU worker scheduler with concurrency=1
 *
 * GatewayOrchestrationDesign §5.2: FIFO queue, single GPU worker.
 * Priority: user foreground > retry > preview.
 */

import * as jobRepo from "./job-repository.js";
import config from "../config.js";
import logger from "../utils/logger.js";

const _queue = [];
let _running = false;
let _processing = null; /* currently processing jobId */

/* ── Enqueue a job for processing ── */
export function enqueue(jobId) {
  /* Avoid duplicates */
  if (_queue.indexOf(jobId) !== -1 || _processing === jobId) return;
  _queue.push(jobId);
  logger.info("scheduler.enqueued", { component: "scheduler", data: { jobId, queueLength: _queue.length } });
}

/* ── Dequeue next job (FIFO) ── */
export function dequeue() {
  if (_queue.length === 0) return null;
  const jobId = _queue.shift();
  _processing = jobId;
  return jobId;
}

/* ── Mark job as done processing ── */
export function done(jobId) {
  if (_processing === jobId) _processing = null;
}

/* ── Get next queued job from database (on restart recovery) ── */
export function recoverQueuedJobs() {
  try {
    const queuedJobs = jobRepo.getActive().filter(job => job.state === "queued");
    for (const job of queuedJobs) {
      if (_queue.indexOf(job.id) === -1 && _processing !== job.id) {
        _queue.push(job.id);
      }
    }
    logger.info("scheduler.recovered", { component: "scheduler", data: { count: queuedJobs.length } });
  } catch (e) {
    logger.error("scheduler.recovery_failed", { component: "scheduler", error: e });
  }
}

/* ── Get current queue state ── */
export function getQueueState() {
  return { processing: _processing, queued: _queue.slice(), length: _queue.length };
}

/* ── Cancel a queued job (not yet processing) ── */
export function cancelQueued(jobId) {
  const idx = _queue.indexOf(jobId);
  if (idx !== -1) {
    _queue.splice(idx, 1);
    jobRepo.updateState(jobId, "canceled", { message: "Canceled from queue" });
    return true;
  }
  return false;
}

export default { enqueue, dequeue, done, recoverQueuedJobs, getQueueState, cancelQueued };
