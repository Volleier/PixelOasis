/* subject-capture.js — v2 subject context capture
 *
 * Captures subject area for capabilities that need a subject (e.g. whiteStudio,
 * lightBlend, portrait editing).  NEVER auto-generates masks locally — the
 * gateway handles subject segmentation.
 *
 * Modes:
 *   "selection" — use current Photoshop selection as subject
 *   "auto"      — flag that gateway will auto-detect (no local segmentation)
 *   "layer"     — use active layer bounds (future)
 *
 * Provides:
 *   captureSubjectContext(policy, options) → { scope, subjectBounds, ... }
 */

window.PO = window.PO || {};

window.PO.SubjectCapture = (function () {
  "use strict";

  /* ── Capture subject context ── */
  async function captureSubjectContext(policy, options) {
    policy = policy || window.PO.CaptureUtils.getDefaultPolicy();
    options = options || {};
    var mode = options.mode || "auto";

    var photoshop = window.require("photoshop");
    var app = photoshop.app;
    var imaging = photoshop.imaging;
    var core = photoshop.core;
    var doc = app.activeDocument;

    if (!doc) throw new Error("无活动文档");

    var docInfo = window.PO.CaptureUtils.getDocumentInfo();
    if (!docInfo) throw new Error("无法获取文档信息");

    /* Determine subject bounds based on mode */
    var subjectBounds;
    var subjectMaskPngBase64 = null;
    var subjectSource = mode;

    if (mode === "selection") {
      /* Use current Photoshop selection */
      var selection = await window.PO.getSelectionBounds();
      if (!selection) throw new Error("无活动选区 — 请先选择主体区域");
      subjectBounds = window.PO.CaptureUtils.normalizeBounds(selection);
      if (!subjectBounds) throw new Error("选区无效");
    } else if (mode === "layer") {
      /* Use active layer bounds */
      try {
        var activeLayer = doc.activeLayers[0] || doc.activeLayer;
        if (!activeLayer) throw new Error("无活动图层");
        var lb = activeLayer.bounds;
        subjectBounds = window.PO.CaptureUtils.normalizeBounds({
          left: lb.left,
          top: lb.top,
          right: lb.right,
          bottom: lb.bottom,
        });
        if (!subjectBounds) throw new Error("无法获取图层边界");
      } catch (layerErr) {
        throw new Error("无法获取活动图层边界");
      }
    } else {
      /* "auto" — use full document, gateway handles detection */
      subjectBounds = {
        left: 0,
        top: 0,
        width: docInfo.width,
        height: docInfo.height,
      };
      subjectSource = "auto";
    }

    /* Color mode checks */
    var conversionApplied = false;
    if (window.PO.CaptureUtils.needsConversion(docInfo.mode, docInfo.bitDepth)) {
      if (!window.PO.CaptureUtils.isConversionSafe(docInfo.mode, docInfo.bitDepth)) {
        throw new Error("文档色彩模式不支持：" + docInfo.mode + " " + docInfo.bitDepth + "-bit");
      }
      conversionApplied = true;
    }

    /* Compute proxy */
    var subjectPixels = subjectBounds.width * subjectBounds.height;
    var proxy = window.PO.CaptureUtils.chooseProxySize(
      subjectBounds.width, subjectBounds.height,
      policy.maxPixels
    );
    var sourceScale = proxy ? proxy.sourceScale : 1;

    return core.executeAsModal(async function () {
      /* Capture subject area */
      var imageResult = await imaging.getPixels({
        documentID: doc.id,
        sourceBounds: {
          left: subjectBounds.left,
          top: subjectBounds.top,
          right: subjectBounds.left + subjectBounds.width,
          bottom: subjectBounds.top + subjectBounds.height,
        },
        colorSpace: "RGB",
        colorProfile: "sRGB IEC61966-2.1",
        componentSize: 8,
        applyAlpha: true,
        targetSize: proxy ? { width: proxy.width, height: proxy.height } : undefined,
      });

      /* If user has a selection in "selection" mode, also capture the mask */
      var maskImageData = null;
      if (mode === "selection") {
        try {
          var maskResult = await imaging.getSelection({
            documentID: doc.id,
            sourceBounds: {
              left: subjectBounds.left,
              top: subjectBounds.top,
              right: subjectBounds.left + subjectBounds.width,
              bottom: subjectBounds.top + subjectBounds.height,
            },
          });
          var paddedMask = await window.PO.padImageDataToBounds(
            maskResult.imageData,
            { left: subjectBounds.left, top: subjectBounds.top, right: subjectBounds.left + subjectBounds.width, bottom: subjectBounds.top + subjectBounds.height },
            maskResult.sourceBounds || { left: subjectBounds.left, top: subjectBounds.top, right: subjectBounds.left + subjectBounds.width, bottom: subjectBounds.top + subjectBounds.height },
            0
          );
          subjectMaskPngBase64 = await window.PO.encodeFormalMaskPng(paddedMask);
          try { paddedMask.dispose(); } catch (e) { /* ignore */ }
          try { maskResult.imageData.dispose(); } catch (e) { /* ignore */ }
        } catch (e) {
          /* Mask capture is optional for subject; proceed without it */
          window.PO.Logger && window.PO.Logger.warn("capture.subject_mask_failed", {
            component: "subject-capture",
            error: e,
          });
        }
      }

      /* Preview */
      var previewResult = await imaging.getPixels({
        documentID: doc.id,
        sourceBounds: {
          left: subjectBounds.left,
          top: subjectBounds.top,
          right: subjectBounds.left + subjectBounds.width,
          bottom: subjectBounds.top + subjectBounds.height,
        },
        targetSize: { width: policy.previewMaxDim || 512 },
        colorSpace: "RGB",
        colorProfile: "sRGB IEC61966-2.1",
        componentSize: 8,
        applyAlpha: true,
      });

      try {
        var imagePngBase64 = await window.PO.encodeFormalImagePng(imageResult.imageData);
        var previewJpegBase64 = await window.PO.encodePreviewJpegBase64(previewResult.imageData);

        var result = {
          scope: "subject",
          subjectBounds: subjectBounds,
          contextImagePngBase64: imagePngBase64,
          subjectMaskPngBase64: subjectMaskPngBase64,
          subjectSource: subjectSource,
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

        window.PO.Logger && window.PO.Logger.info("capture.subject_completed", {
          component: "subject-capture",
          data: {
            subjectBounds: subjectBounds.width + "x" + subjectBounds.height,
            mode: mode,
            hasMask: !!subjectMaskPngBase64,
            sourceScale: sourceScale,
          },
        });

        return result;
      } finally {
        try { imageResult.imageData.dispose(); } catch (e) { /* ignore */ }
        try { previewResult.imageData.dispose(); } catch (e) { /* ignore */ }
      }
    }, { commandName: "PixelOasis Capture Subject Context" });
  }

  return {
    captureSubjectContext: captureSubjectContext,
  };
})();
