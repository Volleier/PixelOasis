/* adapters/comfyui/result-reader.js — Read ComfyUI output → normalized result
 *
 * DevList §9 — Phase G2: ComfyUI Client.
 *
 * Extracts output image references from a completed ComfyUI history entry,
 * downloads the PNG bytes, and returns them in a normalized shape ready for
 * the PixelOasis response envelope.
 */

import { ComfyUIError, ComfyUINoOutputError } from "./client.js";

/* ═══════════════════════════════════════════════════════════════════════
 * extractOutputImages(historyEntry, outputNodeId)
 *
 * Given a completed history entry (the value from /history/{prompt_id}[prompt_id])
 * and the configured output node ID, return an array of image references.
 *
 * Each reference: { filename, subfolder, type }
 * ═══════════════════════════════════════════════════════════════════════ */

export function extractOutputImages(historyEntry, outputNodeId) {
  if (!historyEntry || !historyEntry.outputs) {
    return [];
  }

  /* If outputNodeId is specified, use it; otherwise scan all outputs */
  if (outputNodeId) {
    var nodeOutput = historyEntry.outputs[outputNodeId];
    if (!nodeOutput || !nodeOutput.images || nodeOutput.images.length === 0) {
      return [];
    }
    return nodeOutput.images.map(function (img) {
      return {
        filename: img.filename,
        subfolder: img.subfolder || "",
        type: img.type || "output",
      };
    });
  }

  /* Auto-detect: scan all output nodes for images */
  var images = [];
  var nodeIds = Object.keys(historyEntry.outputs);
  for (var i = 0; i < nodeIds.length; i++) {
    var output = historyEntry.outputs[nodeIds[i]];
    if (output && output.images && output.images.length > 0) {
      for (var j = 0; j < output.images.length; j++) {
        var img = output.images[j];
        images.push({
          filename: img.filename,
          subfolder: img.subfolder || "",
          type: img.type || "output",
        });
      }
    }
  }
  return images;
}

/* ═══════════════════════════════════════════════════════════════════════
 * readOutputImages(client, historyEntry, outputNodeId)
 *
 * Download all output images from a completed history entry through the
 * ComfyUI client, returning an array of { buffer, filename, width?, height? }.
 *
 * Throws ComfyUINoOutputError when no images are found.
 * ═══════════════════════════════════════════════════════════════════════ */

export async function readOutputImages(client, historyEntry, outputNodeId) {
  var refs = extractOutputImages(historyEntry, outputNodeId);

  if (refs.length === 0) {
    var promptId = historyEntry && historyEntry.prompt && historyEntry.prompt[0];
    throw new ComfyUINoOutputError(promptId || "unknown");
  }

  var results = [];
  for (var i = 0; i < refs.length; i++) {
    var ref = refs[i];
    var bytes = await client.downloadView({
      filename: ref.filename,
      subfolder: ref.subfolder,
      type: ref.type,
    });

    results.push({
      buffer: bytes,
      filename: ref.filename,
      subfolder: ref.subfolder,
      type: ref.type,
    });
  }

  return results;
}

/* ═══════════════════════════════════════════════════════════════════════
 * detectImageDimensions(buffer)
 *
 * Quick PNG dimension extractor — reads IHDR chunk without a full decode.
 * Returns { width, height } or { width: 0, height: 0 } on failure.
 * ═══════════════════════════════════════════════════════════════════════ */

export function detectImageDimensions(buffer) {
  try {
    /* PNG signature: 8 bytes, then IHDR starts at offset 8.
     * IHDR: 4-byte length, 4-byte "IHDR", 4-byte width, 4-byte height */
    if (buffer.length < 24) return { width: 0, height: 0 };
    if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
      return { width: 0, height: 0 };
    }
    var width = buffer.readUInt32BE(16);
    var height = buffer.readUInt32BE(20);
    return { width: width, height: height };
  } catch (_) {
    return { width: 0, height: 0 };
  }
}

/* ═══════════════════════════════════════════════════════════════════════
 * Default export — convenience aggregate for the adapter
 * ═══════════════════════════════════════════════════════════════════════ */

export default {
  extractOutputImages: extractOutputImages,
  readOutputImages: readOutputImages,
  detectImageDimensions: detectImageDimensions,
};
