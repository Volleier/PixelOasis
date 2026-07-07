/* utils/images.js — PNG image utilities
 *
 * DevList §6 — Phase G4/G5.
 *
 * Image scaling for the auto-resize pipeline: when a source image exceeds
 * the workflow's max supported dimension, the gateway scales it down before
 * sending to ComfyUI and scales the result back up to the original size.
 *
 * Uses sharp for fast, low-memory PNG processing. */

import sharp from "sharp";

/**
 * Decode a base64 PNG payload to a raw Buffer + metadata.
 *
 * @param {string} base64  raw base64 string (no data: prefix) or with prefix
 * @returns {{ buffer: Buffer, info: object }}
 */
async function decodePng(base64) {
  /* Strip data:image/png;base64, prefix if present */
  var payload = base64;
  var match = payload.match(/^data:image\/\w+;base64,(.+)$/);
  if (match) {
    payload = match[1];
  }

  var buffer = Buffer.from(payload, "base64");

  /* Verify it's actually a PNG */
  if (buffer.length < 8 || buffer[0] !== 0x89 || buffer[1] !== 0x50) {
    throw new Error("Not a valid PNG image.");
  }

  var metadata = await sharp(buffer).metadata();
  return { buffer: buffer, info: metadata };
}

/**
 * Encode a raw pixel Buffer as a PNG base64 string.
 *
 * @param {Buffer} buffer  raw PNG bytes
 * @returns {string}  base64-encoded PNG (no data: prefix — pure base64)
 */
async function encodePngBase64(buffer) {
  /* sharp(input).png() ensures the output is valid PNG */
  var pngBuffer = await sharp(buffer).png().toBuffer();
  return pngBuffer.toString("base64");
}

/**
 * Scale an image to fit within a maximum dimension, maintaining aspect ratio.
 *
 * @param {string} base64Png       input PNG as base64
 * @param {number} maxDimension    max width or height allowed
 * @returns {{
 *   base64: string,        // scaled PNG as base64
 *   width: number,         // new width
 *   height: number,        // new height
 *   originalWidth: number,
 *   originalHeight: number,
 *   scaled: boolean,
 *   scale: number          // scale factor applied
 * }}
 */
export async function scaleImageDown(base64Png, maxDimension) {
  var decoded = await decodePng(base64Png);
  var w = decoded.info.width || 1;
  var h = decoded.info.height || 1;

  /* Already within limits */
  if (w <= maxDimension && h <= maxDimension) {
    return {
      base64: base64Png.replace(/^data:image\/\w+;base64,/, ""),
      width: w,
      height: h,
      originalWidth: w,
      originalHeight: h,
      scaled: false,
      scale: 1.0,
    };
  }

  /* Calculate scale factor */
  var scale = maxDimension / Math.max(w, h);
  var newWidth = Math.round(w * scale);
  var newHeight = Math.round(h * scale);

  var resizedBuffer = await sharp(decoded.buffer)
    .resize(newWidth, newHeight, { fit: "inside", kernel: "lanczos3" })
    .png()
    .toBuffer();

  var base64 = resizedBuffer.toString("base64");

  return {
    base64: base64,
    width: newWidth,
    height: newHeight,
    originalWidth: w,
    originalHeight: h,
    scaled: true,
    scale: scale,
  };
}

/**
 * Upscale a result image back to the original selection dimensions.
 *
 * @param {Buffer|string} pngBytes  the output PNG from ComfyUI
 * @param {number} targetWidth      original selection width
 * @param {number} targetHeight     original selection height
 * @returns {string}  base64-encoded upscaled PNG
 */
export async function scaleImageUp(pngBytes, targetWidth, targetHeight) {
  var buffer = Buffer.isBuffer(pngBytes) ? pngBytes : Buffer.from(pngBytes);

  /* Check current dimensions */
  var meta = await sharp(buffer).metadata();

  if (meta.width === targetWidth && meta.height === targetHeight) {
    /* Already correct size */
    return buffer.toString("base64");
  }

  var upscaled = await sharp(buffer)
    .resize(targetWidth, targetHeight, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();

  return upscaled.toString("base64");
}

/**
 * Get image dimensions from a base64 PNG without full decode.
 * (Fast path — reads only the IHDR chunk.)
 *
 * @param {string} base64Png
 * @returns {{ width: number, height: number }}
 */
export function getPngDimensions(base64Png) {
  var payload = base64Png;
  var match = payload.match(/^data:image\/\w+;base64,(.+)$/);
  if (match) payload = match[1];

  var buffer = Buffer.from(payload, "base64");

  /* PNG: 8-byte signature, then IHDR at offset 8
   * IHDR: 4-byte length, 4-byte "IHDR", 4-byte width, 4-byte height */
  if (buffer.length < 24) return { width: 0, height: 0 };
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50) return { width: 0, height: 0 };

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export default {
  scaleImageDown,
  scaleImageUp,
  getPngDimensions,
  decodePng,
  encodePngBase64,
};
