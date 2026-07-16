/* selection-capture.js — v2 precise selection capture
 *
 * Captures exact edit mask + expanded context for capabilities with
 * input.editMask === "required" or input.mask === "required".
 *
 * Key design:
 *   - editBounds  = original selection (exact)
 *   - contextBounds = editBounds expanded, clamped to canvas
 *   - editMaskPngBase64 = exact mask at contextBounds size (white = editable)
 *   - contextOffset = editBounds position within context image
 *   -Context mask and edit mask are NEVER substituted for each other
 *
 * Provides:
 *   captureSelectionContext(policy) → { scope, editBounds, contextBounds, ... }
 */

window.PO = window.PO || {};

window.PO.SelectionCapture = (function () {
  "use strict";

  /* ── Capture selection with edit mask + expanded context ── */
  async function captureSelectionContext(policy) {
    policy = policy || window.PO.CaptureUtils.getDefaultPolicy();

    var photoshop = window.require("photoshop");
    var app = photoshop.app;
    var imaging = photoshop.imaging;
    var core = photoshop.core;
    var doc = app.activeDocument;

    if (!doc) throw new Error("无活动文档");

    var docInfo = window.PO.CaptureUtils.getDocumentInfo();
    if (!docInfo) throw new Error("无法获取文档信息");

    /* Get selection bounds */
    var selection = await window.PO.getSelectionBounds();
    if (!selection) throw new Error("无活动选区");

    var editBounds = window.PO.CaptureUtils.normalizeBounds(selection);
    if (!editBounds) throw new Error("选区无效");

    /* Color mode checks */
    var conversionApplied = false;
    if (window.PO.CaptureUtils.needsConversion(docInfo.mode, docInfo.bitDepth)) {
      if (!window.PO.CaptureUtils.isConversionSafe(docInfo.mode, docInfo.bitDepth)) {
        throw new Error("文档色彩模式不支持：" + docInfo.mode + " " + docInfo.bitDepth + "-bit");
      }
      conversionApplied = true;
    }

    /* Expand context around selection */
    var expandPx = policy.contextExpandPx || 96;
    var contextBounds = window.PO.CaptureUtils.expandAndClampBounds(
      editBounds, expandPx, docInfo.width, docInfo.height
    );

    /* Context offset: where editBounds sits within context */
    var contextOffset = {
      left: editBounds.left - contextBounds.left,
      top:  editBounds.top - contextBounds.top,
    };

    /* Compute proxy */
    var contextPixels = contextBounds.width * contextBounds.height;
    var proxy = window.PO.CaptureUtils.chooseProxySize(
      contextBounds.width, contextBounds.height,
      policy.maxPixels
    );
    var sourceScale = proxy ? proxy.sourceScale : 1;

    return core.executeAsModal(async function () {
      /* ── Context image (expanded bounds) ── */
      var contextResult = await imaging.getPixels({
        documentID: doc.id,
        sourceBounds: {
          left: contextBounds.left,
          top: contextBounds.top,
          right: contextBounds.left + contextBounds.width,
          bottom: contextBounds.top + contextBounds.height,
        },
        colorSpace: "RGB",
        colorProfile: "sRGB IEC61966-2.1",
        componentSize: 8,
        applyAlpha: true,
        targetSize: proxy ? { width: proxy.width, height: proxy.height } : undefined,
      });

      /* ── Selection mask (exact edit mask, captured at context size for alignment) ── */
      var maskResult = await imaging.getSelection({
        documentID: doc.id,
        sourceBounds: {
          left: contextBounds.left,
          top: contextBounds.top,
          right: contextBounds.left + contextBounds.width,
          bottom: contextBounds.top + contextBounds.height,
        },
      });

      /* ── Preview ── */
      var previewResult = await imaging.getPixels({
        documentID: doc.id,
        sourceBounds: {
          left: contextBounds.left,
          top: contextBounds.top,
          right: contextBounds.left + contextBounds.width,
          bottom: contextBounds.top + contextBounds.height,
        },
        targetSize: { width: policy.previewMaxDim || 512 },
        colorSpace: "RGB",
        colorProfile: "sRGB IEC61966-2.1",
        componentSize: 8,
        applyAlpha: true,
      });

      try {
        /* Pad image and mask to requested bounds */
        var paddedContext = await window.PO.padImageDataToBounds(
          contextResult.imageData,
          { left: contextBounds.left, top: contextBounds.top, right: contextBounds.left + contextBounds.width, bottom: contextBounds.top + contextBounds.height },
          contextResult.sourceBounds || { left: contextBounds.left, top: contextBounds.top, right: contextBounds.left + contextBounds.width, bottom: contextBounds.top + contextBounds.height },
          0
        );

        var paddedMask = await window.PO.padImageDataToBounds(
          maskResult.imageData,
          { left: contextBounds.left, top: contextBounds.top, right: contextBounds.left + contextBounds.width, bottom: contextBounds.top + contextBounds.height },
          maskResult.sourceBounds || { left: contextBounds.left, top: contextBounds.top, right: contextBounds.left + contextBounds.width, bottom: contextBounds.top + contextBounds.height },
          0
        );

        var contextImagePngBase64 = await window.PO.encodeFormalImagePng(paddedContext);
        var editMaskPngBase64 = await window.PO.encodeFormalMaskPng(paddedMask);
        var previewJpegBase64 = await window.PO.encodePreviewJpegBase64(previewResult.imageData);

        var result = {
          scope: "selection",
          editBounds: editBounds,
          contextBounds: contextBounds,
          contextImagePngBase64: contextImagePngBase64,
          editMaskPngBase64: editMaskPngBase64,
          contextOffset: contextOffset,
          contextExpandPx: expandPx,
          documentInfo: docInfo,
          preview: previewJpegBase64,
          previewWidth: previewResult.imageData.width,
          previewHeight: previewResult.imageData.height,
          conversionApplied: conversionApplied,
          sourceScale: sourceScale,
          captureSessionId: window.PO.CaptureUtils.generateSessionId(),
        };

        /* Update state */
        if (window.PO.state && window.PO.state.capture) {
          window.PO.state.capture.active = result;
          window.PO.state.capture.preview = previewJpegBase64;
          window.PO.state.capture.status = "ready";
        }

        window.PO.Logger && window.PO.Logger.info("capture.selection_completed", {
          component: "selection-capture",
          data: {
            editBounds: editBounds.width + "x" + editBounds.height,
            contextBounds: contextBounds.width + "x" + contextBounds.height,
            expandPx: expandPx,
            sourceScale: sourceScale,
          },
        });

        return result;
      } finally {
        try { paddedContext.dispose(); } catch (e) { /* ignore */ }
        try { paddedMask.dispose(); } catch (e) { /* ignore */ }
        try { previewResult.imageData.dispose(); } catch (e) { /* ignore */ }
      }
    }, { commandName: "PixelOasis Capture Selection Context" });
  }

  return {
    captureSelectionContext: captureSelectionContext,
  };
})();
