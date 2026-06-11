/* ── Limits (DevList §9 — Phase G1) ── */

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;       // 50 MB per image
const MAX_BOUNDS_DIMENSION = 32768;              // max width or height
const MAX_PIXEL_COUNT = 4096 * 4096;             // ≈ 16.8 Mpix

/* ── Known workflow IDs (public PixelOasis workflowId) ── */

const KNOWN_WORKFLOWS = [
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

  if (KNOWN_WORKFLOWS.indexOf(body.workflowId) === -1) {
    return invalid(
      "Unknown workflowId: " + body.workflowId + ". " +
      "Known workflows: " + KNOWN_WORKFLOWS.join(", ") + "."
    );
  }

  /* ── selection ── */
  var selection = body.selection;
  if (!selection || typeof selection !== "object") {
    return invalid("Missing selection.");
  }

  /* Formal image — PNG only, no JPEG */
  var imageValidation = validatePngField(
    selection.imagePngBase64 || selection.imageBase64,
    "selection.imagePngBase64",
  );
  if (!imageValidation.valid) return imageValidation;

  /* Formal mask — PNG only, no JPEG */
  var maskValidation = validatePngField(
    selection.maskPngBase64 || selection.maskBase64,
    "selection.maskPngBase64",
  );
  if (!maskValidation.valid) return maskValidation;

  /* Bounds — includes pixel-count ceiling */
  var boundsValidation = validateBounds(selection.bounds);
  if (!boundsValidation.valid) return boundsValidation;

  /* Optional selection metadata (documentId, colorMode, resolution, previewJpegBase64) */
  var metaValidation = validateSelectionMeta(selection);
  if (!metaValidation.valid) return metaValidation;

  /* ── parameters ── */
  var paramsValidation = validateParameters(body.parameters);
  if (!paramsValidation.valid) return paramsValidation;

  return { valid: true };
}
