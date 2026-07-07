window.PO = window.PO || {};

/* ── Normalization helpers ── */

window.PO.normalizeNumber = function (value) {
  if (typeof value === "number" && isFinite(value)) return value;
  if (value && typeof value === "object") {
    if (typeof value._value === "number") return value._value;
    if (typeof value.value === "number") return value.value;
  }
  return null;
};

window.PO.normalizeSelectionBounds = function (candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  var left = window.PO.normalizeNumber(candidate.left);
  var top = window.PO.normalizeNumber(candidate.top);
  var right = window.PO.normalizeNumber(candidate.right);
  var bottom = window.PO.normalizeNumber(candidate.bottom);
  if (left === null || top === null || right === null || bottom === null) {
    return null;
  }
  return {
    left: left,
    top: top,
    width: right - left,
    height: bottom - top,
  };
};

window.PO.clampBoundsToCanvas = function (bounds, canvasWidth, canvasHeight) {
  return {
    left: Math.max(0, Math.min(bounds.left, canvasWidth)),
    top: Math.max(0, Math.min(bounds.top, canvasHeight)),
    right: Math.max(0, Math.min(bounds.right, canvasWidth)),
    bottom: Math.max(0, Math.min(bounds.bottom, canvasHeight)),
  };
};

window.PO.formatSelectionBounds = function (bounds) {
  return (
    "selection: " +
    bounds.left +
    "," +
    bounds.top +
    " " +
    bounds.width +
    "x" +
    bounds.height
  );
};

/* ── Pixel buffer helpers ── */

window.PO.createRgbBufferFromGrayscale = function (source, width, height) {
  var pixelCount = width * height;
  var Constructor = source.constructor;
  var target = new Constructor(pixelCount * 3);

  for (var index = 0; index < pixelCount; index += 1) {
    var value = source[index];
    var targetIndex = index * 3;
    target[targetIndex] = value;
    target[targetIndex + 1] = value;
    target[targetIndex + 2] = value;
  }

  return target;
};

window.PO.createOpaqueJpegPreviewBuffer = function (source, width, height, components) {
  var pixelCount = width * height;
  var rgbBuffer = new Uint8Array(pixelCount * 3);
  var matte = { r: 43, g: 43, b: 43 };

  for (var index = 0; index < pixelCount; index += 1) {
    var src = index * components;
    var dest = index * 3;

    if (components >= 4) {
      var alpha = source[src + 3] / 255;
      rgbBuffer[dest] = Math.round(source[src] * alpha + matte.r * (1 - alpha));
      rgbBuffer[dest + 1] = Math.round(
        source[src + 1] * alpha + matte.g * (1 - alpha),
      );
      rgbBuffer[dest + 2] = Math.round(
        source[src + 2] * alpha + matte.b * (1 - alpha),
      );
    } else {
      rgbBuffer[dest] = source[src];
      rgbBuffer[dest + 1] = source[src + 1];
      rgbBuffer[dest + 2] = source[src + 2];
    }
  }

  return rgbBuffer;
};

window.PO.toDataUrl = function (base64Payload, mimeType) {
  return base64Payload && base64Payload.startsWith("data:")
    ? base64Payload
    : "data:" + mimeType + ";base64," + base64Payload;
};

/* ── Source-bounds padding ──
 *
 * Adobe notes that getPixels / getSelection may return sourceBounds that are
 * tighter than the requested bounds (cropped to actual pixel content).  When
 * that happens the image, mask and preview dimensions drift apart, which will
 * cause misalignment in the ComfyUI inpaint pipeline.
 *
 * This helper detects the drift and pads the returned ImageData back to the
 * originally-requested rectangle so every output is exactly selection-sized.
 */

