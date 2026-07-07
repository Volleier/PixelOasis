/* adapters/comfyui/size-policy.js — Workflow-aware image sizing
 *
 * ImplList §5.1 — Abstract size strategy behind a policy module.
 *
 * Reads variant.sizePolicy and produces dimensions + metadata for the adapter.
 * The adapter uses these values to scale source/mask images and final results.
 */

/* ── Default limits ── */
const DEFAULT_MAX_SOURCE_DIMENSION = 1024;

/* ── Resolve effective size policy from variant + defaults ── */
export function resolveSizePolicy(variant) {
  var sp = (variant && variant.sizePolicy) || {};

  return {
    mode: sp.mode || "selectionExact",
    maxSourceDimension:
      typeof sp.maxSourceDimension === "number"
        ? sp.maxSourceDimension
        : DEFAULT_MAX_SOURCE_DIMENSION,
    contextPadding:
      typeof sp.contextPadding === "number" ? sp.contextPadding : 0,
    contextPaddingMode: sp.contextPaddingMode || null,
  };
}

/* ── Determine if source image needs downscaling ── */
function needsDownscale(w, h, maxDim) {
  return maxDim > 0 && (w > maxDim || h > maxDim);
}

/* ── Compute internal dimensions (what ComfyUI sees) ── */
function computeInternalDimensions(sourceW, sourceH, policy) {
  var internalW = sourceW;
  var internalH = sourceH;
  var scaled = false;
  var scale = 1.0;

  /* Downscale to fit maxSourceDimension */
  if (needsDownscale(sourceW, sourceH, policy.maxSourceDimension)) {
    if (sourceW >= sourceH) {
      scale = policy.maxSourceDimension / sourceW;
    } else {
      scale = policy.maxSourceDimension / sourceH;
    }
    internalW = Math.round(sourceW * scale);
    internalH = Math.round(sourceH * scale);
    scaled = true;
  }

  /* Add context padding (expandThenCrop mode) */
  var contextPadPx = 0;
  if (
    policy.contextPadding > 0 &&
    policy.mode === "expandThenCrop"
  ) {
    contextPadPx = Math.round(policy.contextPadding * (scaled ? scale : 1.0));
    internalW += contextPadPx * 2;
    internalH += contextPadPx * 2;
  }

  return {
    sourceWidth: sourceW,
    sourceHeight: sourceH,
    internalWidth: internalW,
    internalHeight: internalH,
    scaled: scaled,
    scale: scale,
    contextPaddingPx: contextPadPx,
  };
}

/* ── Compute final output dimensions (must match selection bounds) ── */
function computeFinalDimensions(selectionBounds, policy) {
  switch (policy.mode) {
    case "selectionExact":
    case "expandThenCrop":
      return {
        finalWidth: selectionBounds.width,
        finalHeight: selectionBounds.height,
        cropToBounds: policy.mode === "expandThenCrop",
        cropPadding: policy.mode === "expandThenCrop" ? policy.contextPadding : 0,
      };
    case "upscaleMultiplier":
      /* Future: return 2x/4x dimensions */
      return {
        finalWidth: selectionBounds.width,
        finalHeight: selectionBounds.height,
        cropToBounds: false,
        warn: "upscaleMultiplier not yet implemented in Phase 1",
      };
    default:
      return {
        finalWidth: selectionBounds.width,
        finalHeight: selectionBounds.height,
        cropToBounds: false,
      };
  }
}

/* ── Main entry point ──
 *
 * @param {object} selectionBounds — { width, height, left, top }
 * @param {object} sourceDims      — { width, height } from decoded source PNG
 * @param {object} variant         — workflow variant with sizePolicy
 * @returns {object} — all dimensions the adapter needs                     */

export function applySizePolicy(selectionBounds, sourceDims, variant) {
  var policy = resolveSizePolicy(variant);

  var internal = computeInternalDimensions(
    sourceDims.width,
    sourceDims.height,
    policy,
  );

  var final = computeFinalDimensions(selectionBounds, policy);

  return {
    /* Input dimensions to ComfyUI */
    sourceWidth: internal.sourceWidth,
    sourceHeight: internal.sourceHeight,

    /* Internal processing info */
    internalWidth: internal.internalWidth,
    internalHeight: internal.internalHeight,
    scaled: internal.scaled,
    scale: internal.scale,
    contextPaddingPx: internal.contextPaddingPx,

    /* Final output constraints */
    finalWidth: final.finalWidth,
    finalHeight: final.finalHeight,
    cropToBounds: final.cropToBounds,
    cropPadding: final.cropPadding,

    /* Policy used */
    policy: policy,

    /* Metadata for logs */
    metadata: {
      mode: policy.mode,
      maxSourceDimension: policy.maxSourceDimension,
      originalWidth: sourceDims.width,
      originalHeight: sourceDims.height,
      internalWidth: internal.internalWidth,
      internalHeight: internal.internalHeight,
      finalWidth: final.finalWidth,
      finalHeight: final.finalHeight,
      scaled: internal.scaled,
      scale: internal.scale,
      contextPaddingPx: internal.contextPaddingPx,
    },

    /* Any warnings from the size pipeline */
    warnings: final.warn ? [final.warn] : [],
  };
}
