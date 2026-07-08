/* placement-engine.js — Policy-aware layer placement
 *
 * ImplList §7.1-7.4 — Placement engine with smart object, layer group,
 * and policy-driven mask handling.
 *
 * P0-3 fix: All batchPlay operations run inside a SINGLE executeAsModal().
 * P0-4 fix: Result layer is actively moved into the PixelOasis layer group.
 * P1-5 fix: Placement is returned even when no mask is present.
 *
 * Architecture:
 *   placeResultWithPolicy()  →  dispatches by type
 *   placeSmartObjectMaskedExact()  →  single executeAsModal wrapper
 *     ├─ placeImageViaTempFile()       (batchPlay — no modal)
 *     ├─ convertToSmartObject()        (batchPlay — no modal)
 *     ├─ applySoftMaskViaTempFile()    (batchPlay — no modal)
 *     ├─ moveLayerToBounds()           (batchPlay — no modal)
 *     └─ moveLayerIntoGroup()          (batchPlay — no modal)
 */

window.PO = window.PO || {};

/* ── Internal helpers (NO executeAsModal — called inside the single wrapper) ── */

var _ps = null;
function _photoshop() {
  if (!_ps) _ps = window.require("photoshop");
  return _ps;
}

function _action() { return _photoshop().action; }
function _app() { return _photoshop().app; }
function _storage() { return window.require("uxp").storage; }

/* Decode base64 to Uint8Array */
function _b64ToBytes(b64) {
  var raw = b64.indexOf(",") !== -1 ? b64.split(",")[1] : b64;
  var bin = atob(raw);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/* Write a temp file and return its file entry + session token */
async function _writeTempFile(filename, bytes) {
  var folder = await _storage().localFileSystem.getTemporaryFolder();
  var file = await folder.createFile(filename, { overwrite: true });
  await file.write(bytes, { format: _storage().formats.binary });
  return file;
}

function _createFileToken(fileEntry) {
  return _storage().localFileSystem.createSessionToken(fileEntry);
}

/* ── placeImageViaTempFile (batchPlay only, NO modal) ── */
async function _placeImageViaTempFile(imageB64) {
  var bytes = _b64ToBytes(imageB64);
  var file = await _writeTempFile("po-result-" + Date.now() + ".png", bytes);
  var token = _createFileToken(file);

  window.PO.Logger.info("placement.placing", {
    component: "placement",
    data: { name: file.name },
  });

  /* Try session token first */
  try {
    await _action().batchPlay(
      [{
        _obj: "placeEvent",
        null: { _path: token, _kind: "local" },
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        offset: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: 0 }, vertical: { _unit: "pixelsUnit", _value: 0 } },
        _options: { dialogOptions: "dontDisplay" },
      }],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
    return _app().activeDocument.activeLayer;
  } catch (_) {
    /* Fallback: file URI */
    var uri = "file:///" + file.nativePath.replace(/\\/g, "/");
    await _action().batchPlay(
      [{
        _obj: "placeEvent",
        null: { _path: uri, _kind: "local" },
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        offset: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: 0 }, vertical: { _unit: "pixelsUnit", _value: 0 } },
        _options: { dialogOptions: "dontDisplay" },
      }],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
    return _app().activeDocument.activeLayer;
  }
}

