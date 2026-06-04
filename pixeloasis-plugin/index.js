(function () {
  const TEXT = {
    preview: "预览区",
    previewCapture: "抓取当前选区",
    previewBounds: "选区起点",
    previewSize: "选区尺寸",
    previewImageState: "原图缓存",
    previewMaskState: "蒙版缓存",
    previewUiState: "UI 预览",
    previewCached: "已缓存",
    previewNotCached: "未缓存",
    previewVisible: "已生成",
    ready: "ready",
    noDocument: "No active document.",
    noSelection: "No active selection.",
    shellReady: "uxp shell ready",
    sections: [
      { title: "人像精修", hint: "功能按钮待接入" },
      { title: "构图工具", hint: "功能按钮待接入" },
      { title: "光影风格", hint: "功能按钮待接入" },
      { title: "视觉特效", hint: "功能按钮待接入" },
      { title: "画质提升", hint: "功能按钮待接入" },
    ],
  };

  function buildSectionCards() {
    return TEXT.sections
      .map(function (section) {
        return (
          '<section class="po-section">' +
          '<div class="po-section__header">' +
          '<h2 class="po-section__title">' + section.title + "</h2>" +
          "</div>" +
          '<div class="po-section__body">' +
          '<div class="po-section__placeholder">' + section.hint + "</div>" +
          "</div>" +
          "</section>"
        );
      })
      .join("");
  }

  function buildTemplate() {
    return (
      '<div class="po-root">' +
      '<main class="po-main">' +
      buildSectionCards() +
      "</main>" +

      '<section class="po-preview">' +
      '<div class="po-preview__header">' +
      "<span>" + TEXT.preview + "</span>" +
      '<button id="capture-btn" class="po-preview-button" type="button">' +
      TEXT.previewCapture +
      "</button>" +
      "</div>" +
      '<div class="po-preview__body">' +
      '<div class="po-preview__canvas">' +
      '<img id="preview-image" class="po-preview__image" alt="selection preview" />' +
      "</div>" +
      "</div>" +
      "</section>" +

      '<footer class="po-bottom-bar">' +
      '<div id="status" class="po-status">' + TEXT.ready + "</div>" +
      "</footer>" +
      "</div>"
    );
  }

  function normalizeNumber(value) {
    if (typeof value === "number" && isFinite(value)) {
      return value;
    }
    if (value && typeof value === "object") {
      if (typeof value._value === "number") return value._value;
      if (typeof value.value === "number") return value.value;
    }
    return null;
  }

  function normalizeSelectionBounds(candidate) {
    if (!candidate || typeof candidate !== "object") return null;
    var left = normalizeNumber(candidate.left);
    var top = normalizeNumber(candidate.top);
    var right = normalizeNumber(candidate.right);
    var bottom = normalizeNumber(candidate.bottom);
    if (left === null || top === null || right === null || bottom === null) return null;
    return { left: left, top: top, width: right - left, height: bottom - top };
  }

  function clampBoundsToCanvas(bounds, canvasWidth, canvasHeight) {
    return {
      left: Math.max(0, Math.min(bounds.left, canvasWidth)),
      top: Math.max(0, Math.min(bounds.top, canvasHeight)),
      right: Math.max(0, Math.min(bounds.right, canvasWidth)),
      bottom: Math.max(0, Math.min(bounds.bottom, canvasHeight)),
    };
  }

  function formatSelectionBounds(bounds) {
    return "selection: " + bounds.left + "," + bounds.top + " " + bounds.width + "x" + bounds.height;
  }

  function createRgbBufferFromGrayscale(source, width, height) {
    var pixelCount = width * height;
    var Constructor = source.constructor;
    var target = new Constructor(pixelCount * 3);
    for (var i = 0; i < pixelCount; i++) {
      var v = source[i];
      var ti = i * 3;
      target[ti] = v;
      target[ti + 1] = v;
      target[ti + 2] = v;
    }
    return target;
  }

  function createRgbBufferFromImage(source, width, height, components) {
    if (components === 3) return source;
    var pixelCount = width * height;
    var Constructor = source.constructor;
    var target = new Constructor(pixelCount * 3);
    for (var i = 0; i < pixelCount; i++) {
      var si = i * components;
      var ti = i * 3;
      target[ti] = source[si];
      target[ti + 1] = source[si + 1];
      target[ti + 2] = source[si + 2];
    }
    return target;
  }

  async function encodeImageDataAsPngBase64(imageData, debugLog) {
    var photoshop = window.require("photoshop");
    var imaging = photoshop.imaging;

    var components =
      typeof imageData.components === "number" ? imageData.components : null;

    if (debugLog) {
      debugLog.push("[png] w=" + imageData.width + " h=" + imageData.height + " comp=" + components);
    }

    var pixelBuffer = await imageData.getData({ chunky: true });

    if (debugLog) {
      debugLog.push("[png] raw buffer=" + pixelBuffer.length + "b");
    }

    var rgbBuffer = createRgbBufferFromImage(
      pixelBuffer, imageData.width, imageData.height, components || 4
    );

    if (debugLog) {
      debugLog.push("[png] rgb buffer=" + rgbBuffer.length + "b");
      var samples = [];
      for (var i = 0; i < Math.min(5, Math.floor(rgbBuffer.length / 3)); i++) {
        var off = i * 3;
        samples.push("px" + i + "=R" + rgbBuffer[off] + " G" + rgbBuffer[off + 1] + " B" + rgbBuffer[off + 2]);
      }
      debugLog.push("[png] sample: " + samples.join(" | "));
    }

    var rgbImageData = await imaging.createImageDataFromBuffer(rgbBuffer, {
      width: imageData.width,
      height: imageData.height,
      components: 3,
      colorSpace: "RGB",
      colorProfile: "sRGB IEC61966-2.1",
    });

    try {
      var encoded = await imaging.encodeImageData({
        imageData: rgbImageData,
        type: "image/png",
        base64: true,
      });
      if (debugLog) {
        debugLog.push("[png] encoded=" + (encoded ? encoded.length : 0) + "b");
      }
      return encoded;
    } finally {
      rgbImageData.dispose();
    }
  }

  async function encodeSelectionMaskAsPngBase64(maskImageData, debugLog) {
    var photoshop = window.require("photoshop");
    var imaging = photoshop.imaging;
    var grayBuffer = await maskImageData.getData({ chunky: true });

    if (debugLog) {
      debugLog.push("[mask] gray buffer=" + grayBuffer.length + "b");
    }

    var rgbBuffer = createRgbBufferFromGrayscale(
      grayBuffer, maskImageData.width, maskImageData.height
    );

    var rgbMaskImageData = await imaging.createImageDataFromBuffer(rgbBuffer, {
      width: maskImageData.width,
      height: maskImageData.height,
      components: 3,
      colorSpace: "RGB",
      colorProfile: "sRGB IEC61966-2.1",
    });

    try {
      return await encodeImageDataAsPngBase64(rgbMaskImageData, debugLog);
    } finally {
      rgbMaskImageData.dispose();
    }
  }

  // ── Decode base64 PNG → Blob → object URL (for <img> display) ──

  function base64ToBlobUrl(base64Data, debugLog) {
    var binary = atob(base64Data);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    var blob = new Blob([bytes], { type: "image/png" });
    var url = URL.createObjectURL(blob);

    if (debugLog) {
      debugLog.push("[blob] size=" + bytes.length + "b url=" + url.substring(0, 50));
    }
    console.log("[PixelOasis] blob url=" + url);
    return url;
  }

  // ── Selection bounds ──

  async function getSelectionBounds() {
    var photoshop = window.require("photoshop");
    var app = photoshop.app;
    var action = photoshop.action;
    var doc = app.activeDocument;
    if (!doc) throw new Error(TEXT.noDocument);

    var result = await action.batchPlay(
      [{
        _obj: "get",
        _target: [
          { _property: "selection" },
          { _ref: "document", _id: doc.id },
          { _ref: "application" },
        ],
        _options: { dialogOptions: "dontDisplay" },
      }],
      {},
    );
    result = result[0];

    var sel =
      normalizeSelectionBounds(result.selection) ||
      normalizeSelectionBounds(result.selection && result.selection.bounds) ||
      normalizeSelectionBounds(result.bounds);

    if (!sel || sel.width <= 0 || sel.height <= 0) throw new Error(TEXT.noSelection);
    return sel;
  }

  // ── Main capture ──

  async function captureSelectionData() {
    var photoshop = window.require("photoshop");
    var app = photoshop.app;
    var action = photoshop.action;
    var imaging = photoshop.imaging;
    var core = photoshop.core;
    var doc = app.activeDocument;
    if (!doc) throw new Error(TEXT.noDocument);

    var debugLog = [];

    function logStep(msg) {
      debugLog.push(msg);
      console.log("[PixelOasis] " + msg);
    }

    return core.executeAsModal(
      async function () {
        logStep("step1: batchPlay get selection bounds");
        var batchResult = await action.batchPlay(
          [{
            _obj: "get",
            _target: [
              { _property: "selection" },
              { _ref: "document", _id: doc.id },
              { _ref: "application" },
            ],
            _options: { dialogOptions: "dontDisplay" },
          }],
          {},
        );
        batchResult = batchResult[0];

        var selection =
          normalizeSelectionBounds(batchResult.selection) ||
          normalizeSelectionBounds(batchResult.selection && batchResult.selection.bounds) ||
          normalizeSelectionBounds(batchResult.bounds);

        if (!selection || selection.width <= 0 || selection.height <= 0) {
          throw new Error(TEXT.noSelection);
        }

        logStep("step2: bounds=" + selection.left + "," + selection.top + " " + selection.width + "x" + selection.height);

        var captureBounds = clampBoundsToCanvas(
          { left: selection.left, top: selection.top, right: selection.left + selection.width, bottom: selection.top + selection.height },
          doc.width, doc.height,
        );

        logStep("step3: imaging.getPixels");
        var pixelsResult = await imaging.getPixels({
          documentID: doc.id,
          sourceBounds: captureBounds,
          colorSpace: "RGB",
          colorProfile: "sRGB IEC61966-2.1",
          componentSize: 8,
        });

        logStep("step4: getPixels w=" + pixelsResult.imageData.width + " h=" + pixelsResult.imageData.height + " comp=" + pixelsResult.imageData.components);

        logStep("step5: imaging.getSelection");
        var selectionResult = await imaging.getSelection({
          documentID: doc.id,
          sourceBounds: captureBounds,
        });

        logStep("step6: getSelection done");

        try {
          logStep("step7: encodeImageDataAsPngBase64");
          var imageBase64 = await encodeImageDataAsPngBase64(pixelsResult.imageData, debugLog);

          logStep("step8: encodeSelectionMaskAsPngBase64");
          var maskBase64 = await encodeSelectionMaskAsPngBase64(selectionResult.imageData, debugLog);

          logStep("step9: create blob URL for preview");
          var previewUrl = base64ToBlobUrl(imageBase64, debugLog);

          logStep("step10: done");

          return {
            documentId: String(doc.id),
            bounds: selection,
            imageBase64: imageBase64,
            maskBase64: maskBase64,
            previewUrl: previewUrl,
            colorMode: String(doc.mode),
            resolution: doc.resolution,
            _debugLog: debugLog,
          };
        } finally {
          pixelsResult.imageData.dispose();
          selectionResult.imageData.dispose();
        }
      },
      { commandName: "PixelOasis Capture Selection Data" },
    );
  }

  // ── Init ──

  try {
    var appRoot = document.getElementById("app");
    if (!appRoot) throw new Error("PixelOasis root element not found.");

    appRoot.innerHTML = buildTemplate();

    var captureButton = document.getElementById("capture-btn");
    var statusNode = document.getElementById("status");
    var previewImage = document.getElementById("preview-image");

    if (!captureButton || !statusNode || !previewImage) {
      throw new Error("PixelOasis UI element not found.");
    }

    var transientStatusTimer = null;
    var cachedSelection = null;

    function setStatus(msg) { statusNode.textContent = msg; }

    function clearTransientTimer() {
      if (transientStatusTimer) { clearTimeout(transientStatusTimer); transientStatusTimer = null; }
    }

    async function refreshSelectionStatus() {
      clearTransientTimer();
      try {
        var bounds = await getSelectionBounds();
        setStatus(formatSelectionBounds(bounds));
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    }

    function showTransientStatus(msg) {
      clearTransientTimer();
      setStatus(msg);
      transientStatusTimer = setTimeout(function () { refreshSelectionStatus(); }, 2000);
    }

    // ── Image load/error tracking ──

    var imageLoadOk = false;
    var imageLoadError = null;

    previewImage.addEventListener("load", function () {
      imageLoadOk = true;
      imageLoadError = null;
      console.log("[PixelOasis] img loaded, natural=" + previewImage.naturalWidth + "x" + previewImage.naturalHeight);
    });

    previewImage.addEventListener("error", function () {
      imageLoadOk = false;
      imageLoadError = "img load error";
      console.error("[PixelOasis] img load ERROR");
    });

    // ── Capture button ──

    captureButton.addEventListener("click", async function () {
      try {
        setStatus("capturing...");
        imageLoadOk = false;
        imageLoadError = null;

        var capture = await captureSelectionData();
        cachedSelection = capture;

        if (capture._debugLog && capture._debugLog.length > 0) {
          console.log("[PixelOasis] Debug:\n" + capture._debugLog.join("\n"));
        }

        var pngLen = capture.imageBase64 ? capture.imageBase64.length : 0;
        var blobUrl = capture.previewUrl || "";

        console.log("[PixelOasis] blobUrl=" + blobUrl);
        setStatus("setting blob URL...");

        previewImage.setAttribute("src", blobUrl);

        writeDebugLogToPluginData(capture._debugLog).catch(function () {});

        setTimeout(function () {
          if (imageLoadOk) {
            setStatus("OK: " + previewImage.naturalWidth + "x" + previewImage.naturalHeight + " " + pngLen + "b PNG");
          } else if (imageLoadError) {
            setStatus("WARN: " + imageLoadError + ", " + pngLen + "b");
          } else {
            setStatus("WAIT: pending, " + pngLen + "b");
          }
        }, 800);
      } catch (error) {
        var errMsg = error instanceof Error ? error.message : String(error);
        console.error("[PixelOasis] " + errMsg);
        setStatus("ERROR: " + errMsg);
      }
    });

    // ── Write debug log ──

    async function writeDebugLogToPluginData(debugLog) {
      try {
        var uxp = window.require("uxp");
        var localFileSystem = uxp.storage.localFileSystem;
        var dataFolder = await localFileSystem.getDataFolder();
        var lines = (debugLog || []).join("\n");
        var ts = new Date().toISOString().replace(/[:.]/g, "-");
        var file = await dataFolder.createFile("pixeloasis-debug-" + ts + ".log", { overwrite: true });
        await file.write(lines, { append: false });
        console.log("[PixelOasis] log written: " + file.nativePath);
      } catch (e) {
        console.warn("[PixelOasis] log write failed: " + e);
      }
    }

    // ── Initial status ──

    try {
      var photoshop = window.require("photoshop");
      if (photoshop && photoshop.app) {
        refreshSelectionStatus();
      } else {
        setStatus(TEXT.shellReady);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }

  } catch (error) {
    document.body.innerHTML =
      '<pre class="po-fatal">' + (error instanceof Error ? error.stack || error.message : String(error)) + "</pre>";
  }
})();
