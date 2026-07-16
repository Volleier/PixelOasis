/* assets-route.js — v2 streamed asset upload and ownership-aware HEAD */

import { writeJson, v2BadRequest } from "../../utils/errors.js";
import { storeAsset, getAsset } from "../../assets/asset-store.js";
import { generateId } from "../../persistence/database.js";
import { handleUpload } from "../../assets/upload-stream.js";
import config from "../../config.js";
import logger from "../../utils/logger.js";

export async function handleAssetUpload(req, res) {
  try {
    const upload = await handleUpload(req, config.dataDir);
    const clientId = req.headers["x-client-id"] || "default";
    const asset = storeAsset({
      id: generateId("ast"),
      clientId,
      kind: upload.kind,
      filePath: upload.tempPath,
      mime: upload.mime,
      sha256: upload.sha256,
      sizeBytes: upload.sizeBytes,
      moveFile: true,
      ttlHours: upload.kind === "artifact" ? config.artifactTtlHours : undefined,
    });

    writeJson(res, 201, {
      assetId: asset.id,
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
      mime: asset.mime,
      expiresAt: asset.expiresAt,
    });
    logger.info("asset.upload_v2", {
      component: "assets-route",
      correlationId: upload.correlationId,
      data: { assetId: asset.id, kind: upload.kind, sizeBytes: asset.sizeBytes },
    });
  } catch (error) {
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
