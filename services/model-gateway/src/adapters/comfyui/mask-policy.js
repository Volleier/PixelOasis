/* adapters/comfyui/mask-policy.js — Workflow-aware mask processing
 *
 * ImplList §6.1 — Abstract mask preprocessing behind a policy module.
 *
 * Reads variant.maskPolicy and produces:
 *   - maskForWorkflow  — processed mask uploaded to ComfyUI
 *   - finalPlacementMask — soft mask returned for Photoshop layer mask
 *   - mask metadata    — for logging
 */

import { blurMask, growMask, ensurePngBase64 } from "../../utils/images.js";

/* ── Resolve effective mask policy ── */
export function resolveMaskPolicy(variant) {
  var mp = (variant && variant.maskPolicy) || {};

  return {
    polarity: mp.polarity || "white-editable",
    invertBeforeUpload: mp.invertBeforeUpload === true,
    growPixels: typeof mp.growPixels === "number" ? mp.growPixels : 0,
    blurPixels: typeof mp.blurPixels === "number" ? mp.blurPixels : 0,
    edgeMode: mp.edgeMode || "soft",
  };
}

/* ── Convert base64 + policy to a Buffer for processing ── */
function base64ToMaskBuffer(base64) {
  var payload = ensurePngBase64(base64);
  return Buffer.from(payload, "base64");
}

/* ── Convert a processed Buffer back to base64 ── */
function maskBufferToBase64(buffer) {
  return buffer.toString("base64");
}

/* ── Main entry point ──
 *
 * @param {string} maskBase64  — original mask from plugin (base64, no prefix)
 * @param {object} variant     — workflow variant with maskPolicy
 * @returns {Promise<object>}  — { maskForWorkflow, finalPlacementMask, metadata }  */

export async function applyMaskPolicy(maskBase64, variant) {
  var policy = resolveMaskPolicy(variant);

  /* If no mask is provided, return empty results */
  if (!maskBase64) {
    return {
      maskForWorkflow: null,
      finalPlacementMask: null,
      metadata: { present: false },
      warnings: [],
    };
  }

  var maskBuffer = base64ToMaskBuffer(maskBase64);

  /* ── Step 1: Grow (dilate) the mask ── */
  var grownBuffer = maskBuffer;
  if (policy.growPixels > 0) {
    grownBuffer = await growMask(grownBuffer, policy.growPixels);
  }

  /* ── Step 2: Blur (soften edges) ── */
  var blurredBuffer = grownBuffer;
  if (policy.blurPixels > 0) {
    blurredBuffer = await blurMask(blurredBuffer, policy.blurPixels);
  }

  /* ── Step 3: Invert if needed ── */
  if (policy.invertBeforeUpload) {
    /* Use sharp to invert */
    var sharp = (await import("sharp")).default;
    blurredBuffer = await sharp(blurredBuffer)
      .negate({ alpha: false })
      .png()
      .toBuffer();
  }

  /* ── Decide what to upload vs what to return for placement ── */

  /* maskForWorkflow: the processed mask sent to ComfyUI */
  var maskForWorkflow = maskBufferToBase64(blurredBuffer);

  /* finalPlacementMask: the soft mask for Photoshop layer mask
   * — this is the blurred (not grown) version for natural edges */
  var finalPlacementBuffer = grownBuffer;
  if (policy.edgeMode === "soft" && policy.blurPixels > 0) {
    finalPlacementBuffer = blurredBuffer;
  }
  var finalPlacementMask = maskBufferToBase64(finalPlacementBuffer);

  return {
    maskForWorkflow: maskForWorkflow,
    finalPlacementMask: finalPlacementMask,
    metadata: {
      present: true,
      polarity: policy.polarity,
      growPixels: policy.growPixels,
      blurPixels: policy.blurPixels,
      invertBeforeUpload: policy.invertBeforeUpload,
      edgeMode: policy.edgeMode,
    },
    warnings: [],
  };
}
