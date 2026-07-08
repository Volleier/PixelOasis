/* adapters/comfyui/placement-policy.js — Unified placement summary generation
 *
 * Phase 1 Step 2 — Extracts placement assembly out of adapter.js.
 *
 * Reads variant.placementPolicy, selection.bounds, and maskPolicyResult, and
 * produces a single stable placement object consumed by the plugin's
 * placement-engine.js.  The adapter MUST use this module instead of
 * assembling placement fields inline.
 *
 * Output contract:
 *   {
 *     type,               // "smartObjectMaskedExact" | "layerMaskedExact" | "none"
 *     targetBounds,        // { left, top, width, height } from selection
 *     maskPngBase64,       // final soft mask for Photoshop layer mask (nullable)
 *     featherPixels,       // feather radius from policy
 *     createLayerGroup,    // always true for Phase 1
 *     createSmartObject,   // always true for Phase 1
 *     maskSource           // "finalSoftMask" | "originalSelectionMask"
 *   }
 */

/* ── Resolve effective placement policy with defaults ── */
export function resolvePlacementPolicy(variant) {
  var pp = (variant && variant.placementPolicy) || {};

  return {
    type: pp.type || "smartObjectMaskedExact",
    bounds: pp.bounds || "selection",
    createLayerGroup: pp.createLayerGroup !== false,
    createSmartObject: pp.createSmartObject !== false,
    maskSource: pp.maskSource || "finalSoftMask",
    preserveOriginalSelectionMask: pp.preserveOriginalSelectionMask === true,
    featherPixels: typeof pp.featherPixels === "number" ? pp.featherPixels : 0,
    opacity: typeof pp.opacity === "number" ? pp.opacity : 100,
    blendMode: pp.blendMode || "normal",
  };
}

/* ── Main entry point ──
 *
 * @param {object} variant          — workflow variant with placementPolicy
 * @param {object} selectionBounds  — { left, top, width, height }
 * @param {object} maskPolicyResult — output from applyMaskPolicy(), or null
 * @returns {object}                — placement summary (see contract above)
 */
export function buildPlacementSummary(variant, selectionBounds, maskPolicyResult) {
  var policy = resolvePlacementPolicy(variant);

  /* Mask: prefer finalPlacementMask from mask-policy, fallback to nothing.
   * An optional-mask workflow where the user didn't provide a mask will have
   * maskPolicyResult as null — this is valid; placement must not throw. */
  var maskB64 = null;
  if (maskPolicyResult && maskPolicyResult.finalPlacementMask) {
    maskB64 = maskPolicyResult.finalPlacementMask;
  }

  if (!selectionBounds) {
    throw new Error("buildPlacementSummary: selectionBounds is required.");
  }

  return {
    type: policy.type,
    targetBounds: {
      left: selectionBounds.left,
      top: selectionBounds.top,
      width: selectionBounds.width,
      height: selectionBounds.height,
    },
    maskPngBase64: maskB64,
    featherPixels: policy.featherPixels,
    createLayerGroup: policy.createLayerGroup,
    createSmartObject: policy.createSmartObject,
    maskSource: maskB64 ? policy.maskSource : null,
  };
}
