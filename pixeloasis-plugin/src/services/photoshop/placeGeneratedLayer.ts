import type { LayerPlacementPayload } from "../../domain/protocol";

declare const require: (module: string) => any;

interface PixelBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface TypedLayer {
  id: number;
  name: string;
  bounds?: unknown;
  bringToFront?: () => void;
  translate: (horizontal: number, vertical: number) => Promise<void>;
}

type TypedPixelBuffer = Uint8Array | Uint16Array | Float32Array;

class LayerPlacementError extends Error {
  constructor(
    message: string,
    readonly stage:
      | "prepare-file"
      | "open-image"
      | "duplicate-layer"
      | "position-layer"
      | "restore-selection"
      | "create-mask"
      | "cleanup-selection",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LayerPlacementError";
  }
}

function inferExtension(mimeType?: string): string {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return "jpg";
  }

  return "png";
}

function stripDataUrlPrefix(value: string): string {
  const match = value.match(/^data:[^;]+;base64,(.*)$/);
  return match ? match[1] : value;
}

function decodeBase64ToBytes(base64Value: string): Uint8Array {
  const normalized = stripDataUrlPrefix(base64Value);
  const binaryString = atob(normalized);
  const bytes = new Uint8Array(binaryString.length);

  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }

  return bytes;
}

async function writeTempImageFile(
  imageBase64: string,
  mimeType?: string,
): Promise<any> {
  try {
    const { storage } = require("uxp");
    const extension = inferExtension(mimeType);
    const tempFolder = await storage.localFileSystem.getTemporaryFolder();
    const file = await tempFolder.createFile(`pixeloasis-generated.${extension}`, {
      overwrite: true,
    });

    await file.write(decodeBase64ToBytes(imageBase64));
    return file;
  } catch (error) {
    throw new LayerPlacementError(
      "Failed to write the generated image into UXP temporary storage.",
      "prepare-file",
      error,
    );
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "_value" in value &&
    typeof (value as { _value?: unknown })._value === "number"
  ) {
    return (value as { _value: number })._value;
  }

  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    typeof (value as { value?: unknown }).value === "number"
  ) {
    return (value as { value: number }).value;
  }

  return null;
}

function normalizeLayerBounds(candidate: unknown): PixelBounds | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const left = asNumber(record.left);
  const top = asNumber(record.top);
  const right = asNumber(record.right);
  const bottom = asNumber(record.bottom);

  if (
    left === null ||
    top === null ||
    right === null ||
    bottom === null
  ) {
    return null;
  }

  return { left, top, right, bottom };
}

function getTargetBounds(payload: LayerPlacementPayload): PixelBounds {
  return {
    left: payload.bounds.left,
    top: payload.bounds.top,
    right: payload.bounds.left + payload.bounds.width,
    bottom: payload.bounds.top + payload.bounds.height,
  };
}

async function importGeneratedLayer(
  targetDocument: any,
  payload: LayerPlacementPayload,
): Promise<TypedLayer> {
  const photoshop = require("photoshop");
  const { app, action } = photoshop;
  const tempFile = await writeTempImageFile(payload.imageBase64, payload.mimeType);
  let importedDocument: any;

  try {
    importedDocument = await app.open(tempFile);
  } catch (error) {
    throw new LayerPlacementError(
      "Photoshop could not open the generated image from temporary storage.",
      "open-image",
      error,
    );
  }

  try {
    const sourceLayers = importedDocument.layers as TypedLayer[];

    if (!sourceLayers.length) {
      throw new Error("The generated image document did not contain any layers.");
    }

    let duplicatedLayer: unknown;

    try {
      [duplicatedLayer] = await importedDocument.duplicateLayers(
        [sourceLayers[0]],
        targetDocument,
      );
    } catch (error) {
      throw new LayerPlacementError(
        "Failed to duplicate the generated image into the active document.",
        "duplicate-layer",
        error,
      );
    }

    const targetLayer = duplicatedLayer as TypedLayer;
    targetLayer.name = payload.layerName;
    try {
      await selectLayerById(targetLayer.id, targetDocument.id);

      if (typeof targetLayer.bringToFront === "function") {
        targetLayer.bringToFront();
      } else {
        await action.batchPlay(
          [
            {
              _obj: "move",
              _target: [{ _ref: "layer", _id: targetLayer.id }],
              to: { _ref: "layer", _enum: "ordinal", _value: "front" },
              adjustment: false,
              _options: {
                dialogOptions: "dontDisplay",
              },
            },
          ],
          {},
        );
      }

      const currentBounds = normalizeLayerBounds(targetLayer.bounds);
      const targetBounds = getTargetBounds(payload);

      if (currentBounds) {
        await targetLayer.translate(
          targetBounds.left - currentBounds.left,
          targetBounds.top - currentBounds.top,
        );
      }
    } catch (error) {
      throw new LayerPlacementError(
        "The generated layer was imported but could not be positioned at the selection bounds.",
        "position-layer",
        error,
      );
    }

    return targetLayer;
  } finally {
    await importedDocument.closeWithoutSaving();
  }
}

