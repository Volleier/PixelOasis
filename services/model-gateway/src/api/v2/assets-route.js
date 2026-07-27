/* assets-route.js — v2 streamed asset upload and ownership-aware HEAD */

import { writeJson, v2BadRequest } from "../../utils/errors.js";
import { storeAsset, getAsset } from "../../assets/asset-store.js";
import { generateId } from "../../persistence/database.js";
import { handleUpload } from "../../assets/upload-stream.js";
import config from "../../config.js";
import logger from "../../utils/logger.js";
import sharp from "sharp";
import { mergeMultipartTrace } from "../../observability/trace-context.js";

export async function handleAssetUpload(req, res) {
  try {
    const startedAt = Date.now();
    const requestTrace = req._traceContext || null;
    logger.info("asset.upload.started", {
      component: "assets-route",
      traceId: requestTrace?.traceId,
      correlationId: requestTrace?.correlationId,
      data: { clientId: (requestTrace?.clientId || req.headers["x-client-id"] || "default").substring(0, 8) + "..." },
    });
    const upload = await handleUpload(req, config.dataDir);
    const trace = mergeMultipartTrace(req, upload.fields);
    const clientId = req.headers["x-client-id"] || "default";
    const imageInfo = await sharp(upload.tempPath).metadata();
    const assetMeta = {
      role: upload.kind,
      originalName: trace?.assetMeta?.originalName || upload.filename || null,
      mimeType: upload.mime,
      sizeBytes: upload.sizeBytes,
      width: imageInfo.width || null,
      height: imageInfo.height || null,
      sourceScale: trace?.assetMeta?.sourceScale || 1,
      sha256Prefix: upload.sha256.substring(0, 12),
    };

    logger.info("asset.upload.received", {
      component: "assets-route",
      traceId: trace?.traceId,
      correlationId: trace?.correlationId || upload.correlationId,
      asset: assetMeta,
    });
    const asset = storeAsset({
      id: generateId("ast"),
      clientId,
      kind: upload.kind,
      filePath: upload.tempPath,
      mime: upload.mime,
      sha256: upload.sha256,
      sizeBytes: upload.sizeBytes,
      width: imageInfo.width || null,
      height: imageInfo.height || null,
      traceId: trace?.traceId,
      moveFile: true,
      ttlHours: upload.kind === "artifact" ? config.artifactTtlHours : undefined,
    });

    writeJson(res, 201, {
      assetId: asset.id,
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
      mime: asset.mime,
      expiresAt: asset.expiresAt,
      metadata: assetMeta,
    });
    logger.info(asset.reused ? "asset.upload.reused" : "asset.upload.stored", {
      component: "assets-route",
      traceId: trace?.traceId,
      correlationId: trace?.correlationId || upload.correlationId,
      durationMs: Date.now() - startedAt,
      asset: assetMeta,
      data: { assetId: asset.id },
    });
  } catch (error) {
    const trace = req._traceContext || null;
    logger.warn("asset.upload.failed", {
      component: "assets-route",
      traceId: trace?.traceId,
      correlationId: trace?.correlationId,
      error,
    });
    const tooLarge = /limit|too large/i.test(error.message || "");
    v2BadRequest(res, tooLarge ? "FILE_TOO_LARGE" : "UPLOAD_FAILED", error.message || "Upload failed");
  }
}

export async function handleAssetHead(req, res, routeParams) {
  const asset = getAsset(routeParams.id);
  const clientId = req.headers["x-client-id"] || "default";
  if (!asset || asset.clientId !== clientId) { res.statusCode = 404; res.end(); return; }
  res.statusCode = 200;
  res.setHeader("Content-Type", asset.mime || "image/png");
  res.setHeader("Content-Length", asset.sizeBytes || 0);
  res.setHeader("ETag", '"' + asset.sha256 + '"');
  res.end();
}
