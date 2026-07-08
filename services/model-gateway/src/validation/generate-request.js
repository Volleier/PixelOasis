/* ── Limits (DevList §9 — Phase G1) ── */

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;       // 50 MB per image
const MAX_BOUNDS_DIMENSION = 32768;              // max width or height
const MAX_PIXEL_COUNT = 4096 * 4096;             // ≈ 16.8 Mpix

/* ── Known workflow IDs (public PixelOasis workflowId) ──
 *
 * When the file-backed registry (G3) is loaded, workflow IDs are read from
 * the registry.  Otherwise the hardcoded fallback list is used.
 *
 * ImplList §4.1 — Validation reads workflow inputPolicy to decide whether
 * selection and mask are required. */

import { getRegistry } from "../adapters/registry-instance.js";

const FALLBACK_WORKFLOWS = [
  /* Phase 1 pro workflows — primary Phase 1 buttons */
  "composition.inpaint.pro",
  "composition.remove.pro",
  "quality.realism.pro",
  /* Legacy / basic workflows — debug & fallback */
  "composition.remove.basic",
  "composition.outpaint.basic",
  "composition.inpaint.basic",
  "portrait.skin-retouch.basic",
  "portrait.face-restore.basic",
  "lighting.relight.basic",
  "lighting.color-grade.basic",
  "effects.style-transfer.basic",
  "effects.background-effect.basic",
  "quality.upscale.basic",
  "quality.realism-enhance.basic",
  "quality.denoise.basic",
];

function getKnownWorkflows() {
  try {
    var fileBacked = getRegistry().getAllWorkflowIds();
    /* Merge file-backed with fallback — file-backed IDs are authoritative,
     * but all fallback IDs are always accepted (even without file-backed variants).
     * If a fallback workflow has no file-backed variant, the adapter will resolve
     * it to the default variant for its category. */
    var merged = FALLBACK_WORKFLOWS.slice();
    for (var i = 0; i < fileBacked.length; i++) {
      if (merged.indexOf(fileBacked[i]) === -1) {
        merged.push(fileBacked[i]);
      }
    }
    return merged;
  } catch (_) {
    return FALLBACK_WORKFLOWS;
  }
}

/* ── Allowed colour modes for the source document ── */

const KNOWN_COLOR_MODES = [
  "RGB",
  "CMYK",
  "LAB",
  "GRAYSCALE",
  "INDEXED",
  "DUOTONE",
  "MULTICHANNEL",
];

/* ── Allowed samplers & schedulers
 *
 * These are the gateway-level defaults.  Once the workflow registry (G3)
 * is in place, per-workflow metadata can further restrict these lists. */

const KNOWN_SAMPLERS = [
  "dpmpp_2m",
  "euler",
  "euler_ancestral",
  "ddim",
  "uni_pc",
];

const KNOWN_SCHEDULERS = [
  "karras",
  "normal",
  "simple",
  "ddim_uniform",
  "sg_uniform",
];

const BASE64_URL_RE = /^data:([^;]+);base64,/;

function stripDataUrlPrefix(base64) {
  const match = base64.match(BASE64_URL_RE);
  if (match) {
    return {
      payload: base64.substring(match[0].length),
      mime: match[1],
    };
  }
  return { payload: base64, mime: null };
}

