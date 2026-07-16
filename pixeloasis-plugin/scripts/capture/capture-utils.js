/* capture-utils.js — v2 low-level capture helpers
 *
 * All bounds are in Photoshop document pixels (integers).
 * CSS-pixel preview coordinates must be converted back before use.
 *
 * Provides:
 *   getDocumentInfo()             → { id, width, height, mode, bitDepth, resolution }
 *   normalizeBounds(bounds)       → { left, top, width, height } in document px
 *   expandAndClampBounds(b,px,w,h)→ expanded bounds clamped to canvas
 *   chooseProxySize(w,h,maxPx)    → proxy targetSize for oversized docs
 *   needsConversion(mode, bitDepth) → true for CMYK/Lab/32-bit
 *   releaseCapture(captureObj)    → nulls refs, updates state
 */

window.PO = window.PO || {};

window.PO.CaptureUtils = (function () {
  "use strict";

  /* ── Get active document info ── */
  function getDocumentInfo() {
    try {
      var photoshop = window.require("photoshop");
      var doc = photoshop.app.activeDocument;
      if (!doc) return null;

      /* Normalize all numeric fields to plain integers */
      var width  = Math.round(window.PO.normalizeNumber(doc.width));
      var height = Math.round(window.PO.normalizeNumber(doc.height));
      var bitDepth = Math.round(window.PO.normalizeNumber(doc.bitsPerChannel || 8));
      var resolution = Math.round(window.PO.normalizeNumber(doc.resolution || 72));

      if (!(width >= 1) || !(height >= 1)) return null;

      return {
        id:         String(doc.id),
        width:      width,
        height:     height,
        mode:       String(doc.mode).replace(/ColorMode$/i, ""),
        bitDepth:   bitDepth,
        resolution: resolution,
      };
    } catch (e) {
      return null;
    }
  }

  /* ── Normalize bounds to standard { left, top, width, height } ── */
  function normalizeBounds(candidate) {
    if (!candidate || typeof candidate !== "object") return null;

    var left   = window.PO.normalizeNumber(candidate.left);
    var top    = window.PO.normalizeNumber(candidate.top);
    var width  = candidate.width  !== undefined ? window.PO.normalizeNumber(candidate.width)  : null;
    var height = candidate.height !== undefined ? window.PO.normalizeNumber(candidate.height) : null;

    /* Derive from right/bottom if needed */
    if (width === null && candidate.right !== undefined) {
      var right = window.PO.normalizeNumber(candidate.right);
      if (left !== null && right !== null) width = right - left;
    }
    if (height === null && candidate.bottom !== undefined) {
      var bottom = window.PO.normalizeNumber(candidate.bottom);
      if (top !== null && bottom !== null) height = bottom - top;
    }

    if (left === null || top === null || width === null || height === null) return null;
    if (width < 0 || height < 0) return null;

    return {
      left:   Math.round(left),
      top:    Math.round(top),
      width:  Math.round(width),
      height: Math.round(height),
    };
  }

  /* ── Expand bounds by N pixels, clamped to canvas ── */
  function expandAndClampBounds(bounds, expandPx, canvasW, canvasH) {
    if (!bounds) return null;

    var left   = Math.max(0, bounds.left - expandPx);
    var top    = Math.max(0, bounds.top - expandPx);
    var right  = Math.min(canvasW, bounds.left + bounds.width + expandPx);
    var bottom = Math.min(canvasH, bounds.top + bounds.height + expandPx);

    return {
      left:   left,
      top:    top,
      width:  right - left,
      height: bottom - top,
    };
  }

  /* ── Compute proxy size for oversized documents ── */
  function chooseProxySize(sourceW, sourceH, maxPixels) {
    if (!maxPixels || maxPixels <= 0) return null;

    var totalPixels = sourceW * sourceH;
    if (totalPixels <= maxPixels) return null; /* No proxy needed */

    var scale = Math.sqrt(maxPixels / totalPixels);
    return {
      width:  Math.round(sourceW * scale),
      height: Math.round(sourceH * scale),
      sourceScale: scale,
    };
  }

  /* ── Check if color mode needs conversion ── */
  function needsConversion(mode, bitDepth) {
    if (!mode) return false;
    var m = String(mode).toLowerCase();
    /* CMYK, Lab, or 32-bit need special handling */
    if (m === "cmyk" || m === "lab") return true;
    if (bitDepth === 32) return true;
    return false;
  }

  /* ── Check if conversion is safe ── */
  function isConversionSafe(mode, bitDepth) {
    var m = String(mode).toLowerCase();
    /* CMYK can be converted to RGB with some fidelity loss */
    if (m === "cmyk") return true;
    /* Lab → RGB is generally safe */
    if (m === "lab") return true;
    /* 16-bit → 8-bit is safe (truncation) */
    if (bitDepth === 16) return true;
    /* 32-bit HDR → 8-bit may lose significant data */
    if (bitDepth === 32) return false;
    return true;
  }

  /* ── Release capture references and update state ── */
  function releaseCapture(captureObj) {
    if (!captureObj) return;

    /* Null out base64/image references to free memory */
    var keys = [
      "imagePngBase64", "maskPngBase64", "previewJpegBase64",
      "contextImagePngBase64", "editMaskPngBase64",
      "subjectMaskPngBase64", "preview",
    ];
    for (var i = 0; i < keys.length; i++) {
      if (captureObj[keys[i]]) {
        captureObj[keys[i]] = null;
      }
    }

    /* Update state */
    if (window.PO.state && window.PO.state.capture) {
      window.PO.state.capture.status = "idle";
      window.PO.state.capture.active = null;
      window.PO.state.capture.preview = null;
    }
  }

  /* ── Get default capture policy ── */
  function getDefaultPolicy() {
    return {
      maxPixels: 4096 * 4096,     /* ~16.7 MP — default max for capture */
      contextExpandPx: 96,        /* Context expansion around selection */
      previewMaxDim: 512,         /* Max preview thumbnail dimension */
      jpegQuality: 0.85,          /* Preview JPEG quality */
    };
  }

  /* ── Generate a capture session ID ── */
  function generateSessionId() {
    var ts = Date.now().toString(36);
    var rnd = Math.floor(Math.random() * 10000).toString(36);
    return "cap_" + ts + "_" + rnd;
  }

  /* ── Build source metadata for trace/upload ── */
  function buildSourceMetadata(capture) {
    if (!capture) return {};
    var docInfo = capture.documentInfo || getDocumentInfo();
    var bounds = capture.editBounds || capture.subjectBounds || capture.bounds;
    var imagePng = capture.imagePngBase64 || capture.contextImagePngBase64;
    return {
      originalName: docInfo ? ("Untitled-" + docInfo.id + ".png") : "capture.png",
      clientWidth: bounds ? bounds.width : (docInfo ? docInfo.width : 0),
      clientHeight: bounds ? bounds.height : (docInfo ? docInfo.height : 0),
      sourceScale: capture.sourceScale || 1,
      scope: capture.scope || "document",
    };
  }

  return {
    getDocumentInfo:      getDocumentInfo,
    normalizeBounds:      normalizeBounds,
    expandAndClampBounds:  expandAndClampBounds,
    chooseProxySize:      chooseProxySize,
    needsConversion:      needsConversion,
    isConversionSafe:     isConversionSafe,
    releaseCapture:       releaseCapture,
    getDefaultPolicy:     getDefaultPolicy,
    generateSessionId:    generateSessionId,
    buildSourceMetadata:  buildSourceMetadata,
  };
})();