window.PO.padImageDataToBounds = async function (imageData, requestedBounds, actualSourceBounds, fillValue) {
  var offsetLeft = actualSourceBounds.left - requestedBounds.left;
  var offsetTop = actualSourceBounds.top - requestedBounds.top;
  var reqW = requestedBounds.right - requestedBounds.left;
  var reqH = requestedBounds.bottom - requestedBounds.top;
  var actW = actualSourceBounds.right - actualSourceBounds.left;
  var actH = actualSourceBounds.bottom - actualSourceBounds.top;

  /* Fast path — no padding needed */
  if (offsetLeft === 0 && offsetTop === 0 && actW === reqW && actH === reqH) {
    return imageData;
  }

  var photoshop = window.require("photoshop");
  var imaging = photoshop.imaging;
  var components = imageData.components || 3;
  var rawData = await imageData.getData({ chunky: true });
  var is16Bit = imageData.componentSize === 16;

  var PaddedCtor = is16Bit ? Uint16Array : Uint8Array;
  var paddedBuffer = new PaddedCtor(reqW * reqH * components);

  /* Fill background */
  for (var i = 0; i < paddedBuffer.length; i++) {
    paddedBuffer[i] = fillValue;
  }

  /* Copy actual pixels at the correct offset */
  var srcStride = actW * components;
  var destStride = reqW * components;
  for (var y = 0; y < actH; y++) {
    var srcStart = y * srcStride;
    var destStart = (y + offsetTop) * destStride + offsetLeft * components;
    for (var x = 0; x < srcStride; x++) {
      paddedBuffer[destStart + x] = rawData[srcStart + x];
    }
  }

  var createOpts = Object.assign({
    width: reqW,
    height: reqH,
    components: components,
    colorSpace: "RGB",
    colorProfile: "sRGB IEC61966-2.1",
    chunky: true,
  }, is16Bit ? { fullRange: false } : {});

  var paddedImageData = await imaging.createImageDataFromBuffer(paddedBuffer, createOpts);

  /* Dispose the cropped original — caller owns the padded copy */
  imageData.dispose();

  return paddedImageData;
};

/* ── Image encoding ──
 *
 * Formal image & mask → vendor/png-encoder.js (pure JS, produces real PNG bytes).
 * UI preview           → Adobe imaging.encodeImageData (JPEG, safe for <img> display).
 *
 * DevList §8-P1: Do NOT rely on imaging.encodeImageData as the formal PNG encoder.
 */

window.PO.encodeFormalImagePng = async function (imageData) {
  var rawData = await imageData.getData({ chunky: true });
  var components = imageData.components || 3;
  return window.PO.PngEncoder.encode(
    imageData.width,
    imageData.height,
    rawData,
    components >= 4 ? 6 /* RGBA */ : 2 /* RGB */,
  );
};

window.PO.encodeFormalMaskPng = async function (maskImageData) {
  var grayscaleBuffer = await maskImageData.getData({ chunky: true });
  var rgbBuffer = window.PO.createRgbBufferFromGrayscale(
    grayscaleBuffer,
    maskImageData.width,
    maskImageData.height,
  );
  return window.PO.PngEncoder.encode(
    maskImageData.width,
    maskImageData.height,
    rgbBuffer,
    2 /* RGB */,
  );
};

window.PO.encodePreviewJpegBase64 = async function (previewImageData) {
  var photoshop = window.require("photoshop");
  var imaging = photoshop.imaging;
  var source = await previewImageData.getData({ chunky: true });
  var components =
    typeof previewImageData.components === "number"
      ? previewImageData.components
      : 4;

  var rgbBuffer = window.PO.createOpaqueJpegPreviewBuffer(
    source,
    previewImageData.width,
    previewImageData.height,
    components,
  );

  var rgbPreviewImageData = await imaging.createImageDataFromBuffer(rgbBuffer, {
    width: previewImageData.width,
    height: previewImageData.height,
    components: 3,
    colorSpace: "RGB",
    colorProfile: "sRGB IEC61966-2.1",
    chunky: true,
  });

  try {
    return await imaging.encodeImageData({
      imageData: rgbPreviewImageData,
      type: "image/jpeg",
      base64: true,
    });
  } finally {
    rgbPreviewImageData.dispose();
  }
};

/* ── Selection & capture ── */

window.PO.getSelectionBounds = async function () {
  var photoshop = window.require("photoshop");
  var app = photoshop.app;
  var action = photoshop.action;
  var documentRef = app.activeDocument;
  if (!documentRef) throw new Error("No active document.");

  var result = await action.batchPlay(
    [
      {
        _obj: "get",
        _target: [
          { _property: "selection" },
          { _ref: "document", _id: documentRef.id },
          { _ref: "application" },
        ],
        _options: { dialogOptions: "dontDisplay" },
      },
    ],
    {},
  );

  var selection =
    window.PO.normalizeSelectionBounds(result[0].selection) ||
    window.PO.normalizeSelectionBounds(result[0].selection && result[0].selection.bounds) ||
    window.PO.normalizeSelectionBounds(result[0].bounds);

  if (!selection || selection.width <= 0 || selection.height <= 0) {
    throw new Error("No active selection.");
  }

  window.PO.Logger.info("selection.detected", {
    component: "photoshop",
    data: {
      left: selection.left,
      top: selection.top,
      width: selection.width,
      height: selection.height,
    },
  });

  return selection;
};