/* ── convertToSmartObject (batchPlay only, NO modal) ── */
async function _convertToSmartObject(layerId) {
  var layer = _app().activeDocument.activeLayer;
  if (!layer) return false;

  /* Select the target layer */
  await _action().batchPlay(
    [{ _obj: "select", _target: [{ _ref: "layer", _id: layerId }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }],
    { synchronousExecution: false, modalBehavior: "execute" },
  );

  /* Check if already smart object */
  var isSmart = false;
  try { isSmart = _app().activeDocument.activeLayer.kind === "smartObject"; } catch (_) {}

  if (isSmart) {
    window.PO.Logger.info("placement.already_smart_object", { component: "placement", data: { layerId: String(layerId) } });
    return true;
  }

  /* Convert */
  window.PO.Logger.info("placement.converting_smart_object", { component: "placement", data: { layerId: String(layerId) } });

  try {
    await _action().batchPlay(
      [{ _obj: "newPlacedLayer", _options: { dialogOptions: "dontDisplay" } }],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  } catch (_) {
    /* newPlacedLayer may not work on already-placed layers.
     * Try the group-into-smart-object approach as fallback. */
    try {
      await _action().batchPlay(
        [{ _obj: "groupEvent", _options: { dialogOptions: "dontDisplay" } }],
        { synchronousExecution: false, modalBehavior: "execute" },
      );
      await _action().batchPlay(
        [{ _obj: "newPlacedLayer", _options: { dialogOptions: "dontDisplay" } }],
        { synchronousExecution: false, modalBehavior: "execute" },
      );
    } catch (_2) {
      window.PO.Logger.warn("placement.smart_object_failed", { component: "placement", data: { error: _2.message || String(_2) } });
      return false;
    }
  }

  var converted = _app().activeDocument.activeLayer;
  var ok = false;
  try {
    ok = !!(converted && converted.id && converted.kind === "smartObject");
  } catch (_) {
    ok = false;
  }
  window.PO.Logger.info(ok ? "placement.smart_object_ok" : "placement.smart_object_failed", {
    component: "placement",
    data: {
      newLayerId: converted ? String(converted.id) : "null",
      layerKind: converted && converted.kind ? String(converted.kind) : "unknown",
    },
  });
  return ok;
}

/* ── applySoftMaskViaTempFile (batchPlay only, NO modal) ── */
async function _applySoftMaskViaTempFile(maskB64, resultLayerId) {
  if (!maskB64) return false;

  /* Select result layer first */
  await _action().batchPlay(
    [{ _obj: "select", _target: [{ _ref: "layer", _id: resultLayerId }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }],
    { synchronousExecution: false, modalBehavior: "execute" },
  );

  /* Write mask to temp file and place */
  var bytes = _b64ToBytes(maskB64);
  var file = await _writeTempFile("po-softmask-" + Date.now() + ".png", bytes);
  var token = _createFileToken(file);

  await _action().batchPlay(
    [{
      _obj: "placeEvent",
      null: { _path: token, _kind: "local" },
      freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
      offset: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: 0 }, vertical: { _unit: "pixelsUnit", _value: 0 } },
      _options: { dialogOptions: "dontDisplay" },
    }],
    { synchronousExecution: false, modalBehavior: "execute" },
  );

  /* Load red channel as selection from placed mask */
  await _action().batchPlay(
    [{ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _ref: "channel", _enum: "channel", _value: "red" }, _options: { dialogOptions: "dontDisplay" } }],
    { synchronousExecution: false, modalBehavior: "execute" },
  );

  /* Delete the temporary mask layer */
  await _action().batchPlay(
    [{ _obj: "delete", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], _options: { dialogOptions: "dontDisplay" } }],
    { synchronousExecution: false, modalBehavior: "execute" },
  );

  /* Reselect result layer */
  await _action().batchPlay(
    [{ _obj: "select", _target: [{ _ref: "layer", _id: resultLayerId }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }],
    { synchronousExecution: false, modalBehavior: "execute" },
  );

  /* Create layer mask from selection */
  await _action().batchPlay(
    [{ _obj: "make", new: { _class: "channel" }, at: { _ref: "channel", _enum: "channel", _value: "mask" }, using: { _enum: "userMaskEnabled", _value: "revealSelection" }, _options: { dialogOptions: "dontDisplay" } }],
    { synchronousExecution: false, modalBehavior: "execute" },
  );

  window.PO.Logger.info("placement.soft_mask_applied", { component: "placement" });
  return true;
}

/* ── moveLayerToBounds (batchPlay only, NO modal) ── */
async function _moveLayerToBounds(targetBounds) {
  if (!targetBounds) return;

  var layer = _app().activeDocument.activeLayer;
  if (!layer) return;

  var bounds = layer.bounds;
  if (!bounds) return;

  var curL = window.PO.normalizeNumber(bounds.left);
  var curT = window.PO.normalizeNumber(bounds.top);
  var targetL = window.PO.normalizeNumber(targetBounds.left);
  var targetT = window.PO.normalizeNumber(targetBounds.top);

  if (curL === null || curT === null || targetL === null || targetT === null) {
    window.PO.Logger.warn("placement.move_failed", {
      component: "placement",
      data: {
        reason: "invalid_bounds",
        currentLeft: String(bounds.left),
        currentTop: String(bounds.top),
        targetLeft: String(targetBounds.left),
        targetTop: String(targetBounds.top),
      },
    });
    return;
  }

  var dx = targetL - curL;
  var dy = targetT - curT;
  if (!isFinite(dx) || !isFinite(dy)) {
    window.PO.Logger.warn("placement.move_failed", {
      component: "placement",
      data: { reason: "invalid_offset", dx: String(dx), dy: String(dy) },
    });
    return;
  }
  if (dx === 0 && dy === 0) return;

  await _action().batchPlay(
    [{ _obj: "move", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: dx }, vertical: { _unit: "pixelsUnit", _value: dy } }, _options: { dialogOptions: "dontDisplay" } }],
    { synchronousExecution: false, modalBehavior: "execute" },
  );

  window.PO.Logger.info("placement.moved_to_bounds", { component: "placement", data: { dx: dx, dy: dy } });
}

