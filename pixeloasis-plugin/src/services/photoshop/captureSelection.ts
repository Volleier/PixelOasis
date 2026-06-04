import type { CapturedSelectionPayload } from "../../domain/protocol";

declare const require: (module: string) => any;

interface PixelBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

type TypedPixelBuffer = Uint8Array | Uint16Array | Float32Array;

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

function normalizeBounds(candidate: unknown): PixelBounds | null {
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

function clampBoundsToCanvas(
  bounds: PixelBounds,
  canvasWidth: number,
  canvasHeight: number,
): PixelBounds {
  return {
    left: Math.max(0, Math.min(bounds.left, canvasWidth)),
    top: Math.max(0, Math.min(bounds.top, canvasHeight)),
    right: Math.max(0, Math.min(bounds.right, canvasWidth)),
    bottom: Math.max(0, Math.min(bounds.bottom, canvasHeight)),
  };
}

function assertNonEmptyBounds(bounds: PixelBounds): void {
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    throw new Error("The current selection does not intersect the document canvas.");
  }
}

async function getSelectionBoundsViaBatchPlay(documentId: number): Promise<PixelBounds | null> {
  const photoshop = require("photoshop");
  const { action } = photoshop;
  const [result] = await action.batchPlay(
    [
      {
        _obj: "get",
        _target: [
          { _property: "selection" },
          { _ref: "document", _id: documentId },
          { _ref: "application" },
        ],
        _options: {
          dialogOptions: "dontDisplay",
        },
      },
    ],
    {},
  );

  const record = result as Record<string, unknown>;

  return (
    normalizeBounds(record.selection) ??
    normalizeBounds(record.selection && (record.selection as Record<string, unknown>).bounds) ??
    normalizeBounds(record.bounds) ??
    null
  );
}

function getSelectionBoundsFromDom(documentRef: any): PixelBounds | null {
  const selectionBounds = documentRef.selection?.bounds;

  if (!selectionBounds) {
    return null;
  }

  return normalizeBounds(selectionBounds);
}

function createRgbBufferFromGrayscale(
  source: TypedPixelBuffer,
  width: number,
  height: number,
): TypedPixelBuffer {
  const pixelCount = width * height;
  const Constructor = source.constructor as
    | Uint8ArrayConstructor
    | Uint16ArrayConstructor
    | Float32ArrayConstructor;
  const target = new Constructor(pixelCount * 3) as TypedPixelBuffer;

  for (let index = 0; index < pixelCount; index += 1) {
    const sourceValue = source[index];
    const targetIndex = index * 3;
    target[targetIndex] = sourceValue;
    target[targetIndex + 1] = sourceValue;
    target[targetIndex + 2] = sourceValue;
  }

  return target;
}

function createRgbBufferFromImage(
  source: TypedPixelBuffer,
  width: number,
  height: number,
  components: number,
): TypedPixelBuffer {
  if (components === 3) {
    return source;
  }

  const pixelCount = width * height;
  const Constructor = source.constructor as
    | Uint8ArrayConstructor
    | Uint16ArrayConstructor
    | Float32ArrayConstructor;
  const target = new Constructor(pixelCount * 3) as TypedPixelBuffer;

  for (let index = 0; index < pixelCount; index += 1) {
    const sourceIndex = index * components;
    const targetIndex = index * 3;
    target[targetIndex] = source[sourceIndex];
    target[targetIndex + 1] = source[sourceIndex + 1];
    target[targetIndex + 2] = source[sourceIndex + 2];
  }

  return target;
}

async function encodeImageDataAsBase64(imageData: any): Promise<string> {
  const photoshop = require("photoshop");
  const { imaging } = photoshop;
  const pixelBuffer = (await imageData.getData({
    chunky: true,
  })) as TypedPixelBuffer;

  const rgbBuffer = createRgbBufferFromImage(
    pixelBuffer,
    imageData.width,
    imageData.height,
    imageData.components,
  );

  const rgbImageData = await imaging.createImageDataFromBuffer(rgbBuffer, {
    width: imageData.width,
    height: imageData.height,
    components: 3,
    colorSpace: "RGB",
    colorProfile: "sRGB IEC61966-2.1",
    ...(imageData.componentSize === 16 ? { fullRange: false } : {}),
  });

  try {
    return (await imaging.encodeImageData({
      imageData: rgbImageData,
      type: "image/png",
      base64: true,
    })) as string;
  } finally {
    rgbImageData.dispose();
  }
}

async function encodeSelectionMaskAsBase64(maskImageData: any): Promise<string> {
  const photoshop = require("photoshop");
  const { imaging } = photoshop;
  const grayscaleBuffer = (await maskImageData.getData({
    chunky: true,
  })) as TypedPixelBuffer;

  const rgbBuffer = createRgbBufferFromGrayscale(
    grayscaleBuffer,
    maskImageData.width,
    maskImageData.height,
  );

  const rgbMaskImageData = await imaging.createImageDataFromBuffer(rgbBuffer, {
    width: maskImageData.width,
    height: maskImageData.height,
    components: 3,
    colorSpace: "RGB",
    colorProfile: "sRGB IEC61966-2.1",
    ...(maskImageData.componentSize === 16 ? { fullRange: false } : {}),
  });

  try {
    return await encodeImageDataAsBase64(rgbMaskImageData);
  } finally {
    rgbMaskImageData.dispose();
  }
}

export async function captureSelection(): Promise<CapturedSelectionPayload> {
  const photoshop = require("photoshop");
  const { app, imaging } = photoshop;
  const documentRef = app.activeDocument;

  if (!documentRef) {
    throw new Error("No active Photoshop document is available.");
  }

  const rawBounds =
    (await getSelectionBoundsViaBatchPlay(documentRef.id)) ??
    getSelectionBoundsFromDom(documentRef);

  if (!rawBounds) {
    throw new Error("No active selection found in the current document.");
  }

  const captureBounds = clampBoundsToCanvas(
    rawBounds,
    documentRef.width,
    documentRef.height,
  );

  assertNonEmptyBounds(captureBounds);

  const pixelsResult = await imaging.getPixels({
    documentID: documentRef.id,
    sourceBounds: captureBounds,
    colorSpace: "RGB",
    colorProfile: "sRGB IEC61966-2.1",
    componentSize: 8,
  });

  const selectionResult = await imaging.getSelection({
    documentID: documentRef.id,
    sourceBounds: captureBounds,
  });

  try {
    const [imageBase64, maskBase64] = await Promise.all([
      encodeImageDataAsBase64(pixelsResult.imageData),
      encodeSelectionMaskAsBase64(selectionResult.imageData),
    ]);

    return {
      documentId: String(documentRef.id),
      bounds: {
        left: captureBounds.left,
        top: captureBounds.top,
        width: captureBounds.right - captureBounds.left,
        height: captureBounds.bottom - captureBounds.top,
      },
      imageBase64,
      maskBase64,
      colorMode: String(documentRef.mode),
      resolution: documentRef.resolution,
    };
  } finally {
    pixelsResult.imageData.dispose();
    selectionResult.imageData.dispose();
  }
}
