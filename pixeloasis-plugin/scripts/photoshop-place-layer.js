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
    /* Use system temp folder — Photoshop has direct access (unlike the
     * plugin data folder which requires UXP tokens in v6). */
    var folder = await storage.localFileSystem.getTemporaryFolder();

    window.PO.Logger.info("placement.temp_folder", {
      component: "placement",
      data: { folder: folder.nativePath ? folder.nativePath.replace(/\\/g, "/") : "(unknown)", filename: filename, byteLength: bytes.length },
    });

    var file = await folder.createFile(filename, { overwrite: true });
    await file.write(bytes, { format: storage.formats.binary });

    window.PO.Logger.info("placement.file_written", {
      component: "placement",
      data: { path: file.nativePath ? file.nativePath.replace(/\\/g, "/") : "(unknown)", size: bytes.length },
    });

    return file;
  }

  function createFileToken(fileEntry) {
    var storage = require("uxp").storage;
    if (!fileEntry) {
      throw new Error("No file entry available for token creation.");
    }
    if (!storage || !storage.localFileSystem || typeof storage.localFileSystem.createSessionToken !== "function") {
      throw new Error("UXP createSessionToken is unavailable.");
    }
    return storage.localFileSystem.createSessionToken(fileEntry);
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

  async function placePng(fileEntry) {
    window.PO.Logger.info("placement.placing_file", {
      component: "placement",
      data: { path: fileEntry.nativePath ? fileEntry.nativePath.replace(/\\/g, "/") : "(unknown)", name: fileEntry.name },
    });

    /* UXP v6 requires a session token for Photoshop file-placement actions.
     * Passing a raw file entry or native path causes "invalid file token used". */
    try {
      var sessionToken = createFileToken(fileEntry);
      window.PO.Logger.info("placement.file_token_created", {
        component: "placement",
        data: { tokenLength: sessionToken ? sessionToken.length : 0, name: fileEntry.name },
      });

      await action.batchPlay(
        [
          {
            _obj: "placeEvent",
            null: { _path: sessionToken, _kind: "local" },
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

      var placedLayer = app.activeDocument.activeLayer;
      window.PO.Logger.info("placement.file_placed", {
        component: "placement",
        data: { method: "session_token", layerId: placedLayer ? String(placedLayer.id) : "null" },
      });
      return placedLayer;
    } catch (err1) {
      window.PO.Logger.warn("placement.place_method_token_failed", {
        component: "placement",
        data: { method: "session_token", error: err1.message || String(err1) },
      });

      /* Fallback: direct file-entry payload for older host behavior. */
      try {
        window.PO.Logger.info("placement.placing_file_retry", {
          component: "placement",
          data: { method: "file_entry", name: fileEntry.name },
        });

        await action.batchPlay(
          [
            {
              _obj: "placeEvent",
              null: fileEntry,
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

        var placedLayer2 = app.activeDocument.activeLayer;
        window.PO.Logger.info("placement.file_placed", {
          component: "placement",
          data: { method: "file_entry", layerId: placedLayer2 ? String(placedLayer2.id) : "null" },
        });
        return placedLayer2;
      } catch (err2) {
        window.PO.Logger.warn("placement.place_method_entry_failed", {
          component: "placement",
          data: { method: "file_entry", error: err2.message || String(err2) },
        });

        /* Last fallback: try file URI for older placement behavior. */
        try {
          var uriPath = "file:///" + fileEntry.nativePath.replace(/\\/g, "/");
          window.PO.Logger.info("placement.placing_file_retry", {
            component: "placement",
            data: { method: "file_uri", path: uriPath },
          });

          await action.batchPlay(
            [
              {
                _obj: "placeEvent",
                null: { _path: uriPath, _kind: "local" },
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

          var placedLayer3 = app.activeDocument.activeLayer;
          window.PO.Logger.info("placement.file_placed", {
            component: "placement",
            data: { method: "file_uri", layerId: placedLayer3 ? String(placedLayer3.id) : "null" },
          });
          return placedLayer3;
        } catch (err3) {
          window.PO.Logger.warn("placement.place_method_uri_failed", {
            component: "placement",
            data: { method: "file_uri", error: err3.message || String(err3) },
          });
          throw err3;
        }
      }
    }
  }

  async function selectLayerById(layerId) {
    window.PO.Logger.info("placement.selecting_layer", {
      component: "placement",
      data: { layerId: String(layerId) },
    });

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
      window.PO.Logger.info("placement.move_skipped", {
        component: "placement",
        data: { reason: "no target bounds" },
      });
      return;
    }

    var current = getActiveLayerBounds();
    if (!current) {
      window.PO.Logger.info("placement.move_skipped", {
        component: "placement",
        data: { reason: "no current bounds" },
      });
      return;
    }

    var offsetX = targetBounds.left - current.left;
    var offsetY = targetBounds.top - current.top;
    if (offsetX === 0 && offsetY === 0) {
      window.PO.Logger.info("placement.move_skipped", {
        component: "placement",
        data: { reason: "already at target position" },
      });
      return;
    }

    window.PO.Logger.info("placement.moving_layer", {
      component: "placement",
      data: { offsetX: offsetX, offsetY: offsetY, from: { left: current.left, top: current.top }, to: targetBounds },
    });

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
    window.PO.Logger.info("placement.loading_red_channel", { component: "placement" });

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
    window.PO.Logger.info("placement.deleting_layer", { component: "placement" });

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
    window.PO.Logger.info("placement.making_mask", { component: "placement" });

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
    window.PO.Logger.info("placement.renaming_layer", {
      component: "placement",
      data: { layerName: layerName },
    });

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
      var stepStart = placeStart;
      var step = "";

      try {
        step = "decode_image";
        window.PO.Logger.info("placement.step", {
          component: "placement",
          data: { step: step, elapsedMs: Date.now() - placeStart },
        });

        var imageBytes = base64ToBytes(imagePngBase64);
        var maskBytes = maskPngBase64 ? base64ToBytes(maskPngBase64) : null;

        window.PO.Logger.info("placement.step", {
          component: "placement",
          data: { step: step + "_done", elapsedMs: Date.now() - placeStart, imageBytes: imageBytes.length, maskBytes: maskBytes ? maskBytes.length : 0 },
        });

        step = "write_image_temp_file";
        stepStart = Date.now();
        window.PO.Logger.info("placement.step", {
          component: "placement",
          data: { step: step, elapsedMs: Date.now() - placeStart },
        });

        var imageFile = await writeTempFile(
          "po-result-" + Date.now() + ".png",
          imageBytes,
        );

        window.PO.Logger.info("placement.step", {
          component: "placement",
          data: { step: step + "_done", durationMs: Date.now() - stepStart },
        });

        step = "place_image";
        stepStart = Date.now();
        window.PO.Logger.info("placement.step", {
          component: "placement",
          data: { step: step, elapsedMs: Date.now() - placeStart },
        });

        var resultLayer = await placePng(imageFile);
        var resultLayerId = resultLayer && resultLayer.id;

        window.PO.Logger.info("placement.step", {
          component: "placement",
          data: { step: step + "_done", durationMs: Date.now() - stepStart, resultLayerId: resultLayerId ? String(resultLayerId) : "null" },
        });

        step = "move_to_bounds";
        stepStart = Date.now();
        window.PO.Logger.info("placement.step", {
          component: "placement",
          data: { step: step, elapsedMs: Date.now() - placeStart, bounds: bounds },
        });

        await moveActiveLayerTo(bounds);

        window.PO.Logger.info("placement.step", {
          component: "placement",
          data: { step: step + "_done", durationMs: Date.now() - stepStart },
        });

        if (maskBytes) {
          step = "write_mask_temp_file";
          stepStart = Date.now();
          window.PO.Logger.info("placement.step", {
            component: "placement",
            data: { step: step, elapsedMs: Date.now() - placeStart },
          });

          var maskFile = await writeTempFile(
            "po-mask-" + Date.now() + ".png",
            maskBytes,
          );

          window.PO.Logger.info("placement.step", {
            component: "placement",
            data: { step: step + "_done", durationMs: Date.now() - stepStart },
          });

          step = "place_mask";
          stepStart = Date.now();
          window.PO.Logger.info("placement.step", {
            component: "placement",
            data: { step: step, elapsedMs: Date.now() - placeStart },
          });

          var maskLayer = await placePng(maskFile);
          var maskLayerId = maskLayer && maskLayer.id;

          window.PO.Logger.info("placement.step", {
            component: "placement",
            data: { step: step + "_done", durationMs: Date.now() - stepStart, maskLayerId: maskLayerId ? String(maskLayerId) : "null" },
          });

          step = "move_mask";
          stepStart = Date.now();
          await moveActiveLayerTo(bounds);

          step = "load_selection";
          stepStart = Date.now();
          window.PO.Logger.info("placement.step", {
            component: "placement",
            data: { step: step, elapsedMs: Date.now() - placeStart },
          });

          await loadActiveRedChannelAsSelection();

          if (maskLayerId) {
            step = "select_mask_layer";
            stepStart = Date.now();
            await selectLayerById(maskLayerId);
          }

          step = "delete_mask_layer";
          stepStart = Date.now();
          window.PO.Logger.info("placement.step", {
            component: "placement",
            data: { step: step, elapsedMs: Date.now() - placeStart },
          });

          await deleteActiveLayer();

          step = "select_result_layer";
          stepStart = Date.now();
          if (resultLayerId) {
            await selectLayerById(resultLayerId);
          }

          step = "make_mask";
          stepStart = Date.now();
          window.PO.Logger.info("placement.step", {
            component: "placement",
            data: { step: step, elapsedMs: Date.now() - placeStart },
          });

          await makeMaskFromSelection();
        }

        step = "rename";
        var layerName = (workflowTitle || "PixelOasis") + " - " + new Date().toLocaleString();
        await renameActiveLayer(layerName);

        window.PO.Logger.info("placement.completed", {
          component: "placement",
          workflowId: workflowTitle,
          durationMs: Date.now() - placeStart,
          data: { layerName: layerName },
        });

        return { layerName: layerName, layerId: resultLayerId ? String(resultLayerId) : undefined };
      } catch (err) {
        window.PO.Logger.error("placement.step_failed", {
          component: "placement",
          data: {
            step: step,
            elapsedMs: Date.now() - placeStart,
            errorMessage: err.message || String(err),
            errorStack: err.stack || "",
          },
        });
        throw err;
      }
    },
    { commandName: "PixelOasis Place Generated Layer" },
  );
};