/* ── fitLayerToBounds: scale + move to match target bounds (P0-20260708-4) ── */
async function _fitLayerToBounds(layerId, targetBounds) {
  if (!targetBounds || !layerId) return false;

  /* Select the target layer */
  await _action().batchPlay(
    [{ _obj: "select", _target: [{ _ref: "layer", _id: layerId }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }],
    { synchronousExecution: false, modalBehavior: "execute" },
  );

  var doc = _app().activeDocument;
  var layer = doc.activeLayer;
  if (!layer) return false;

  var bounds = layer.bounds;
  if (!bounds) return false;

  var curL = window.PO.normalizeNumber(bounds.left);
  var curT = window.PO.normalizeNumber(bounds.top);
  var curR = window.PO.normalizeNumber(bounds.right);
  var curB = window.PO.normalizeNumber(bounds.bottom);
  var targetL = window.PO.normalizeNumber(targetBounds.left);
  var targetT = window.PO.normalizeNumber(targetBounds.top);
  var targetW = window.PO.normalizeNumber(targetBounds.width);
  var targetH = window.PO.normalizeNumber(targetBounds.height);

  if (curL === null || curT === null || curR === null || curB === null ||
      targetL === null || targetT === null || targetW === null || targetH === null) {
    throw new Error("Invalid bounds in fitLayerToBounds: cannot normalize layer or target bounds.");
  }

  var curW = curR - curL;
  var curH = curB - curT;
  var tolerancePx = 2;

  window.PO.Logger.info("placement.fit_layer", {
    component: "placement",
    data: {
      placedBoundsBeforeTransform: { left: curL, top: curT, width: curW, height: curH },
      targetBounds: { left: targetL, top: targetT, width: targetW, height: targetH },
    },
  });

  var needsScale = Math.abs(curW - targetW) > tolerancePx || Math.abs(curH - targetH) > tolerancePx;

  if (needsScale) {
    var scaleX = (targetW / curW) * 100;
    var scaleY = (targetH / curH) * 100;

    window.PO.Logger.info("placement.scaling", {
      component: "placement",
      data: { scaleX: Math.round(scaleX * 100) / 100, scaleY: Math.round(scaleY * 100) / 100 },
    });

    try {
      await _action().batchPlay(
        [{
          _obj: "transform",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSIndependent" },
          width: { _unit: "percentUnit", _value: scaleX },
          height: { _unit: "percentUnit", _value: scaleY },
          _options: { dialogOptions: "dontDisplay" },
        }],
        { synchronousExecution: false, modalBehavior: "execute" },
      );
    } catch (e) {
      throw new Error("Failed to scale layer to target dimensions: " + (e.message || String(e)));
    }

    /* Re-read bounds after scaling */
    layer = doc.activeLayer;
    if (layer && layer.bounds) {
      curL = window.PO.normalizeNumber(layer.bounds.left);
      curT = window.PO.normalizeNumber(layer.bounds.top);
    }
  }

  /* Move to target position */
  if (curL !== null && curT !== null) {
    var dx = targetL - curL;
    var dy = targetT - curT;

    if (!isFinite(dx) || !isFinite(dy)) {
      throw new Error(
        "Invalid offset in fitLayerToBounds: dx=" + String(dx) + " dy=" + String(dy)
      );
    }

    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      await _action().batchPlay(
        [{ _obj: "move", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: dx }, vertical: { _unit: "pixelsUnit", _value: dy } }, _options: { dialogOptions: "dontDisplay" } }],
        { synchronousExecution: false, modalBehavior: "execute" },
      );
    }
  }

  /* Verify after transform */
  layer = doc.activeLayer;
  if (layer && layer.bounds) {
    var al = window.PO.normalizeNumber(layer.bounds.left);
    var at = window.PO.normalizeNumber(layer.bounds.top);
    var ar = window.PO.normalizeNumber(layer.bounds.right);
    var ab = window.PO.normalizeNumber(layer.bounds.bottom);

    if (al !== null && at !== null && ar !== null && ab !== null) {
      var afterW = ar - al;
      var afterH = ab - at;
      var wOk = Math.abs(afterW - targetW) <= tolerancePx;
      var hOk = Math.abs(afterH - targetH) <= tolerancePx;

      window.PO.Logger.info("placement.fit_completed", {
        component: "placement",
        data: {
          placedBoundsAfterTransform: { left: al, top: at, width: afterW, height: afterH },
          targetBounds: { left: targetL, top: targetT, width: targetW, height: targetH },
          withinTolerance: wOk && hOk,
        },
      });

      if (!wOk || !hOk) {
        throw new Error(
          "Placement bounds mismatch after transform: " +
          "after=" + afterW + "x" + afterH +
          " target=" + targetW + "x" + targetH +
          " (delta: " + (afterW - targetW) + "x" + (afterH - targetH) + ")"
        );
      }
    }
  }

  return true;
}

