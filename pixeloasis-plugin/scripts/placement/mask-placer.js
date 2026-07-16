/* mask-placer.js — v2 artifact-specific mask placement
 *
 * Only applies a mask when placement.maskArtifactId is explicitly set.
 * Does NOT force original selection mask onto artifacts.
 *
 * Transparent RGBA artifacts (hair, smoke, particles) stay unmasked.
 *
 * Provides:
 *   applyArtifactMask(layerId, maskArtifactId, jobId) → boolean
 *   placeDiagnosticMask(maskArtifactId, jobId) → boolean
 */

window.PO = window.PO || {};

window.PO.MaskPlacer = (function () {
  "use strict";

  var _ps = null;
  function _photoshop() { if (!_ps) _ps = window.require("photoshop"); return _ps; }
  function _action() { return _photoshop().action; }
  function _app() { return _photoshop().app; }
  function _storage() { return window.require("uxp").storage; }

  /* ═══════════════════════════════════════════════════════════════════
   * applyArtifactMask(layerId, maskArtifactId, jobId) → boolean
   *
   * Called INSIDE the caller's executeAsModal.
   * Downloads happen BEFORE the modal (passed in as fileEntry).
   * ═══════════════════════════════════════════════════════════════════ */

  async function applyArtifactMask(layerId, maskFileEntry, jobId) {
    if (!layerId || !maskFileEntry) return false;

    window.PO.Logger && window.PO.Logger.info("mask.apply_started", {
      component: "mask-placer",
      data: { layerId: String(layerId), jobId: jobId },
    });

    try {
      /* ── Select target layer ── */
      await _action().batchPlay(
        [{ _obj: "select", _target: [{ _ref: "layer", _id: layerId }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }],
        { synchronousExecution: false, modalBehavior: "execute" },
      );

      /* ── Place mask PNG ── */
      var token = _storage().localFileSystem.createSessionToken(maskFileEntry);

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
      } catch (_) {
        var uri = "file:///" + maskFileEntry.nativePath.replace(/\\/g, "/");
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
      }

      /* ── Load red channel as selection from placed mask layer ── */
      await _action().batchPlay(
        [{ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _ref: "channel", _enum: "channel", _value: "red" }, _options: { dialogOptions: "dontDisplay" } }],
        { synchronousExecution: false, modalBehavior: "execute" },
      );

      /* ── Delete the temporary mask layer ── */
      await _action().batchPlay(
        [{ _obj: "delete", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], _options: { dialogOptions: "dontDisplay" } }],
        { synchronousExecution: false, modalBehavior: "execute" },
      );

      /* ── Reselect target layer ── */
      await _action().batchPlay(
        [{ _obj: "select", _target: [{ _ref: "layer", _id: layerId }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }],
        { synchronousExecution: false, modalBehavior: "execute" },
      );

      /* ── Create layer mask from selection ── */
      await _action().batchPlay(
        [{ _obj: "make", new: { _class: "channel" }, at: { _ref: "channel", _enum: "channel", _value: "mask" }, using: { _enum: "userMaskEnabled", _value: "revealSelection" }, _options: { dialogOptions: "dontDisplay" } }],
        { synchronousExecution: false, modalBehavior: "execute" },
      );

      window.PO.Logger && window.PO.Logger.info("mask.applied", {
        component: "mask-placer",
        data: { layerId: String(layerId), jobId: jobId },
      });

      return true;
    } catch (e) {
      window.PO.Logger && window.PO.Logger.error("mask.apply_failed", {
        component: "mask-placer",
        error: e,
        data: { layerId: String(layerId), jobId: jobId },
      });
      throw e; /* Throw to trigger rollback */
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * placeDiagnosticMask(maskFileEntry, diagnosticName) → boolean
   *
   * Places mask as a hidden layer for diagnostic purposes.
   * Does not affect visual result.
   * ═══════════════════════════════════════════════════════════════════ */

  async function placeDiagnosticMask(maskFileEntry, diagnosticName) {
    if (!maskFileEntry) return false;

    try {
      var token = _storage().localFileSystem.createSessionToken(maskFileEntry);

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

      /* Rename */
      var diagName = "[诊断] " + (diagnosticName || "mask");
      await _action().batchPlay(
        [{ _obj: "set", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _obj: "layer", name: diagName }, _options: { dialogOptions: "dontDisplay" } }],
        { synchronousExecution: false, modalBehavior: "execute" },
      );

      /* Hide it */
      await _action().batchPlay(
        [{ _obj: "hide", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], _options: { dialogOptions: "dontDisplay" } }],
        { synchronousExecution: false, modalBehavior: "execute" },
      );

      return true;
    } catch (e) {
      window.PO.Logger && window.PO.Logger.warn("mask.diagnostic_failed", {
        component: "mask-placer",
        error: e,
      });
      return false; /* Diagnostic failure is non-fatal */
    }
  }

  return {
    applyArtifactMask:   applyArtifactMask,
    placeDiagnosticMask: placeDiagnosticMask,
  };
})();
