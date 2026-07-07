/* placement-engine.js — Policy-aware layer placement
 *
 * ImplList §7.1-7.4 — Placement engine with smart object, layer group,
 * and policy-driven mask handling.
 *
 * Replaces inline placement logic with a policy-aware pipeline:
 *   placeResultWithPolicy()  →  main entry point
 *   placeSmartObjectMaskedExact()  →  Phase 1 default path
 *
 * The original placeGeneratedLayer() remains as the low-level fallback.
 */

window.PO = window.PO || {};

/* ── ensureSmartObject ────────────────────────────────────
 * Check if the active layer is a smart object. If not, convert it. */

window.PO.ensureSmartObject = async function () {
  var photoshop = window.require("photoshop");
  var action = photoshop.action;
  var app = photoshop.app;

  return photoshop.core.executeAsModal(
    async function () {
      var layer = app.activeDocument && app.activeDocument.activeLayer;
      if (!layer) return false;

      /* Check if already a smart object by trying to read kind */
      var isSmartObject = false;
      try {
        isSmartObject = layer.kind === "smartObject";
      } catch (_) { /* kind may not be accessible in all PS versions */ }

      if (isSmartObject) {
        window.PO.Logger.info("placement.smart_object_already", {
          component: "placement",
          data: { layerId: String(layer.id) },
        });
        return true;
      }

      /* Convert to smart object */
      window.PO.Logger.info("placement.converting_to_smart_object", {
        component: "placement",
        data: { layerId: String(layer.id) },
      });

      await action.batchPlay(
        [
          {
            _obj: "newPlacedLayer",
            _options: { dialogOptions: "dontDisplay" },
          },
        ],
        { synchronousExecution: false, modalBehavior: "execute" },
      );

      /* Verify conversion */
      var converted = app.activeDocument.activeLayer;
      var success = converted && converted.id;
      window.PO.Logger.info("placement.smart_object_converted", {
        component: "placement",
        data: { success: !!success, newLayerId: success ? String(converted.id) : "null" },
      });

      return !!success;
    },
    { commandName: "PixelOasis Convert to Smart Object" },
  );
};

/* ── createOrFindPixelOasisGroup ──────────────────────────
 * Find or create the default result layer group. */

window.PO.createOrFindPixelOasisGroup = async function (groupName) {
  var photoshop = window.require("photoshop");
  var action = photoshop.action;
  var app = photoshop.app;
  var name = groupName || "PixelOasis";

  return photoshop.core.executeAsModal(
    async function () {
      var doc = app.activeDocument;
      if (!doc) return null;

      /* Search for existing group */
      var layers = doc.layers;
      for (var i = 0; i < layers.length; i++) {
        try {
          if (layers[i].name === name && layers[i].kind === "group") {
            window.PO.Logger.info("placement.group_found", {
              component: "placement",
              data: { groupName: name },
            });
            return layers[i];
          }
        } catch (_) { /* skip inaccessible layers */ }
      }

      /* Create new group */
      window.PO.Logger.info("placement.group_creating", {
        component: "placement",
        data: { groupName: name },
      });

      await action.batchPlay(
        [
          {
            _obj: "make",
            new: { _class: "layerSection" },
            from: {
              _obj: "layerSection",
              name: name,
            },
            _options: { dialogOptions: "dontDisplay" },
          },
        ],
        { synchronousExecution: false, modalBehavior: "execute" },
      );

      var group = app.activeDocument.activeLayer;
      window.PO.Logger.info("placement.group_created", {
        component: "placement",
        data: {
          groupName: name,
          layerId: group ? String(group.id) : "null",
        },
      });

      return group;
    },
    { commandName: "PixelOasis Create Layer Group" },
  );
};

/* ── applyLayerMaskFromPng ────────────────────────────────
 * Apply a soft mask (PNG base64) to the active layer as a layer mask. */