/* ── createOrFindPixelOasisGroup + moveLayerIntoGroup (batchPlay only, NO modal) ── */
async function _findOrCreateGroup(groupName) {
  var doc = _app().activeDocument;
  if (!doc) return null;

  var name = groupName || "PixelOasis";

  /* Search for existing group */
  var layers = doc.layers;
  for (var i = 0; i < layers.length; i++) {
    try {
      if (layers[i].name === name && layers[i].kind === "group") {
        window.PO.Logger.info("placement.group_found", { component: "placement", data: { name: name } });
        return layers[i];
      }
    } catch (_) {}
  }

  /* Create new group */
  window.PO.Logger.info("placement.group_creating", { component: "placement", data: { name: name } });

  await _action().batchPlay(
    [{ _obj: "make", new: { _class: "layerSection" }, from: { _obj: "layerSection", name: name }, _options: { dialogOptions: "dontDisplay" } }],
    { synchronousExecution: false, modalBehavior: "execute" },
  );

  var group = _app().activeDocument.activeLayer;
  window.PO.Logger.info("placement.group_created", { component: "placement", data: { name: name, layerId: group ? String(group.id) : "null" } });
  return group;
}

async function _moveLayerIntoGroup(layerId, groupId) {
  if (!layerId || !groupId) return false;

  await _action().batchPlay(
    [{ _obj: "select", _target: [{ _ref: "layer", _id: layerId }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }],
    { synchronousExecution: false, modalBehavior: "execute" },
  );

  try {
    await _action().batchPlay(
      [{
        _obj: "move",
        _target: [{ _ref: "layer", _id: layerId }],
        to: { _ref: "layer", _id: groupId },
        adjustment: false,
        version: 5,
        layerID: [layerId],
        _options: { dialogOptions: "dontDisplay" },
      }],
      { synchronousExecution: false, modalBehavior: "execute" },
    );

    await _action().batchPlay(
      [{ _obj: "select", _target: [{ _ref: "layer", _id: layerId }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }],
      { synchronousExecution: false, modalBehavior: "execute" },
    );

    window.PO.Logger.info("placement.group_move_completed", {
      component: "placement",
      data: { resultLayerId: String(layerId), groupId: String(groupId) },
    });
    return true;
  } catch (err) {
    window.PO.Logger.warn("placement.group_move_failed", {
      component: "placement",
      data: {
        resultLayerId: String(layerId),
        groupId: String(groupId),
        error: err.message || String(err),
      },
    });
    return false;
  }
}

/* ── renameLayer (batchPlay only, NO modal) ── */
async function _renameLayer(layerId, newName) {
  await _action().batchPlay(
    [{ _obj: "select", _target: [{ _ref: "layer", _id: layerId }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }],
    { synchronousExecution: false, modalBehavior: "execute" },
  );
  await _action().batchPlay(
    [{ _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", name: newName }, _options: { dialogOptions: "dontDisplay" } }],
    { synchronousExecution: false, modalBehavior: "execute" },
  );
}

/* ═══════════════════════════════════════════════════════════════
 * PUBLIC API — wrap in single executeAsModal
 * ═══════════════════════════════════════════════════════════════ */

/* ── placeSmartObjectMaskedExact (P0-3: single modal wrapper) ── */
window.PO.placeSmartObjectMaskedExact = async function (imageB64, maskB64, bounds, workflowTitle) {
  var core = _photoshop().core;
  var placeStart = Date.now();
  var wfTitle = workflowTitle || "PixelOasis";
  var layerName = wfTitle + " - " + new Date().toLocaleString();

  return core.executeAsModal(
    async function () {
      var step = "";

      try {
        /* Step 1: Place the image */
        step = "place_image";
        window.PO.Logger.info("placement.step", { component: "placement", data: { step: step } });
        var resultLayer = await _placeImageViaTempFile(imageB64);
        var resultLayerId = resultLayer ? resultLayer.id : null;
        if (!resultLayerId) throw new Error("Failed to place image — no active layer.");

        /* Step 2: Convert to smart object (do this before scaling — conversion may change dimensions) */
        step = "convert_smart_object";
        var smartObjectOk = await _convertToSmartObject(resultLayerId);
        if (!smartObjectOk) {
          throw new Error("Failed to convert placed result into a smart object.");
        }

        /* After conversion, get the new layer ID (conversion may create a new layer) */
        var smartLayer = _app().activeDocument.activeLayer;
        var smartLayerId = smartLayer ? smartLayer.id : resultLayerId;
        var isSmartObject = false;
        try { isSmartObject = !!(smartLayer && smartLayer.kind === "smartObject"); } catch (_) {}
        if (!isSmartObject) {
          throw new Error("Placement requires a smart object result layer.");
        }

        /* Step 3: Fit layer to target bounds (scale + move, P0-20260708-4).
         * Throws on mismatch — placement cannot continue with a misaligned layer. */
        step = "fit_to_bounds";
        if (bounds) await _fitLayerToBounds(smartLayerId, bounds);

        /* Step 4: Apply soft mask (P1-5: works even without mask) */
        step = "apply_mask";
        if (maskB64) {
          await _applySoftMaskViaTempFile(maskB64, smartLayerId);
        }

        /* Step 5: Create/find group and move result layer into it (P0-4 fix) */
        step = "group_layer";
        var group = await _findOrCreateGroup("PixelOasis");
        if (group) {
          await _moveLayerIntoGroup(smartLayerId, group.id);
        }

        /* Step 6: Rename */
        step = "rename";
        await _renameLayer(smartLayerId, layerName);

        window.PO.Logger.info("placement.completed", {
          component: "placement",
          workflowId: wfTitle,
          durationMs: Date.now() - placeStart,
          data: {
            layerName: layerName,
            layerId: String(smartLayerId),
            hasMask: !!maskB64,
            isSmartObject: true,
          },
        });

        return { layerName: layerName, layerId: String(smartLayerId) };
      } catch (err) {
        window.PO.Logger.error("placement.step_failed", {
          component: "placement",
          data: { step: step, elapsedMs: Date.now() - placeStart, error: err.message || String(err) },
        });
        throw err;
      }
    },
    { commandName: "PixelOasis Smart Object Placement" },
  );
};

/* ── placeResultWithPolicy (dispatches by placementPolicy.type) ── */
window.PO.placeResultWithPolicy = async function (result, capture, workflow) {
  var rr = result && result.result;
  var placement = rr && rr.placement;
  var imageB64 = rr && (rr.imagePngBase64 || rr.imageBase64);
  if (!imageB64) throw new Error("No image data in result.");

  /* Resolve target bounds */
  var bounds = null;
  if (placement && placement.targetBounds) {
    bounds = placement.targetBounds;
  } else if (capture && capture.bounds) {
    bounds = capture.bounds;
  }

  /* Resolve mask (P1-5: placement may not have mask, that's OK) */
  var maskB64 = null;
  if (placement && placement.maskPngBase64) {
    maskB64 = placement.maskPngBase64;
  } else if (capture && capture.maskPngBase64) {
    maskB64 = capture.maskPngBase64;
  }

  var wfTitle = "PixelOasis";
  try { if (workflow && workflow.workflowId) wfTitle = workflow.workflowId; } catch (_) {}

  var type = placement ? placement.type : "smartObjectMaskedExact";

  switch (type) {
    case "smartObjectMaskedExact":
      return window.PO.placeSmartObjectMaskedExact(imageB64, maskB64, bounds, wfTitle);

    default:
      /* Delegated to legacy placeGeneratedLayer */
      return window.PO.placeGeneratedLayer(imageB64, maskB64, bounds, wfTitle);
  }
};

/* ── Backward-compatible aliases ── */
window.PO.ensureSmartObject = async function () {
  var layer = _app().activeDocument.activeLayer;
  if (!layer) return false;
  return _convertToSmartObject(layer.id);
};

window.PO.applyLayerMaskFromPng = async function (maskB64) {
  var layer = _app().activeDocument.activeLayer;
  if (!layer) return false;
  return _applySoftMaskViaTempFile(maskB64, layer.id);
};

window.PO.moveActiveLayerToBounds = async function (bounds) {
  return _moveLayerToBounds(bounds);
};

window.PO.createOrFindPixelOasisGroup = async function (name) {
  return _findOrCreateGroup(name);
};
