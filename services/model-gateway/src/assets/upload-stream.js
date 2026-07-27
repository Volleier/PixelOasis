/* upload-stream.js — bounded streaming multipart parser for v2 assets */

import Busboy from "busboy";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import config from "../config.js";

const ALLOWED_KINDS = new Set(["source", "editMask", "subjectMask", "reference", "artifact"]);
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function handleUpload(req, dataDir) {
  const maxBytes = (config.uploadMaxMb || 100) * 1024 * 1024;
  const tempDir = resolve(dataDir || config.dataDir, "incoming");
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });

  const fields = {};
  let upload = null;
  let uploadError = null;
  const fileTasks = [];

  const busboy = Busboy({
    headers: req.headers,
    limits: { files: 1, fields: 8, fileSize: maxBytes, fieldSize: 1024 },
  });

  busboy.on("field", (name, value) => {
    fields[name] = value;
  });

  busboy.on("file", (name, stream, info) => {
    if (name !== "file" || upload) {
      stream.resume();
      uploadError = uploadError || new Error("Exactly one file field is required");
      return;
    }

    const tempPath = resolve(tempDir, "upload_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2));
    const hash = createHash("sha256");
    let sizeBytes = 0;
    let firstBytes = Buffer.alloc(0);
    const output = createWriteStream(tempPath, { flags: "wx" });

    stream.on("data", (chunk) => {
      sizeBytes += chunk.length;
      hash.update(chunk);
      if (firstBytes.length < 16) firstBytes = Buffer.concat([firstBytes, chunk]).subarray(0, 16);
    });
    stream.on("limit", () => {
      uploadError = new Error("File exceeds configured upload limit");
    });

    const task = pipeline(stream, output).then(() => {
      if (uploadError) throw uploadError;
      upload = {
        tempPath,
        sha256: hash.digest("hex"),
        sizeBytes,
        mime: detectMime(firstBytes),
        originalMime: info.mimeType,
        filename: info.filename,
      };
    });
    fileTasks.push(task);
  });

  const finished = new Promise((resolvePromise, rejectPromise) => {
    busboy.once("finish", resolvePromise);
    busboy.once("error", rejectPromise);
  });
  req.pipe(busboy);
  await finished;
  await Promise.all(fileTasks);

  if (uploadError) {
    if (upload?.tempPath) safeUnlink(upload.tempPath);
    throw uploadError;
  }
  if (!upload) throw new Error("No file field found in upload");
  if (!ALLOWED_MIME.has(upload.mime)) {
    safeUnlink(upload.tempPath);
    throw new Error("Unsupported image format");
  }

  const kind = fields.kind || "source";
  if (!ALLOWED_KINDS.has(kind)) {
    safeUnlink(upload.tempPath);
    throw new Error("Unsupported asset kind");
  }

  return { ...upload, kind, correlationId: fields.correlationId || "", fields };
}

function detectMime(header) {
  if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (header[0] === 0xff && header[1] === 0xd8) return "image/jpeg";
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "application/octet-stream";
}

function safeUnlink(path) {
  try { unlinkSync(path); } catch (_) { /* best effort */ }
}

export default { handleUpload };
