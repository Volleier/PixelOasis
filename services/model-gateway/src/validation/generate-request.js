/* validation/generate-request.js — Validate POST /generate payload */

const MAX_IMAGE_BYTES = 50 * 1024 * 1024; /* 50 MB per image */

export function validateGenerateRequest(body) {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object." };
  }

  if (!body.correlationId || typeof body.correlationId !== "string") {
    return { valid: false, error: "Missing or invalid correlationId." };
  }

  if (!body.workflowId || typeof body.workflowId !== "string") {
    return { valid: false, error: "Missing or invalid workflowId." };
  }

  var selection = body.selection;
  if (!selection || typeof selection !== "object") {
    return { valid: false, error: "Missing selection object." };
  }

  /* Accept both protocol name (imagePngBase64) and legacy (imageBase64) */
  var image = selection.imagePngBase64 || selection.imageBase64 || "";
  if (!image) {
    return { valid: false, error: "Missing selection image (imagePngBase64)." };
  }

  if (image.length > MAX_IMAGE_BYTES) {
    return { valid: false, error: "Image payload exceeds 50 MB limit." };
  }

  var mask = selection.maskPngBase64 || selection.maskBase64 || "";
  if (mask && mask.length > MAX_IMAGE_BYTES) {
    return { valid: false, error: "Mask payload exceeds 50 MB limit." };
  }

  /* Parameters are optional — they default in the adapter */

  return { valid: true };
}
