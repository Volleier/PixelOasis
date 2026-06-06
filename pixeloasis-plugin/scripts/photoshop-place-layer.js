/* photoshop-place-layer.js — Place generated PNG + mask into Photoshop
 *
 * DevList §8-P4.
 *
 * Usage:
 *   await window.PO.placeGeneratedLayer(imagePngBase64, maskPngBase64,
 *                                        bounds, workflowTitle);
 */

window.PO = window.PO || {};

window.PO.placeGeneratedLayer = async function (imagePngBase64, maskPngBase64, bounds, workflowTitle) {
  if (!imagePngBase64) throw new Error("No image data to place.");

  var photoshop = window.require("photoshop");
  var app = photoshop.app;
  var action = photoshop.action;
  var core = photoshop.core;
  var document = app.activeDocument;
  if (!document) throw new Error("No active document.");

  /* ── Helper: decode base64 → Uint8Array ── */
  function base64ToBytes(b64) {
    var raw = b64;
    if (raw.indexOf(",") !== -1) raw = raw.split(",")[1];
    var binary = atob(raw);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /* ── Helper: write bytes to a temp file ── */
  async function writeTempFile(filename, bytes) {
    var storage = require("uxp").storage;
    var folder = await storage.localFileSystem.getDataFolder();
    var file = await folder.createFile(filename, { overwrite: true });
    await file.write(bytes);
    return file.nativePath;
  }

  return core.executeAsModal(async function () {
    /* Step 1 — Write image to temp file */
    var imageBytes = base64ToBytes(imagePngBase64);
    var imagePath = await writeTempFile("po-result-" + Date.now() + ".png", imageBytes);

    /* Step 2 — Place image as new layer */
    var placeResult = await action.batchPlay([
      {
        _obj: "placeEvent",
        null: { _path: imagePath, _kind: "local" },
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        offset: {
          _obj: "offset",
          horizontal: { _unit: "pixelsUnit", _value: 0 },
          vertical: { _unit: "pixelsUnit", _value: 0 },
        },
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: false, modalBehavior: "execute" });

    /* Step 3 — Position layer at selection bounds */
    if (bounds && typeof bounds.left === "number") {
      /* Move the placed layer so its top-left aligns with selection top-left.
       * After placeEvent, the image is centered or at a default position.
       * We calculate the offset needed. */
      var layerBounds = placeResult[0] && placeResult[0].bounds;
      if (layerBounds) {
        var offsetX = bounds.left - layerBounds.left;
        var offsetY = bounds.top - layerBounds.top;
        if (offsetX !== 0 || offsetY !== 0) {
          await action.batchPlay([
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
          ], { synchronousExecution: false, modalBehavior: "execute" });
        }
      }
    }

    /* Step 4 — Apply layer mask (if mask provided) */
    if (maskPngBase64) {
      var maskBytes = base64ToBytes(maskPngBase64);
      var maskPath = await writeTempFile("po-mask-" + Date.now() + ".png", maskBytes);

      /* Place mask as a temporary layer */
      await action.batchPlay([
        {
          _obj: "placeEvent",
          null: { _path: maskPath, _kind: "local" },
          freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
          offset: {
            _obj: "offset",
            horizontal: { _unit: "pixelsUnit", _value: 0 },
            vertical: { _unit: "pixelsUnit", _value: 0 },
          },
          _options: { dialogOptions: "dontDisplay" },
        },
      ], { synchronousExecution: false, modalBehavior: "execute" });

      /* Load mask layer transparency as selection */
      await action.batchPlay([
        {
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          to: {
            _ref: "channel",
            _enum: "channel",
            _value: "transparencyEnum",
            _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          },
          _options: { dialogOptions: "dontDisplay" },
        },
      ], { synchronousExecution: false, modalBehavior: "execute" });

      /* Delete the temporary mask layer */
      await action.batchPlay([
        {
          _obj: "delete",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          _options: { dialogOptions: "dontDisplay" },
        },
      ], { synchronousExecution: false, modalBehavior: "execute" });

      /* Select the result layer and add a layer mask from selection */
      /* The result layer is now two layers down (mask was placed above, then deleted) */
      await action.batchPlay([
        {
          _obj: "make",
          _target: [{ _ref: "channel", _property: "mask" }],
          using: { _enum: "userMaskEnabled", _value: "revealSelection" },
          _options: { dialogOptions: "dontDisplay" },
        },
      ], { synchronousExecution: false, modalBehavior: "execute" });
    }

    /* Step 5 — Name the layer */
    var layerName = (workflowTitle || "PixelOasis") + " — " + new Date().toLocaleString();
    await action.batchPlay([
      {
        _obj: "set",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        to: { _obj: "layer", name: layerName },
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: false, modalBehavior: "execute" });

    return { layerName: layerName };
  }, { commandName: "PixelOasis Place Generated Layer" });
};