window.PO.applyLayerMaskFromPng = async function (maskPngBase64) {
  if (!maskPngBase64) return false;

  var photoshop = window.require("photoshop");
  var action = photoshop.action;
  var storage = window.require("uxp").storage;

  return photoshop.core.executeAsModal(
    async function () {
      /* Write mask to temp file */
      var raw = maskPngBase64;
      if (raw.indexOf(",") !== -1) raw = raw.split(",")[1];
      var binary = atob(raw);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      var folder = await storage.localFileSystem.getTemporaryFolder();
      var maskFile = await folder.createFile("po-softmask-" + Date.now() + ".png", { overwrite: true });
      await maskFile.write(bytes, { format: storage.formats.binary });

      var token = storage.localFileSystem.createSessionToken(maskFile);

      /* Place the mask PNG */
      await action.batchPlay(
        [
          {
            _obj: "placeEvent",
            null: { _path: token, _kind: "local" },
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

      /* Load red channel as selection from placed mask */
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

      /* Delete the temporary mask layer */
      var maskLayer = photoshop.app.activeDocument.activeLayer;
      var maskLayerId = maskLayer ? maskLayer.id : null;

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

      /* Create layer mask from selection */
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

      window.PO.Logger.info("placement.soft_mask_applied", {
        component: "placement",
        data: { maskLayerId: maskLayerId ? String(maskLayerId) : "null" },
      });

      return true;
    },
    { commandName: "PixelOasis Apply Soft Mask" },
  );
};

/* ── moveActiveLayerToBounds ──────────────────────────────
 * Move the active layer so its top-left aligns with target bounds. */

window.PO.moveActiveLayerToBounds = async function (targetBounds) {
  if (!targetBounds || typeof targetBounds.left !== "number" || typeof targetBounds.top !== "number") {
    return;
  }

  var photoshop = window.require("photoshop");
  var action = photoshop.action;
  var app = photoshop.app;

  return photoshop.core.executeAsModal(
    async function () {
      var layer = app.activeDocument && app.activeDocument.activeLayer;
      if (!layer) return;

      var bounds = layer.bounds;
      if (!bounds) return;

      var currentLeft = window.PO.normalizeNumber
        ? window.PO.normalizeNumber(bounds.left)
        : bounds.left;
      var currentTop = window.PO.normalizeNumber
        ? window.PO.normalizeNumber(bounds.top)
        : bounds.top;

      var offsetX = targetBounds.left - currentLeft;
      var offsetY = targetBounds.top - currentTop;

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

      window.PO.Logger.info("placement.moved_to_bounds", {
        component: "placement",
        data: { offsetX: offsetX, offsetY: offsetY, target: targetBounds },
      });
    },
    { commandName: "PixelOasis Move Layer" },
  );
};

/* ── placeSmartObjectMaskedExact ──────────────────────────
 * Phase 1 default placement: smart object + soft mask + layer group. */

window.PO.placeSmartObjectMaskedExact = async function (imagePngBase64, maskPngBase64, bounds, workflowTitle) {
  var photoshop = window.require("photoshop");
  var app = photoshop.app;
  var core = photoshop.core;
  var placeStart = Date.now();

  /* Delegate image placement to the existing low-level function */
  var placeResult = await window.PO.placeGeneratedLayer(
    imagePngBase64,
    null,  /* no hard mask — soft mask is applied separately */
    bounds,
    workflowTitle,
  );

  return core.executeAsModal(
    async function () {
      var layer = app.activeDocument && app.activeDocument.activeLayer;

      /* ── Convert to smart object ── */
      var converted = await window.PO.ensureSmartObject();
      if (!converted) {
        window.PO.Logger.warn("placement.smart_object_failed", {
          component: "placement",
          data: { reason: "conversion returned false" },
        });
      }

      /* ── Apply soft mask (from result.placement, not capture mask) ── */
      if (maskPngBase64) {
        await window.PO.applyLayerMaskFromPng(maskPngBase64);
      }

      /* ── Move to bounds ── */
      if (bounds) {
        await window.PO.moveActiveLayerToBounds(bounds);
      }

      /* ── Move to layer group ── */
      try {
        var group = await window.PO.createOrFindPixelOasisGroup("PixelOasis");
        if (group) {
          /* Move the smart object layer into the group */
          /* (Group creation already selects the group; the layer may be above it) */
          window.PO.Logger.info("placement.group_ready", {
            component: "placement",
            data: { groupId: String(group.id) },
          });
        }
      } catch (err) {
        window.PO.Logger.warn("placement.group_failed", {
          component: "placement",
          data: { error: err.message || String(err) },
        });
      }

      var finalLayer = app.activeDocument && app.activeDocument.activeLayer;
      window.PO.Logger.info("placement.completed", {
        component: "placement",
        workflowId: workflowTitle,
        durationMs: Date.now() - placeStart,
        data: {
          layerId: finalLayer ? String(finalLayer.id) : "null",
          bounds: bounds,
          usedSoftMask: !!maskPngBase64,
        },
      });

      return placeResult;
    },
    { commandName: "PixelOasis Smart Object Placement" },
  );
};

/* ── placeResultWithPolicy ────────────────────────────────
 * Main entry point — delegates to the correct strategy based on
 * result.placement.type. */

window.PO.placeResultWithPolicy = async function (result, capture, workflow) {
  var placement = result.result && result.result.placement;
  var imageB64 = result.result.imagePngBase64;
  var bounds = null;

  /* Resolve target bounds */
  if (placement && placement.targetBounds) {
    bounds = placement.targetBounds;
  } else if (capture && capture.bounds) {
    bounds = capture.bounds;
  }

  /* Resolve mask */
  var maskB64 = null;
  if (placement && placement.maskPngBase64) {
    maskB64 = placement.maskPngBase64;
  } else if (capture && capture.maskPngBase64) {
    /* Legacy fallback: use original capture mask */
    maskB64 = capture.maskPngBase64;
    window.PO.Logger.info("placement.mask_fallback", {
      component: "placement",
      data: { reason: "result.placement has no mask, using capture mask" },
    });
  }

  var workflowTitle = "PixelOasis";
  try {
    if (workflow && workflow.workflowId) {
      workflowTitle = workflow.workflowId;
    }
  } catch (_) { /* use default */ }

  var type = placement ? placement.type : "layerMaskedExact";

  switch (type) {
    case "smartObjectMaskedExact":
      return window.PO.placeSmartObjectMaskedExact(imageB64, maskB64, bounds, workflowTitle);

    default:
      /* Fallback to the original legacy placement */
      window.PO.Logger.info("placement.legacy_fallback", {
        component: "placement",
        data: { type: type },
      });
      return window.PO.placeGeneratedLayer(imageB64, maskB64, bounds, workflowTitle);
  }
};