window.PO.captureSelectionData = async function () {
  var photoshop = window.require("photoshop");
  var app = photoshop.app;
  var action = photoshop.action;
  var imaging = photoshop.imaging;
  var core = photoshop.core;
  var documentRef = app.activeDocument;
  if (!documentRef) throw new Error("No active document.");

  return core.executeAsModal(
    async function () {
      var result = await action.batchPlay(
        [
          {
            _obj: "get",
            _target: [
              { _property: "selection" },
              { _ref: "document", _id: documentRef.id },
              { _ref: "application" },
            ],
            _options: { dialogOptions: "dontDisplay" },
          },
        ],
        {},
      );

      var selection =
        window.PO.normalizeSelectionBounds(result[0].selection) ||
        window.PO.normalizeSelectionBounds(result[0].selection && result[0].selection.bounds) ||
        window.PO.normalizeSelectionBounds(result[0].bounds);

      if (!selection || selection.width <= 0 || selection.height <= 0) {
        throw new Error("No active selection.");
      }

      var captureBounds = window.PO.clampBoundsToCanvas(
        {
          left: selection.left,
          top: selection.top,
          right: selection.left + selection.width,
          bottom: selection.top + selection.height,
        },
        documentRef.width,
        documentRef.height,
      );

      /* ── Formal image (full resolution, RGBA) ── */
      var imageResult = await imaging.getPixels({
        documentID: documentRef.id,
        sourceBounds: captureBounds,
        colorSpace: "RGB",
        colorProfile: "sRGB IEC61966-2.1",
        componentSize: 8,
        applyAlpha: true, /* preserve transparency for formal PNG */
      });

      /* ── UI preview (thumbnail, RGBA) ── */
      var previewResult = await imaging.getPixels({
        documentID: documentRef.id,
        sourceBounds: captureBounds,
        targetSize: { width: 320 },
        colorSpace: "RGB",
        colorProfile: "sRGB IEC61966-2.1",
        componentSize: 8,
        applyAlpha: true,
      });

      /* ── Selection mask ── */
      var selectionResult = await imaging.getSelection({
        documentID: documentRef.id,
        sourceBounds: captureBounds,
      });

      try {
        /* Pad image & mask back to the originally-requested captureBounds
         * so every output is exactly selection-sized for the inpaint pipeline. */
        var paddedImageData = await window.PO.padImageDataToBounds(
          imageResult.imageData,
          captureBounds,
          imageResult.sourceBounds || captureBounds,
          0, /* fill transparent black for RGBA */
        );

        var paddedMaskData = await window.PO.padImageDataToBounds(
          selectionResult.imageData,
          captureBounds,
          selectionResult.sourceBounds || captureBounds,
          0, /* fill black = not-selected for grayscale mask */
        );

        /* Encode with vendor PNG encoder — real PNG bytes, preserves alpha */
        var imagePngBase64 = await window.PO.encodeFormalImagePng(paddedImageData);
        var maskPngBase64 = await window.PO.encodeFormalMaskPng(paddedMaskData);
        var previewJpegBase64 = await window.PO.encodePreviewJpegBase64(
          previewResult.imageData,
        );

        return {
          documentId: String(documentRef.id),
          bounds: selection,
          captureBounds: captureBounds,
          imagePngBase64: imagePngBase64,
          maskPngBase64: maskPngBase64,
          previewJpegBase64: previewJpegBase64,
          colorMode: String(documentRef.mode).replace(/ColorMode$/i, ""),
          resolution: documentRef.resolution,
        };
      } finally {
        /* paddedImageData / paddedMaskData own the buffers; the originals
         * were disposed by padImageDataToBounds. */
        try { paddedImageData.dispose(); } catch (e) { /* ignore */ }
        try { paddedMaskData.dispose(); } catch (e) { /* ignore */ }
        previewResult.imageData.dispose();
      }
    },
    { commandName: "PixelOasis Capture Selection Data" },
  );
};
