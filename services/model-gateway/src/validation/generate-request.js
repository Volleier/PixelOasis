/* validation/generate-request.js — G1: full request validation
 *
 * Rejects invalid requests before they touch any adapter (echo or ComfyUI).
 * DevList §9-G1.
 */

var MAX_IMAGE_BYTES = 50 * 1024 * 1024; /* 50 MB per image */

/* ── Known-good workflow IDs ── */
var KNOWN_WORKFLOWS = [
  "composition.inpaint.basic",
  "composition.object-remove.basic",
  "composition.outpaint.basic",
  "portrait.skin-retouch.basic",
  "portrait.face-restore.basic",
  "lighting.relight.basic",
  "lighting.color-grade.basic",
  "effects.style-transfer.basic",
  "effects.background-effect.basic",
  "quality.upscale.basic",
  "quality.denoise.basic",
  /* Entry-point IDs used by the plugin */
  "entry.tool-select",
  "entry.capture",
];

var KNOWN_SAMPLERS = [
  "dpmpp_2m", "euler", "euler_ancestral", "ddim", "uni_pc",
];

var KNOWN_SCHEDULERS = [
  "karras", "normal", "simple", "ddim_uniform", "sg_uniform",
];

/* ── Base64 helpers ── */

var BASE64_URL_RE = /^data:([^;]+);base64,/;

function stripDataUrlPrefix(b64) {
  var match = b64.match(BASE64_URL_RE);
  if (match) return { payload: b64.substring(match[0].length), mime: match[1] };
  return { payload: b64, mime: null };
}

/* Check first few decoded bytes for PNG or JPEG magic */
function detectImageFormat(b64) {
  var info = stripDataUrlPrefix(b64);

  /* If data URL with explicit MIME, trust it */
  if (info.mime) {
    if (info.mime === "image/png") return "png";
    if (info.mime === "image/jpeg" || info.mime === "image/jpg") return "jpeg";
  }

  /* Decode first 4 bytes to check magic */
  try {
    var decoded = atob(info.payload.substring(0, 8));
    var b0 = decoded.charCodeAt(0);
    var b1 = decoded.charCodeAt(1);

    /* PNG: 0x89 'P' 'N' 'G' */
    if (b0 === 0x89 && decoded.charCodeAt(1) === 0x50 && decoded.charCodeAt(2) === 0x4E && decoded.charCodeAt(3) === 0x47) {
      return "png";
    }
    /* JPEG: 0xFF 0xD8 */
    if (b0 === 0xFF && b1 === 0xD8) {
      return "jpeg";
    }
  } catch (e) {
    /* Invalid base64 — handled below */
  }

  return "unknown";
}

/* ── Main validation ── */

export function validateGenerateRequest(body) {
  /* ── Top-level shape ── */
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object." };
  }

  if (!body.correlationId || typeof body.correlationId !== "string") {
    return { valid: false, error: "缺少 correlationId" };
  }

  if (!body.workflowId || typeof body.workflowId !== "string") {
    return { valid: false, error: "缺少 workflowId" };
  }

  if (KNOWN_WORKFLOWS.indexOf(body.workflowId) === -1) {
    return { valid: false, error: "未知 workflowId: " + body.workflowId };
  }

  /* ── Selection object ── */
  var selection = body.selection;
  if (!selection || typeof selection !== "object") {
    return { valid: false, error: "缺少 selection 对象" };
  }

  /* ── Formal image (must be PNG, not JPEG) ── */
  var image = selection.imagePngBase64 || selection.imageBase64 || "";
  if (!image) {
    return { valid: false, error: "缺少 selection.imagePngBase64" };
  }

  var imageFormat = detectImageFormat(image);
  if (imageFormat === "jpeg") {
    return { valid: false, error: "正式图像不能使用 JPEG — 请使用 PNG 格式" };
  }
  if (imageFormat === "unknown") {
    return { valid: false, error: "无法识别图像格式 — 请确认是有效的 PNG base64" };
  }

  if (image.length > MAX_IMAGE_BYTES) {
    return { valid: false, error: "图像数据超过 50 MB 限制" };
  }

  /* ── Mask (must be PNG if present) ── */
  var mask = selection.maskPngBase64 || selection.maskBase64 || "";
  if (mask) {
    var maskFormat = detectImageFormat(mask);
    if (maskFormat === "jpeg") {
      return { valid: false, error: "正式蒙版不能使用 JPEG — 请使用 PNG 格式" };
    }
    if (mask.length > MAX_IMAGE_BYTES) {
      return { valid: false, error: "蒙版数据超过 50 MB 限制" };
    }
  }

  /* ── Bounds ── */
  var bounds = selection.bounds;
  if (bounds) {
    if (typeof bounds.left !== "number" || bounds.left < 0) {
      return { valid: false, error: "bounds.left 无效" };
    }
    if (typeof bounds.top !== "number" || bounds.top < 0) {
      return { valid: false, error: "bounds.top 无效" };
    }
    if (typeof bounds.width !== "number" || bounds.width <= 0 || bounds.width > 32768) {
      return { valid: false, error: "bounds.width 无效 (需在 1–32768 之间)" };
    }
    if (typeof bounds.height !== "number" || bounds.height <= 0 || bounds.height > 32768) {
      return { valid: false, error: "bounds.height 无效 (需在 1–32768 之间)" };
    }
  }

  /* ── Parameters (if present) ── */
  var params = body.parameters;
  if (params && typeof params === "object") {
    if (params.steps !== undefined) {
      var steps = Number(params.steps);
      if (!Number.isFinite(steps) || steps < 1 || steps > 100) {
        return { valid: false, error: "steps 需在 1–100 之间" };
      }
    }
    if (params.cfg !== undefined) {
      var cfg = Number(params.cfg);
      if (!Number.isFinite(cfg) || cfg < 1 || cfg > 30) {
        return { valid: false, error: "cfg 需在 1–30 之间" };
      }
    }
    if (params.denoise !== undefined) {
      var denoise = Number(params.denoise);
      if (!Number.isFinite(denoise) || denoise < 0 || denoise > 1) {
        return { valid: false, error: "denoise 需在 0–1 之间" };
      }
    }
    if (params.sampler !== undefined) {
      if (KNOWN_SAMPLERS.indexOf(params.sampler) === -1) {
        return { valid: false, error: "未知 sampler: " + params.sampler + " — 可选: " + KNOWN_SAMPLERS.join(", ") };
      }
    }
    if (params.scheduler !== undefined) {
      if (KNOWN_SCHEDULERS.indexOf(params.scheduler) === -1) {
        return { valid: false, error: "未知 scheduler: " + params.scheduler + " — 可选: " + KNOWN_SCHEDULERS.join(", ") };
      }
    }
    if (params.seed !== undefined) {
      var seed = Number(params.seed);
      if (!Number.isFinite(seed)) {
        return { valid: false, error: "seed 必须为数字" };
      }
    }
  }

  return { valid: true };
}
