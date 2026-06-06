const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_BOUNDS_SIZE = 32768;

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

  if (typeof bounds.left !== "number" || bounds.left < 0) {
    return invalid("selection.bounds.left must be a non-negative number.");
  }
  if (typeof bounds.top !== "number" || bounds.top < 0) {
    return invalid("selection.bounds.top must be a non-negative number.");
  }
  if (
    typeof bounds.width !== "number" ||
    bounds.width <= 0 ||
    bounds.width > MAX_BOUNDS_SIZE
  ) {
    return invalid(`selection.bounds.width must be between 1 and ${MAX_BOUNDS_SIZE}.`);
  }
  if (
    typeof bounds.height !== "number" ||
    bounds.height <= 0 ||
    bounds.height > MAX_BOUNDS_SIZE
  ) {
    return invalid(`selection.bounds.height must be between 1 and ${MAX_BOUNDS_SIZE}.`);
  }

  return { valid: true };
}

function validateParameters(parameters) {
  if (parameters === undefined) return { valid: true };
  if (!parameters || typeof parameters !== "object") {
    return invalid("parameters must be an object.");
  }

  if (parameters.steps !== undefined) {
    const steps = Number(parameters.steps);
    if (!Number.isFinite(steps) || steps < 1 || steps > 100) {
      return invalid("parameters.steps must be between 1 and 100.");
    }
  }

  if (parameters.cfg !== undefined) {
    const cfg = Number(parameters.cfg);
    if (!Number.isFinite(cfg) || cfg < 1 || cfg > 30) {
      return invalid("parameters.cfg must be between 1 and 30.");
    }
  }

  if (parameters.denoise !== undefined) {
    const denoise = Number(parameters.denoise);
    if (!Number.isFinite(denoise) || denoise < 0 || denoise > 1) {
      return invalid("parameters.denoise must be between 0 and 1.");
    }
  }

  if (
    parameters.sampler !== undefined &&
    KNOWN_SAMPLERS.indexOf(parameters.sampler) === -1
  ) {
    return invalid(`Unknown sampler: ${parameters.sampler}.`);
  }

  if (
    parameters.scheduler !== undefined &&
    KNOWN_SCHEDULERS.indexOf(parameters.scheduler) === -1
  ) {
    return invalid(`Unknown scheduler: ${parameters.scheduler}.`);
  }

  if (parameters.seed !== undefined) {
    const seed = Number(parameters.seed);
    if (!Number.isFinite(seed)) {
      return invalid("parameters.seed must be numeric.");
    }
  }

  return { valid: true };
}

export function validateGenerateRequest(body) {
  if (!body || typeof body !== "object") {
    return invalid("Request body must be a JSON object.");
  }

  if (!body.correlationId || typeof body.correlationId !== "string") {
    return invalid("Missing correlationId.");
  }

  if (!body.workflowId || typeof body.workflowId !== "string") {
    return invalid("Missing workflowId.");
  }

  if (KNOWN_WORKFLOWS.indexOf(body.workflowId) === -1) {
    return invalid(`Unknown workflowId: ${body.workflowId}.`);
  }

  const selection = body.selection;
  if (!selection || typeof selection !== "object") {
    return invalid("Missing selection.");
  }

  const imageValidation = validatePngField(
    selection.imagePngBase64 || selection.imageBase64,
    "selection.imagePngBase64",
  );
  if (!imageValidation.valid) return imageValidation;

  const maskValidation = validatePngField(
    selection.maskPngBase64 || selection.maskBase64,
    "selection.maskPngBase64",
  );
  if (!maskValidation.valid) return maskValidation;

  const boundsValidation = validateBounds(selection.bounds);
  if (!boundsValidation.valid) return boundsValidation;

  const paramsValidation = validateParameters(body.parameters);
  if (!paramsValidation.valid) return paramsValidation;

  return { valid: true };
}
