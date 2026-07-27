/* artifacts-route.js — V2 artifact download
 *
 * GET /v2/artifacts/{id} → stream artifact file
 */

import { existsSync, createReadStream, statSync } from "node:fs";
import { v2NotFound } from "../../utils/errors.js";
import { getDb } from "../../persistence/database.js";
import { getAsset } from "../../assets/asset-store.js";
import logger from "../../utils/logger.js";

export async function handleArtifactDownload(req, res, routeParams) {
  const artifactId = routeParams.id;

  /* Look up artifact in DB */
  const db = getDb();
  const artifact = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(artifactId);
  if (!artifact) {
    v2NotFound(res, "ARTIFACT_NOT_FOUND", "Artifact not found");
    return;
  }

  const job = db.prepare("SELECT client_id, trace_id, correlation_id FROM jobs WHERE id = ?").get(artifact.job_id);
  const clientId = req.headers["x-client-id"] || "default";
  if (!job || job.client_id !== clientId) {
    v2NotFound(res, "ARTIFACT_NOT_FOUND", "Artifact not found");
    return;
  }

  /* Get the underlying asset */
  const asset = getAsset(artifact.asset_id);
  if (!asset || !existsSync(asset.path)) {
    v2NotFound(res, "ARTIFACT_FILE_MISSING", "Artifact file not found on disk");
    return;
  }

  /* Get file stats */
  const stats = statSync(asset.path);
  const fileSize = stats.size;

  /* Set headers */
  res.statusCode = 200;
  res.setHeader("Content-Type", asset.mime || "image/png");
  res.setHeader("Content-Length", fileSize);
  res.setHeader("ETag", '"' + (asset.sha256 || artifactId) + '"');
  res.setHeader("Cache-Control", "public, max-age=3600");

  /* Handle Range requests */
  const range = req.headers["range"];
  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const requestedEnd = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      if (start >= fileSize || requestedEnd < start) {
        res.statusCode = 416;
        res.setHeader("Content-Range", "bytes */" + fileSize);
        res.end();
        return;
      }
      const end = Math.min(requestedEnd, fileSize - 1);
      res.statusCode = 206;
      res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + fileSize);
      res.setHeader("Content-Length", end - start + 1);
      const stream = createReadStream(asset.path, { start, end });
      stream.pipe(res);
      stream.on("error", () => { if (!res.headersSent) v2NotFound(res, "STREAM_ERROR", "Stream error"); });
      return;
    }
  }

  /* Full download */
  const stream = createReadStream(asset.path);
  stream.pipe(res);
  stream.on("error", () => { if (!res.headersSent) v2NotFound(res, "STREAM_ERROR", "Stream error"); });

  logger.info("artifact.download_v2", {
    component: "artifacts-route",
    traceId: job.trace_id || job.correlation_id,
    correlationId: job.correlation_id,
    jobId: artifact.job_id,
    asset: {
      role: artifact.role,
      originalName: artifact.id + ".png",
      mimeType: asset.mime || "image/png",
      sizeBytes: fileSize,
      width: artifact.width || asset.width || null,
      height: artifact.height || asset.height || null,
      sha256Prefix: asset.sha256 ? asset.sha256.substring(0, 12) : null,
    },
    data: { artifactId, assetId: artifact.asset_id },
  });
}
