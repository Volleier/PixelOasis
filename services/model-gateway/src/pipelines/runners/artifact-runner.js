/* pipelines/runners/artifact-runner.js — Artifact packaging runner
 *
 * BlackSmokeDust B2: registers output buffers as artifacts with placement info.
 * Used as the final stage in capability pipelines.
 */

import { getDb } from "../../persistence/database.js";
import logger from "../../utils/logger.js";

export async function runArtifactRunner(ctx, config) {
  const { jobId, traceId, outputs } = ctx;
  const roles = config.roles || ["result"];
  const db = getDb();

  logger.info("artifact_runner.packaging", { component: "artifact-runner", traceId, jobId, data: { roles } });

  const results = [];
  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    const bufKey = role + "Buffer";
    const buf = outputs[bufKey];

    if (!buf) {
      logger.warn("artifact_runner.missing_buffer", { component: "artifact-runner", traceId, jobId, data: { role } });
      continue;
    }

    /* Get existing artifact record from the worker, or create placeholder */
    const existing = db.prepare(
      "SELECT id FROM artifacts WHERE job_id = ? AND role = ?"
    ).get(jobId, role);

    if (!existing) {
      /* Create placeholder artifact entry */
      const artifactId = "art_" + jobId + "_" + role;
      const placementJson = JSON.stringify({
        layerName: role,
        groupName: "PixelOasis",
        blendMode: "normal",
        opacity: 100,
        order: (i + 1) * 10,
      });

      db.prepare(`
        INSERT INTO artifacts (id, job_id, role, asset_id, placement_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(artifactId, jobId, role, artifactId, placementJson);
    }

    results.push({ role, registered: true });
  }

  logger.info("artifact_runner.complete", { component: "artifact-runner", traceId, jobId, data: { count: results.length } });

  return { stage: "artifact", outputs: {}, results };
}

export default { runArtifactRunner };