function decodedByteLength(base64) {
  const info = stripDataUrlPrefix(base64);
  const payload = info.payload.replace(/\s/g, "");
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

function decodeBase64Prefix(base64, charCount) {
  const info = stripDataUrlPrefix(base64);
  const payload = info.payload.substring(0, charCount);
  return Buffer.from(payload, "base64");
}

function detectImageFormat(base64) {
  if (typeof base64 !== "string" || !base64.trim()) {
    return "unknown";
  }

  const info = stripDataUrlPrefix(base64);
  if (info.mime === "image/png") return "png";
  if (info.mime === "image/jpeg" || info.mime === "image/jpg") return "jpeg";

  try {
    const bytes = decodeBase64Prefix(base64, 16);
    if (
      bytes.length >= 4 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {
      return "png";
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      return "jpeg";
    }
  } catch (error) {
    return "unknown";
  }

  return "unknown";
}

function invalid(error) {
  return { valid: false, error };
}

function validatePngField(value, fieldName) {
  if (!value || typeof value !== "string") {
    return invalid(`Missing ${fieldName}.`);
  }

  const format = detectImageFormat(value);
  if (format === "jpeg") {
    return invalid(`${fieldName} must be PNG, not JPEG.`);
  }
  if (format !== "png") {
    return invalid(`${fieldName} must be a valid PNG base64 payload.`);
  }

  if (decodedByteLength(value) > MAX_IMAGE_BYTES) {
    return invalid(`${fieldName} exceeds ${MAX_IMAGE_BYTES} bytes.`);
  }

  return { valid: true };
}

function validateBounds(bounds) {
  if (!bounds || typeof bounds !== "object") {
    return invalid("Missing selection.bounds.");
  }

  /* left / top — must be finite, non-negative numbers */
  if (typeof bounds.left !== "number" || !Number.isFinite(bounds.left) || bounds.left < 0) {
    return invalid("selection.bounds.left must be a finite, non-negative number.");
  }
  if (typeof bounds.top !== "number" || !Number.isFinite(bounds.top) || bounds.top < 0) {
    return invalid("selection.bounds.top must be a finite, non-negative number.");
  }

  /* width / height — must be finite, positive integers */
  if (
    typeof bounds.width !== "number" ||
    !Number.isFinite(bounds.width) ||
    bounds.width < 1 ||
    bounds.width > MAX_BOUNDS_DIMENSION
  ) {
    return invalid("selection.bounds.width must be between 1 and " + MAX_BOUNDS_DIMENSION + ".");
  }
  if (
    typeof bounds.height !== "number" ||
    !Number.isFinite(bounds.height) ||
    bounds.height < 1 ||
    bounds.height > MAX_BOUNDS_DIMENSION
  ) {
    return invalid("selection.bounds.height must be between 1 and " + MAX_BOUNDS_DIMENSION + ".");
  }

  /* Max pixel count (width × height) */
  var pixelCount = bounds.width * bounds.height;
  if (pixelCount > MAX_PIXEL_COUNT) {
    return invalid(
      "selection.bounds pixel count " + pixelCount +
      " exceeds maximum " + MAX_PIXEL_COUNT + " (" +
      (MAX_PIXEL_COUNT / 1000000).toFixed(1) + " Mpix)."
    );
  }

  return { valid: true };
}

/* ── Validate optional selection metadata fields ── */

function validateSelectionMeta(selection) {
  /* documentId — optional, but must be a string if present */
  if (selection.documentId !== undefined && typeof selection.documentId !== "string") {
    return invalid("selection.documentId must be a string.");
  }

  /* colorMode — optional, but must be a known mode if present */
  if (selection.colorMode !== undefined) {
    if (typeof selection.colorMode !== "string") {
      return invalid("selection.colorMode must be a string.");
    }
    if (KNOWN_COLOR_MODES.indexOf(selection.colorMode) === -1) {
      return invalid(
        "Unknown selection.colorMode: " + selection.colorMode + ". " +
        "Allowed: " + KNOWN_COLOR_MODES.join(", ") + "."
      );
    }
  }

  /* resolution — optional, must be a positive finite number if present */
  if (selection.resolution !== undefined) {
    if (typeof selection.resolution !== "number" || !Number.isFinite(selection.resolution) || selection.resolution <= 0) {
      return invalid("selection.resolution must be a positive finite number.");
    }
  }

  /* previewJpegBase64 — optional, must be a valid JPEG if present */
  if (selection.previewJpegBase64 !== undefined) {
    if (typeof selection.previewJpegBase64 !== "string") {
      return invalid("selection.previewJpegBase64 must be a string.");
    }
    var format = detectImageFormat(selection.previewJpegBase64);
    if (format !== "jpeg") {
      return invalid("selection.previewJpegBase64 must be a JPEG base64 payload.");
    }
  }

  return { valid: true };
}

function validateParameters(parameters) {
  if (parameters === undefined) return { valid: true };
  if (!parameters || typeof parameters !== "object") {
    return invalid("parameters must be an object.");
  }

  if (parameters.steps !== undefined) {
    var steps = Number(parameters.steps);
    if (!Number.isFinite(steps) || steps < 1 || steps > 100) {
      return invalid("parameters.steps must be between 1 and 100.");
    }
  }

  if (parameters.cfg !== undefined) {
    var cfg = Number(parameters.cfg);
    if (!Number.isFinite(cfg) || cfg < 1 || cfg > 30) {
      return invalid("parameters.cfg must be between 1 and 30.");
    }
  }

  if (parameters.denoise !== undefined) {
    var denoise = Number(parameters.denoise);
    if (!Number.isFinite(denoise) || denoise < 0 || denoise > 1) {
      return invalid("parameters.denoise must be between 0 and 1.");
    }
  }

  if (
    parameters.sampler !== undefined &&
    KNOWN_SAMPLERS.indexOf(parameters.sampler) === -1
  ) {
    return invalid("Unknown sampler: " + parameters.sampler + ". Allowed: " + KNOWN_SAMPLERS.join(", ") + ".");
  }

  if (
    parameters.scheduler !== undefined &&
    KNOWN_SCHEDULERS.indexOf(parameters.scheduler) === -1
  ) {
    return invalid("Unknown scheduler: " + parameters.scheduler + ". Allowed: " + KNOWN_SCHEDULERS.join(", ") + ".");
  }

  if (parameters.seed !== undefined) {
    var seed = Number(parameters.seed);
    /* seed must be a finite integer, or exactly -1 (random) */
    if (!Number.isFinite(seed) || !Number.isInteger(seed)) {
      return invalid("parameters.seed must be a finite integer, or -1 for random.");
    }
  }

  return { valid: true };
}

/* ── Resolve the inputPolicy for a workflowId ── */
function getWorkflowInputPolicy(wfId) {
  try {
    var registry = getRegistry();
    var workflow = registry.getWorkflow(wfId);
    if (workflow && workflow.best) {
      return workflow.best.inputPolicy || null;
    }
  } catch (_) {
    /* registry not available — use legacy rules */
  }
  return null;
}

export function validateGenerateRequest(body) {
  /* ── Top-level shape ── */
  if (!body || typeof body !== "object") {
    return invalid("Request body must be a JSON object.");
  }

  /* ── correlationId ── */
  if (!body.correlationId || typeof body.correlationId !== "string" || !body.correlationId.trim()) {
    return invalid("Missing or empty correlationId.");
  }

  /* ── workflowId — public PixelOasis ID, never a ComfyUI internal ID ── */
  if (!body.workflowId || typeof body.workflowId !== "string") {
    return invalid("Missing workflowId.");
  }

  var knownWorkflows = getKnownWorkflows();
  if (knownWorkflows.indexOf(body.workflowId) === -1) {
    return invalid(
      "Unknown workflowId: " + body.workflowId + ". " +
      "Known workflows: " + knownWorkflows.join(", ") + "."
    );
  }

  /* ── Resolve workflow input policy ── */
  var inputPolicy = getWorkflowInputPolicy(body.workflowId);

  /* If policy declares mask=forbidden, no mask should be sent.
   * Default (no policy): mask is required (legacy behaviour). */
  var maskRequired = !inputPolicy || (inputPolicy.mask !== "optional" && inputPolicy.mask !== "forbidden");
  var maskForbidden = !!(inputPolicy && inputPolicy.mask === "forbidden");
  var sourceKind = inputPolicy ? inputPolicy.source : "selection";

  /* ── selection (P2-4: conditional on source) ── */
  var selection = body.selection;

  if (sourceKind === "selection") {
    if (!selection || typeof selection !== "object") {
      return invalid("Missing selection — required when inputPolicy.source is 'selection'.");
    }
  } else if (sourceKind === "activeLayer" || sourceKind === "document") {
    /* Phase 1: source=activeLayer/document are reserved but not yet supported.
     * Fail early with a clear message instead of silently ignoring. */
    return invalid(
      "inputPolicy.source '" + sourceKind + "' is not yet supported in Phase 1. " +
      "Only 'selection' is available."
    );
  }

  /* Source image — PNG only, no JPEG (always required) */
  var selImage = selection ? (selection.imagePngBase64 || selection.imageBase64) : null;
  var imageValidation = validatePngField(selImage, "selection.imagePngBase64");
  if (!imageValidation.valid) return imageValidation;

  var selMask = selection ? (selection.maskPngBase64 || selection.maskBase64) : null;

  /* Mask — conditional on inputPolicy.mask */
  if (maskForbidden) {
    if (selMask) {
      return invalid(
        "selection.maskPngBase64 is forbidden for workflow " + body.workflowId +
        " (inputPolicy.mask = forbidden)."
      );
    }
  } else if (maskRequired) {
    var maskValidation = validatePngField(selMask, "selection.maskPngBase64");
    if (!maskValidation.valid) return maskValidation;
  }
  /* mask=optional: validate if present, but don't require it */
  if (!maskRequired && !maskForbidden && selMask) {
    var optMaskValidation = validatePngField(selMask, "selection.maskPngBase64");
    if (!optMaskValidation.valid) return optMaskValidation;
  }

  /* Bounds — required when source=selection */
  if (sourceKind === "selection") {
    var boundsValidation = validateBounds(selection.bounds);
    if (!boundsValidation.valid) return boundsValidation;
  }

  /* Optional selection metadata (documentId, colorMode, resolution, previewJpegBase64) */
  var metaValidation = validateSelectionMeta(selection);
  if (!metaValidation.valid) return metaValidation;

  /* ── parameters ── */
  var paramsValidation = validateParameters(body.parameters);
  if (!paramsValidation.valid) return paramsValidation;

  /* ── clientCapabilities (loose validation) ── */
  if (body.clientCapabilities !== undefined) {
    var cc = body.clientCapabilities;
    if (cc && typeof cc !== "object") {
      return invalid("clientCapabilities must be an object.");
    }
    if (cc && cc.placement !== undefined && !Array.isArray(cc.placement)) {
      return invalid("clientCapabilities.placement must be an array.");
    }
  }

  return { valid: true };
}
