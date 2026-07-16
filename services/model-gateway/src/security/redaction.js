/* security/redaction.js — Log sanitization
 *
 * Stage 8: ensures no base64, prompt content, or absolute user paths
 * appear in log output. Per GatewayOrchestrationDesign §8.
 */

const SENSITIVE_KEYS = [
  "imagePngBase64", "maskPngBase64", "previewJpegBase64",
  "imageBase64", "base64", "pngBytes", "pixelData", "rawData",
  "imageBuffer", "maskBuffer", "sourceBuffer", "contextImagePngBase64",
  "editMaskPngBase64", "subjectMaskPngBase64",
];

const SENSITIVE_FIELDS = [
  "prompt", "negativePrompt", "params.text", "parameters.prompt",
];

export function sanitize(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);

  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.indexOf(k) !== -1) {
      out[k] = "[redacted, length=" + (typeof v === "string" ? v.length : "?") + "]";
    } else if (SENSITIVE_FIELDS.indexOf(k) !== -1) {
      out[k + "Length"] = typeof v === "string" ? v.length : 0;
    } else if (typeof v === "object" && v !== null) {
      out[k] = sanitize(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/* Strip absolute paths (C:\Users\..., /home/...) from strings */
export function redactPaths(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/[A-Z]:\\[^\s,;"']+/gi, "[local-path]")
    .replace(/\/home\/[^\s,;"']+/gi, "[local-path]")
    .replace(/\/Users\/[^\s,;"']+/gi, "[local-path]");
}

export default { sanitize, redactPaths };
