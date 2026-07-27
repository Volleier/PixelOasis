/* document-capture.js — v2 full-document composite capture
 *
 * Captures the visible document composite for capabilities with
 * input.source === "document" (e.g. scene effects, lighting, cleanup).
 *
 * Provides:
 *   captureDocumentComposite(policy) → { scope, imagePngBase64, bounds, documentInfo, preview, ... }
 */

window.PO = window.PO || {};

window.PO.DocumentCapture = (function () {
  "use strict";

  /* ── Capture full document composite ── */
  async function captureDocumentComposite(policy, options) {
    policy = policy || window.PO.CaptureUtils.getDefaultPolicy();
    options = options || {};

    var photoshop = window.require("photoshop");
    var app = photoshop.app;
    var imaging = photoshop.imaging;
    var core = photoshop.core;
    var doc = app.activeDocument;

    if (!doc) throw new Error("无活动文档");

    var docInfo = window.PO.CaptureUtils.getDocumentInfo();
    if (!docInfo) throw new Error("无法获取文档信息");

    /* Check color mode conversion */
    var conversionApplied = false;
    if (window.PO.CaptureUtils.needsConversion(docInfo.mode, docInfo.bitDepth)) {
      if (!window.PO.CaptureUtils.isConversionSafe(docInfo.mode, docInfo.bitDepth)) {
        throw new Error("文档色彩模式不支持：" + docInfo.mode + " " + docInfo.bitDepth + "-bit");
      }
      conversionApplied = true;
    }

    var canvasBounds = window.PO.CaptureUtils.normalizeBounds({
      left: 0,
      top: 0,
      right: docInfo.width,
      bottom: docInfo.height,
    });
    if (!canvasBounds) throw new Error("文档尺寸无效");

    /* Compute proxy if document is oversized */
    var proxy = window.PO.CaptureUtils.chooseProxySize(
      docInfo.width, docInfo.height, policy.maxPixels
    );
    var sourceScale = proxy ? proxy.sourceScale : 1;

    return core.executeAsModal(async function () {
      /* Full canvas capture */
      var imageResult = await imaging.getPixels({
        documentID: doc.id,
        sourceBounds: {
          left: 0,
          top: 0,
          right: docInfo.width,
          bottom: docInfo.height,
        },
        colorSpace: "RGB",
        colorProfile: "sRGB IEC61966-2.1",
        componentSize: 8,
        applyAlpha: true,
        targetSize: proxy ? { width: proxy.width, height: proxy.height } : undefined,
      });

      /* Preview thumbnail */
      var previewResult = await imaging.getPixels({
        documentID: doc.id,
        sourceBounds: {
          left: 0,
          top: 0,
          right: docInfo.width,
          bottom: docInfo.height,
        },
        targetSize: { width: policy.previewMaxDim || 512 },
        colorSpace: "RGB",
        colorProfile: "sRGB IEC61966-2.1",
        componentSize: 8,
        applyAlpha: true,
      });

      var subjectMaskPngBase64 = null;
      if (options.captureSubjectSelection) {
        try {
          var subjectMaskResult = await imaging.getSelection({
            documentID: doc.id,
            sourceBounds: { left: 0, top: 0, right: docInfo.width, bottom: docInfo.height },
          });
          var paddedSubjectMask = await window.PO.padImageDataToBounds(
            subjectMaskResult.imageData,
            { left: 0, top: 0, right: docInfo.width, bottom: docInfo.height },
            subjectMaskResult.sourceBounds || { left: 0, top: 0, right: docInfo.width, bottom: docInfo.height },
            0
          );
          subjectMaskPngBase64 = await window.PO.encodeFormalMaskPng(paddedSubjectMask);
          try { paddedSubjectMask.dispose(); } catch (_) {}
        } catch (error) {
          window.PO.Logger && window.PO.Logger.warn("capture.optional_subject_mask_failed", {
            component: "document-capture",
            error: error,
          });
        }
      }

      try {
        var imagePngBase64 = await window.PO.encodeFormalImagePng(imageResult.imageData);
        var previewJpegBase64 = await window.PO.encodePreviewJpegBase64(previewResult.imageData);

        var result = {
          scope: "document",
          imagePngBase64: imagePngBase64,
          subjectMaskPngBase64: subjectMaskPngBase64,
          subjectSource: subjectMaskPngBase64 ? "selection" : "auto",
          bounds: canvasBounds,
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

        window.PO.Logger && window.PO.Logger.info("capture.document_completed", {
          component: "document-capture",
          data: {
            width: docInfo.width,
            height: docInfo.height,
            sourceScale: sourceScale,
            conversionApplied: conversionApplied,
            hasSubjectMask: !!subjectMaskPngBase64,
            previewSize: previewResult.imageData.width + "x" + previewResult.imageData.height,
          },
        });

        return result;
      } finally {
        try { imageResult.imageData.dispose(); } catch (e) { /* ignore */ }
        try { previewResult.imageData.dispose(); } catch (e) { /* ignore */ }
      }
    }, { commandName: "PixelOasis Capture Document Composite" });
  }

  return {
    captureDocumentComposite: captureDocumentComposite,
  };
})();
