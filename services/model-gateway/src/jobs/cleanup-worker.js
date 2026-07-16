/* jobs/cleanup-worker.js — Background TTL cleanup worker
 *
 * Stage 8: periodically cleans expired jobs, assets, and artifacts.
 * Runs on startup and every hour thereafter.
 */

import { cleanupExpired as cleanupJobs } from "./job-repository.js";
import { cleanupExpired as cleanupAssets } from "../assets/asset-store.js";
import { getDb } from "../persistence/database.js";
import logger from "../utils/logger.js";

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; /* 1 hour */
let _timer = null;

export function start() {
  if (_timer) return;
  logger.info("cleanup_worker.started", { component: "cleanup-worker", data: { intervalMs: CLEANUP_INTERVAL_MS } });

  /* Run immediately */
  _runCleanup();

  /* Schedule periodic */
  _timer = setInterval(_runCleanup, CLEANUP_INTERVAL_MS);
}

export function stop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info("cleanup_worker.stopped", { component: "cleanup-worker" });
  }
}

function _runCleanup() {
  try {
    const jobCount = cleanupJobs();
    const assetCount = cleanupAssets();

    /* Also cleanup orphaned job_stages and events (cascade handles most, but belt-and-suspenders) */
    const db = getDb();
    db.prepare("DELETE FROM job_events WHERE job_id NOT IN (SELECT id FROM jobs)").run();
    db.prepare("DELETE FROM job_stages WHERE job_id NOT IN (SELECT id FROM jobs)").run();
    db.prepare("DELETE FROM artifacts WHERE job_id NOT IN (SELECT id FROM jobs)").run();

    if (jobCount > 0 || assetCount > 0) {
      logger.info("cleanup_worker.cycle_complete", {
        component: "cleanup-worker",
        data: { jobsCleaned: jobCount, assetsCleaned: assetCount },
      });
    }
  } catch (e) {
    logger.error("cleanup_worker.error", { component: "cleanup-worker", error: e });
  }
}

export default { start, stop };
