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

/* ── ImplList §5.2 additions ── */

/**
 * Resize an image to exact target dimensions.
 *
 * @param {Buffer|string} input  PNG buffer or base64 string
 * @param {number} width
 * @param {number} height
 * @param {object}   [options]
 * @param {string}   [options.fit="fill"]   sharp fit mode
 * @param {string}   [options.kernel="lanczos3"]
 * @returns {Promise<Buffer>}  resized PNG buffer
 */
export async function resizeToExact(input, width, height, options) {
  var opts = options || {};
  var fit = opts.fit || "fill";
  var kernel = opts.kernel || "lanczos3";

  var buffer;
  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else if (typeof input === "string") {
    var payload = input.replace(/^data:image\/\w+;base64,/, "");
    buffer = Buffer.from(payload, "base64");
  } else {
    throw new Error("resizeToExact: input must be Buffer or base64 string.");
  }

  return sharp(buffer)
    .resize(width, height, { fit: fit, kernel: kernel })
    .png()
    .toBuffer();
}

/**
 * Crop an image to a rectangle.
 *
 * @param {Buffer|string} input   PNG buffer or base64 string
 * @param {object} cropRect       { left, top, width, height }
 * @returns {Promise<Buffer>}     cropped PNG buffer
 */
export async function cropToBounds(input, cropRect) {
  var buffer;
  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else if (typeof input === "string") {
    var payload = input.replace(/^data:image\/\w+;base64,/, "");
    buffer = Buffer.from(payload, "base64");
  } else {
    throw new Error("cropToBounds: input must be Buffer or base64 string.");
  }

  return sharp(buffer)
    .extract({
      left: Math.max(0, cropRect.left || 0),
      top: Math.max(0, cropRect.top || 0),
      width: cropRect.width,
      height: cropRect.height,
    })
    .png()
    .toBuffer();
}

/**
 * Pad an image with a solid color border.
 *
 * @param {Buffer|string} input
 * @param {number} padding         pixels to add on each side
 * @param {object} [options]
 * @param {string} [options.mode="reflect"]  sharp extend mode
 * @returns {Promise<Buffer>}
 */
export async function padImage(input, padding, options) {
  var opts = options || {};
  var mode = opts.mode || "reflect";

  var buffer;
  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else if (typeof input === "string") {
    var payload = input.replace(/^data:image\/\w+;base64,/, "");
    buffer = Buffer.from(payload, "base64");
  } else {
    throw new Error("padImage: input must be Buffer or base64 string.");
  }

  var meta = await sharp(buffer).metadata();
  var paddedWidth = meta.width + padding * 2;
  var paddedHeight = meta.height + padding * 2;

  return sharp(buffer)
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .resize(paddedWidth, paddedHeight, { fit: "fill" })
    .png()
    .toBuffer();
}

/**
 * Blur a mask image (Gaussian blur).
 *
 * @param {Buffer} maskBuffer  raw PNG buffer
 * @param {number} pixels      blur radius
 * @returns {Promise<Buffer>}  blurred PNG buffer
 */
export async function blurMask(maskBuffer, pixels) {
  if (!pixels || pixels <= 0) return maskBuffer;

  return sharp(maskBuffer)
    .blur(pixels)
    .png()
    .toBuffer();
}

/**
 * Grow (dilate) a mask by N pixels.
 * Approximated via blur + threshold — full morphological dilation
 * would require a more complex pipeline.
 *
 * @param {Buffer} maskBuffer
 * @param {number} pixels
 * @returns {Promise<Buffer>}
 */
export async function growMask(maskBuffer, pixels) {
  if (!pixels || pixels <= 0) return maskBuffer;

  /* Blur to expand edges outward, then threshold to harden */
  return sharp(maskBuffer)
    .blur(pixels * 2)
    .threshold(1)
    .png()
    .toBuffer();
}

/**
 * Ensure a value is a clean PNG base64 string (no data: prefix).
 *
 * @param {string} input  base64 with or without data: prefix
 * @returns {string}      clean base64 string
 */
export function ensurePngBase64(input) {
  if (typeof input !== "string") return "";
  return input.replace(/^data:image\/\w+;base64,/, "");
}

export default {
  scaleImageDown,
  scaleImageUp,
  getPngDimensions,
  decodePng,
  encodePngBase64,
  resizeToExact,
  cropToBounds,
  padImage,
  blurMask,
  growMask,
  ensurePngBase64,
};
