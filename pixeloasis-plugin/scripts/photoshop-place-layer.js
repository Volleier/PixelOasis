window.PO = window.PO || {};

window.PO.placeGeneratedLayer = async function (imagePngBase64, maskPngBase64, bounds, workflowTitle) {
  if (!imagePngBase64) throw new Error("No image data to place.");

  var photoshop = window.require("photoshop");
  var app = photoshop.app;
  var action = photoshop.action;
  var core = photoshop.core;
  var documentRef = app.activeDocument;
  if (!documentRef) throw new Error("No active document.");

  function base64ToBytes(base64) {
    var raw = base64.indexOf(",") !== -1 ? base64.split(",")[1] : base64;
    var binary = atob(raw);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  async function writeTempFile(filename, bytes) {
    var storage = require("uxp").storage;
    var folder = await storage.localFileSystem.getDataFolder();
    var file = await folder.createFile(filename, { overwrite: true });
    await file.write(bytes);
    return file.nativePath;
  }

  function normalizeBounds(layerBounds) {
    if (!layerBounds) return null;
    return {
      left: window.PO.normalizeNumber(layerBounds.left),
      top: window.PO.normalizeNumber(layerBounds.top),
      right: window.PO.normalizeNumber(layerBounds.right),
      bottom: window.PO.normalizeNumber(layerBounds.bottom),
    };
  }

  function getActiveLayerBounds() {
    var layer = app.activeDocument && app.activeDocument.activeLayer;
    if (!layer) return null;
    var normalized = normalizeBounds(layer.bounds);
    if (
      normalized &&
      typeof normalized.left === "number" &&
      typeof normalized.top === "number"
    ) {
      return normalized;
    }
    return null;
  }

  async function placePng(path) {
    await action.batchPlay(
      [
        {
          _obj: "placeEvent",
          null: { _path: path, _kind: "local" },
          freeTransformCenterState: {
            _enum: "quadCenterState",
            _value: "QCSAverage",
          },
          offset: {
            _obj: "offset",
            horizontal: { _unit: "pixelsUnit", _value: 0 },
            vertical: { _unit: "pixelsUnit", _value: 0 },
          },
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
    return app.activeDocument.activeLayer;
  }

  async function selectLayerById(layerId) {
    await action.batchPlay(
      [
        {
          _obj: "select",
          _target: [{ _ref: "layer", _id: layerId }],
          makeVisible: false,
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  async function moveActiveLayerTo(targetBounds) {
    if (!targetBounds || typeof targetBounds.left !== "number" || typeof targetBounds.top !== "number") {
      return;
    }

    var current = getActiveLayerBounds();
    if (!current) return;

    var offsetX = targetBounds.left - current.left;
    var offsetY = targetBounds.top - current.top;
    if (offsetX === 0 && offsetY === 0) return;

    await action.batchPlay(
      [
        {
          _obj: "move",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          to: {
            _obj: "offset",
            horizontal: { _unit: "pixelsUnit", _value: offsetX },
            vertical: { _unit: "pixelsUnit", _value: offsetY },
          },
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  async function loadActiveRedChannelAsSelection() {
    await action.batchPlay(
      [
        {
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          to: { _ref: "channel", _enum: "channel", _value: "red" },
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  async function deleteActiveLayer() {
    await action.batchPlay(
      [
        {
          _obj: "delete",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  async function makeMaskFromSelection() {
    await action.batchPlay(
      [
        {
          _obj: "make",
          new: { _class: "channel" },
          at: { _ref: "channel", _enum: "channel", _value: "mask" },
          using: { _enum: "userMaskEnabled", _value: "revealSelection" },
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  async function renameActiveLayer(layerName) {
    await action.batchPlay(
      [
        {
          _obj: "set",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          to: { _obj: "layer", name: layerName },
          _options: { dialogOptions: "dontDisplay" },
        },
      ],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  return core.executeAsModal(
    async function () {
      var placeStart = Date.now();
      window.PO.Logger.info("placement.started", {
        component: "placement",
        correlationId: window.PO.state.capture ? "po-place-" + Date.now().toString(36) : undefined,
        workflowId: workflowTitle,
        data: {
          hasImage: !!imagePngBase64,
          hasMask: !!maskPngBase64,
          imageLength: imagePngBase64 ? imagePngBase64.length : 0,
        },
      });

      var imagePath = await writeTempFile(
        "po-result-" + Date.now() + ".png",
        base64ToBytes(imagePngBase64),
      );

      var resultLayer = await placePng(imagePath);
      var resultLayerId = resultLayer && resultLayer.id;
      await moveActiveLayerTo(bounds);

      if (maskPngBase64) {
        var maskPath = await writeTempFile(
          "po-mask-" + Date.now() + ".png",
          base64ToBytes(maskPngBase64),
        );

        var maskLayer = await placePng(maskPath);
        var maskLayerId = maskLayer && maskLayer.id;
        await moveActiveLayerTo(bounds);
        await loadActiveRedChannelAsSelection();

        if (maskLayerId) {
          await selectLayerById(maskLayerId);
        }
        await deleteActiveLayer();

        if (resultLayerId) {
          await selectLayerById(resultLayerId);
        }
        await makeMaskFromSelection();
      }

      var layerName = (workflowTitle || "PixelOasis") + " - " + new Date().toLocaleString();
      await renameActiveLayer(layerName);

      window.PO.Logger.info("placement.completed", {
        component: "placement",
        workflowId: workflowTitle,
        durationMs: Date.now() - placeStart,
        data: { layerName: layerName },
      });

      return { layerName: layerName };
    },
    { commandName: "PixelOasis Place Generated Layer" },
  );
};
