import type { CapturedSelectionPayload } from "../../domain/protocol";

export async function captureSelection(): Promise<CapturedSelectionPayload> {
  // Placeholder. Replace with Photoshop UXP batchPlay + imaging extraction.
  return {
    documentId: "active-document",
    bounds: {
      left: 0,
      top: 0,
      width: 1024,
      height: 1024,
    },
    imageBase64: "PLACEHOLDER_IMAGE_BASE64",
    maskBase64: "PLACEHOLDER_MASK_BASE64",
    colorMode: "RGB",
    resolution: 72,
  };
}
