/* assets-route.js — V2 asset upload and retrieval */

import { writeJson, v2NotFound, v2BadRequest } from "../../utils/errors.js";
import { storeAsset, getAsset } from "../../assets/asset-store.js";
import { generateId } from "../../persistence/database.js";
import { createHash } from "node:crypto";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import config from "../../config.js";
import logger from "../../utils/logger.js";

/* ── POST /v2/assets ── */
export async function handleAssetUpload(req, res, params) {
  const maxMb = config.uploadMaxMb || 100;
  const maxBytes = maxMb * 1024 * 1024;
  const contentType = req.headers["content-type"] || "";

  /* Validate content type */
  if (contentType.indexOf("multipart/form-data") === -1) {
    v2BadRequest(res, "INVALID_CONTENT_TYPE", "Expected multipart/form-data");
    return;
  }

  /* Extract boundary */
  const boundaryMatch = contentType.match(/boundary=([^;]+)/);
  if (!boundaryMatch) {
    v2BadRequest(res, "INVALID_CONTENT_TYPE", "Missing boundary in multipart");
    return;
  }
  const boundary = boundaryMatch[1].replace(/^["']|["']$/g, "");

  /* Buffer the entire body */
  const chunks = [];
  let totalBytes = 0;

  try {
    await new Promise((resolve, reject) => {
      req.on("data", (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          req.destroy();
          reject(Object.assign(new Error("File too large"), { statusCode: 413 }));
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", resolve);
      req.on("error", reject);
    });
  } catch (err) {
    if (err.statusCode === 413) {
      v2BadRequest(res, "FILE_TOO_LARGE", "File exceeds " + maxMb + " MB limit");
    } else {
      v2BadRequest(res, "UPLOAD_FAILED", err.message);
    }
    return;
  }

  /* Parse multipart */
  const buffer = Buffer.concat(chunks);
  const parts = _parseMultipart(buffer, boundary);
  const filePart = parts.find(p => p.name === "file" || p.filename || p.headers?.["content-disposition"]?.indexOf("filename=") !== -1);

  if (!filePart || !filePart.data) {
    v2BadRequest(res, "NO_FILE", "No file field found in upload");
    return;
  }

  /* Compute SHA-256 */
  const sha256 = createHash("sha256").update(filePart.data).digest("hex");

  /* Detect MIME from magic bytes */
  let mime = "application/octet-stream";
  if (filePart.data.length >= 8) {
    const isPng = filePart.data[0] === 137 && filePart.data[1] === 80 && filePart.data[2] === 78 && filePart.data[3] === 71;
    if (isPng) mime = "image/png";
    else if (filePart.data[0] === 0xFF && filePart.data[1] === 0xD8) mime = "image/jpeg";
    else if (filePart.data[0] === 0x52 && filePart.data[1] === 0x49) mime = "image/webp";
  }

  /* Write to temp file */
  const dataDir = config.dataDir || "E:/PixelOasisData";
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const tempPath = resolve(dataDir, "upload_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 10000).toString(36));
  writeFileSync(tempPath, filePart.data);

  /* Extract kind from form field or query */
  const kindPart = parts.find(p => p.name === "kind");
  const kind = (kindPart && kindPart.data && kindPart.data.toString("utf8").trim()) || params.get("kind") || "source";

  /* Store */
  const clientId = req.headers["x-client-id"] || "default";
  const assetId = generateId("ast");
  const asset = storeAsset({
    id: assetId, clientId, kind, filePath: tempPath,
    mime, sha256, sizeBytes: filePart.data.length, moveFile: true,
    ttlHours: kind === "artifact" ? (config.artifactTtlHours || 168) : 24,
  });

  writeJson(res, 201, {
    assetId: asset.id, sha256: asset.sha256, sizeBytes: asset.sizeBytes,
    mime: asset.mime, expiresAt: asset.expiresAt,
  });

  logger.info("asset.upload_v2", {
    component: "assets-route",
    data: { assetId: asset.id, kind, sha256: asset.sha256?.substring(0, 12), sizeBytes: asset.sizeBytes },
  });
}

/* ── Simple multipart parser ── */
function _parseMultipart(buffer, boundary) {
  const parts = [];
  const boundaryStr = "--" + boundary;
  const boundaryBuf = Buffer.from(boundaryStr);
  const endBoundary = Buffer.from(boundaryStr + "--");

  let pos = 0;
  while (pos < buffer.length) {
    const boundaryPos = buffer.indexOf(boundaryBuf, pos);
    if (boundaryPos === -1) break;
    if (buffer.indexOf(endBoundary, boundaryPos) === boundaryPos) break;

    /* Find headers end (double CRLF) */
    const headerStart = boundaryPos + boundaryBuf.length + 2; /* CRLF after boundary */
    const headerEnd = buffer.indexOf("\r\n\r\n", headerStart);
    if (headerEnd === -1) break;

    /* Parse headers */
    const headerBuf = buffer.subarray(headerStart, headerEnd);
    const headerText = headerBuf.toString("utf8");
    const headers = {};

    /* Extract Content-Disposition fields */
    const cdMatch = headerText.match(/Content-Disposition:\s*form-data;\s*name="([^"]*)"(?:;\s*filename="([^"]*)")?/i);
    let name = "", filename = "";
    if (cdMatch) {
      name = cdMatch[1] || "";
      filename = cdMatch[2] || "";
    }

    /* Body */
    const bodyStart = headerEnd + 4; /* \r\n\r\n */
    const nextBoundary = buffer.indexOf(boundaryBuf, bodyStart);
    const bodyEnd = nextBoundary !== -1 ? nextBoundary - 2 : buffer.length; /* -2 for CRLF before boundary */

    const data = buffer.subarray(bodyStart, bodyEnd);

    parts.push({ name, filename, headers: { "content-disposition": headerText }, data });

    pos = bodyEnd;
  }

  return parts;
}

/* ── HEAD /v2/assets/{id} ── */
export async function handleAssetHead(req, res, routeParams) {
  const id = routeParams.id;
  const asset = getAsset(id);

  if (!asset) { res.statusCode = 404; res.end(); return; }
  if (asset.expiresAt && new Date(asset.expiresAt) < new Date()) { res.statusCode = 410; res.end(); return; }
  res.statusCode = 200;
  res.setHeader("Content-Type", asset.mime || "image/png");
  res.setHeader("Content-Length", asset.sizeBytes || 0);
  res.end();
}
