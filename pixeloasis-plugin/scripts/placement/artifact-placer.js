/* artifact-placer.js — v2 single artifact placement
 *
 * Extracts proven batchPlay patterns from placement-engine.js.
 * All batchPlay calls run inside the caller's executeAsModal.
 * Does NOT wrap itself in a modal.
 *
 * Validates placement fields before any Photoshop operations:
 *   bounds (no NaN/negative), blendMode (allowlist), layerName, groupName
 *
 * Provides:
 *   placeArtifact(localFile, placement) → { layerId, layerName }
 *   validatePlacement(placement) → { valid, errors }
 */

window.PO = window.PO || {};

window.PO.ArtifactPlacer = (function () {
  "use strict";

  /* ── Blend mode allowlist ── */
  var BLEND_MODES = {
    normal:       "normal",
    multiply:     "multiply",
    screen:       "screen",
    overlay:      "overlay",
    softLight:    "softLight",
    darken:       "darken",
    lighten:      "lighten",
    colorDodge:   "colorDodge",
    colorBurn:    "colorBurn",
    hardLight:    "hardLight",
    difference:   "difference",
    exclusion:    "exclusion",
    hue:          "hue",
    saturation:   "saturation",
    color:        "color",
    luminosity:   "luminosity",
  };

  /* ── Lazy Photoshop references ── */
  var _ps = null;
  function _photoshop() { if (!_ps) _ps = window.require("photoshop"); return _ps; }
  function _action() { return _photoshop().action; }
  function _app() { return _photoshop().app; }
  function _storage() { return window.require("uxp").storage; }

  /* ═══════════════════════════════════════════════════════════════════
   * validatePlacement(placement) → { valid, errors[] }
   * ═══════════════════════════════════════════════════════════════════ */

  function validatePlacement(placement) {
    var errors = [];
    if (!placement) return { valid: false, errors: ["placement is null"] };

    /* bounds */
    var b = placement.bounds;
    if (!b) {
      errors.push("缺少 bounds");
    } else {
      if (typeof b.left !== "number" || isNaN(b.left) || b.left < 0) errors.push("bounds.left 无效");
      if (typeof b.top !== "number" || isNaN(b.top) || b.top < 0) errors.push("bounds.top 无效");
      if (typeof b.width !== "number" || isNaN(b.width) || b.width <= 0) errors.push("bounds.width 无效");
      if (typeof b.height !== "number" || isNaN(b.height) || b.height <= 0) errors.push("bounds.height 无效");
    }

    /* blendMode */
    if (placement.blendMode && !BLEND_MODES[placement.blendMode]) {
      /* Not in allowlist — will fallback to normal */
    }

    /* order */
    if (typeof placement.order !== "number" || isNaN(placement.order)) {
      errors.push("order 无效");
    }

    /* layerName */
    if (!placement.layerName || typeof placement.layerName !== "string") {
      errors.push("缺少 layerName");
    }

    /* groupName */
    if (!placement.groupName || typeof placement.groupName !== "string") {
      errors.push("缺少 groupName");
    }

    /* opacity */
    if (placement.opacity !== undefined && placement.opacity !== null) {
      if (typeof placement.opacity !== "number" || isNaN(placement.opacity) || placement.opacity < 0 || placement.opacity > 100) {
        errors.push("opacity 超出范围 (0-100)");
      }
    }

    return { valid: errors.length === 0, errors: errors };
  }

  /* ═══════════════════════════════════════════════════════════════════
   * placeArtifact(fileEntry, placement) → { layerId, layerName }
   *
   * Called INSIDE caller's executeAsModal.
   * ═══════════════════════════════════════════════════════════════════ */

  async function placeArtifact(fileEntry, placement) {
    /* Validate */
    var validation = validatePlacement(placement);
    if (!validation.valid) {
      throw new Error("Placement 校验失败：" + validation.errors.join("; "));
    }

    /* Resolve blend mode */
    var blendMode = placement.blendMode || "normal";
    if (!BLEND_MODES[blendMode]) {
      window.PO.Logger && window.PO.Logger.warn("placement.unknown_blend_mode", {
        component: "artifact-placer",
        data: { blendMode: blendMode, fallback: "normal" },
      });
      blendMode = "normal";
    }

    var doc = _app().activeDocument;
    if (!doc) throw new Error("无活动文档");

    /* ── 1. Place PNG from temp file ── */
    var token = _storage().localFileSystem.createSessionToken(fileEntry);
    var layer;

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
      layer = doc.activeLayer;
    } catch (_) {
      /* Fallback: file URI */
      var uri = "file:///" + fileEntry.nativePath.replace(/\\/g, "/");
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
      layer = doc.activeLayer;
    }

    if (!layer) throw new Error("置入图层失败");

    var layerId = layer.id;

    /* ── 2. Convert to smart object ── */
    if (placement.createSmartObject) {
      var converted = await _convertToSmartObject(layerId);
      if (!converted) {
        window.PO.Logger && window.PO.Logger.warn("placement.smart_object_failed", {
          component: "artifact-placer",
        });
      }
      /* Refresh layer reference */
      layer = doc.activeLayer;
      if (layer) layerId = layer.id;
    }

    /* ── 3. Scale + move to bounds ── */
    await _fitLayerToBounds(layerId, placement.bounds);
    layer = doc.activeLayer;

    /* ── 4. Set blend mode ── */
    if (layer && blendMode !== "normal") {
      await _setBlendMode(layerId, blendMode);
    }

    /* ── 5. Set opacity ── */
    if (layer && typeof placement.opacity === "number" && placement.opacity < 100) {
      await _setOpacity(layerId, placement.opacity);
    }

    /* ── 6. Rename layer ── */
    await _renameLayer(layerId, placement.layerName);

    window.PO.Logger && window.PO.Logger.info("placement.artifact_placed", {
      component: "artifact-placer",
      data: {
        layerName: placement.layerName,
        bounds: placement.bounds.width + "x" + placement.bounds.height,
        blendMode: blendMode,
        smartObject: !!placement.createSmartObject,
      },
    });

    return { layerId: layerId, layerName: placement.layerName };
  }

  /* ── Convert to smart object (batchPlay only) ── */
  async function _convertToSmartObject(layerId) {
    var layer = _app().activeDocument.activeLayer;
    if (!layer) return false;

    await _action().batchPlay(
      [{ _obj: "select", _target: [{ _ref: "layer", _id: layerId }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }],
      { synchronousExecution: false, modalBehavior: "execute" },
    );

    var isSmart = false;
    try { isSmart = _app().activeDocument.activeLayer.kind === "smartObject"; } catch (_) {}
    if (isSmart) return true;

    try {
      await _action().batchPlay(
        [{ _obj: "newPlacedLayer", _options: { dialogOptions: "dontDisplay" } }],
        { synchronousExecution: false, modalBehavior: "execute" },
      );
    } catch (_) {
      try {
        await _action().batchPlay(
          [{ _obj: "groupEvent", _options: { dialogOptions: "dontDisplay" } }],
          { synchronousExecution: false, modalBehavior: "execute" },
        );
        await _action().batchPlay(
          [{ _obj: "newPlacedLayer", _options: { dialogOptions: "dontDisplay" } }],
          { synchronousExecution: false, modalBehavior: "execute" },
        );
      } catch (_2) { return false; }
    }
    return true;
  }

  /* ── Scale + move layer to exact bounds (tolerance ≤2px) ── */
  async function _fitLayerToBounds(layerId, targetBounds) {
    await _action().batchPlay(
      [{ _obj: "select", _target: [{ _ref: "layer", _id: layerId }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }],
      { synchronousExecution: false, modalBehavior: "execute" },
    );

    var doc = _app().activeDocument;
    var layer = doc.activeLayer;
    if (!layer) throw new Error("无法选择图层");

    var bounds = layer.bounds;
    var curL = window.PO.normalizeNumber(bounds.left);
    var curT = window.PO.normalizeNumber(bounds.top);
    var curR = window.PO.normalizeNumber(bounds.right);
    var curB = window.PO.normalizeNumber(bounds.bottom);
    var tgtL = targetBounds.left, tgtT = targetBounds.top;
    var tgtW = targetBounds.width, tgtH = targetBounds.height;

    if (curL === null || curT === null || curR === null || curB === null) {
      throw new Error("无法获取图层边界");
    }

    var curW = curR - curL, curH = curB - curT;
    var tolerance = 2;

    /* Scale if needed */
    if (Math.abs(curW - tgtW) > tolerance || Math.abs(curH - tgtH) > tolerance) {
      var scaleX = (tgtW / curW) * 100;
      var scaleY = (tgtH / curH) * 100;

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

      /* Re-read bounds */
      layer = doc.activeLayer;
      if (layer && layer.bounds) {
        curL = window.PO.normalizeNumber(layer.bounds.left);
        curT = window.PO.normalizeNumber(layer.bounds.top);
      }
    }

    /* Move to target position */
    if (curL !== null && curT !== null) {
      var dx = tgtL - curL, dy = tgtT - curT;
      if (isFinite(dx) && isFinite(dy) && (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)) {
        await _action().batchPlay(
          [{ _obj: "move", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "offset", horizontal: { _unit: "pixelsUnit", _value: dx }, vertical: { _unit: "pixelsUnit", _value: dy } }, _options: { dialogOptions: "dontDisplay" } }],
          { synchronousExecution: false, modalBehavior: "execute" },
        );
      }
    }
  }

  /* ── Set blend mode ── */
  async function _setBlendMode(layerId, mode) {
    await _action().batchPlay(
      [{ _obj: "set", _target: [{ _ref: "layer", _id: layerId }], to: { _obj: "layer", mode: { _enum: "blendMode", _value: mode } }, _options: { dialogOptions: "dontDisplay" } }],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  /* ── Set opacity ── */
  async function _setOpacity(layerId, opacity) {
    await _action().batchPlay(
      [{ _obj: "set", _target: [{ _ref: "layer", _id: layerId }], to: { _obj: "layer", opacity: { _unit: "percentUnit", _value: opacity } }, _options: { dialogOptions: "dontDisplay" } }],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  /* ── Rename layer ── */
  async function _renameLayer(layerId, newName) {
    await _action().batchPlay(
      [{ _obj: "set", _target: [{ _ref: "layer", _id: layerId }], to: { _obj: "layer", name: newName }, _options: { dialogOptions: "dontDisplay" } }],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  return {
    placeArtifact:     placeArtifact,
    validatePlacement: validatePlacement,
  };
})();