async function createMaskImageDataFromBase64(
  maskBase64: string,
  width: number,
  height: number,
): Promise<any> {
  const photoshop = require("photoshop");
  const { imaging } = photoshop;
  const grayscaleBytes = decodeBase64ToBytes(maskBase64);
  return imaging.createImageDataFromBuffer(grayscaleBytes, {
    width,
    height,
    components: 1,
    chunky: false,
    colorSpace: "Grayscale",
    colorProfile: "Gray Gamma 2.2",
  });
}

async function replaceSelectionFromMask(
  documentId: number,
  payload: LayerPlacementPayload,
): Promise<void> {
  try {
    const photoshop = require("photoshop");
    const { app, imaging } = photoshop;
    if (!payload.maskBase64) {
      const documentRef = app.activeDocument;
      await documentRef.selection.selectRectangle({
        top: payload.bounds.top,
        left: payload.bounds.left,
        bottom: payload.bounds.top + payload.bounds.height,
        right: payload.bounds.left + payload.bounds.width,
      });
      return;
    }

    const maskImageData = await createMaskImageDataFromBase64(
      payload.maskBase64,
      payload.bounds.width,
      payload.bounds.height,
    );

    try {
      await imaging.putSelection({
        documentID: documentId,
        imageData: maskImageData,
        replace: true,
        targetBounds: {
          left: payload.bounds.left,
          top: payload.bounds.top,
        },
        commandName: "PixelOasis Restore Selection",
      });
    } finally {
      maskImageData.dispose();
    }
  } catch (error) {
    throw new LayerPlacementError(
      "Failed to restore the Photoshop selection from the generated mask data.",
      "restore-selection",
      error,
    );
  }
}

async function selectLayerById(layerId: number, documentId: number): Promise<void> {
  const photoshop = require("photoshop");
  const { action } = photoshop;
  await action.batchPlay(
    [
      {
        _obj: "select",
        _target: [
          { _ref: "layer", _id: layerId },
          { _ref: "document", _id: documentId },
        ],
        makeVisible: false,
        layerID: [layerId],
        _options: {
          dialogOptions: "dontDisplay",
        },
      },
    ],
    {},
  );
}

async function createLayerMaskFromSelection(
  layerId: number,
  documentId: number,
): Promise<void> {
  try {
    await selectLayerById(layerId, documentId);

    await action.batchPlay(
      [
        {
          _obj: "make",
          _target: [{ _ref: "channel" }],
          at: {
            _ref: "channel",
            _enum: "channel",
            _value: "mask",
          },
          using: {
            _enum: "userMaskEnabled",
            _value: "revealSelection",
          },
          _options: {
            dialogOptions: "dontDisplay",
          },
        },
      ],
      {},
    );
  } catch (error) {
    throw new LayerPlacementError(
      "Photoshop could not create a layer mask from the current selection.",
      "create-mask",
      error,
    );
  }
}

export async function placeGeneratedLayer(
  payload: LayerPlacementPayload,
): Promise<void> {
  const photoshop = require("photoshop");
  const { app, core } = photoshop;
  await core.executeAsModal(
    async () => {
      const targetDocument = app.activeDocument;

      if (!targetDocument) {
        throw new Error("No active Photoshop document is available.");
      }

      const generatedLayer = await importGeneratedLayer(targetDocument, payload);

      await replaceSelectionFromMask(targetDocument.id, payload);
      await createLayerMaskFromSelection(generatedLayer.id, targetDocument.id);
      try {
        await targetDocument.selection.deselect();
      } catch (error) {
        throw new LayerPlacementError(
          "The generated layer was applied, but Photoshop could not clear the temporary selection.",
          "cleanup-selection",
          error,
        );
      }
    },
    {
      commandName: "PixelOasis Apply Generated Layer",
    },
  );
}
