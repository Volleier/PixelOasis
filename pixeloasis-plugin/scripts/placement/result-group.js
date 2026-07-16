/* result-group.js — v2 transactional multi-artifact placement
 *
 * Download happens OUTSIDE executeAsModal.
 * ALL Photoshop operations happen inside ONE executeAsModal.
 * Any failure → delete entire group (rollback).
 *
 * Provides:
 *   placeJobArtifacts(job, currentDocument) → boolean
 */

window.PO = window.PO || {};

window.PO.ResultGroup = (function () {
  "use strict";

  var _ps = null;
  function _photoshop() { if (!_ps) _ps = window.require("photoshop"); return _ps; }
  function _action() { return _photoshop().action; }
  function _app() { return _photoshop().app; }
  function _core() { return _photoshop().core; }

  /* ═══════════════════════════════════════════════════════════════════
   * placeJobArtifacts(job, currentDocument) → boolean
   * ═══════════════════════════════════════════════════════════════════ */

  async function placeJobArtifacts(job, currentDocument) {
    if (!job || !job.jobId) throw new Error("无效的任务");
    if (!currentDocument) throw new Error("无活动文档");

    var jobId = job.jobId;
    var artifacts = (job.result && job.result.artifacts) || [];
    var rollbackGroupId = null;
    var rollbackLayerIds = [];

    if (artifacts.length === 0) {
      throw new Error("此任务没有可回填的结果");
    }

    /* ── Pre-flight 1: Check if already placed ── */
    if (window.PO.LayerMetadata.checkJobAlreadyPlaced(jobId)) {
      window.PO.showTransientStatus &&
        window.PO.showTransientStatus("此任务结果已回填到当前文档");
      window.PO.Logger && window.PO.Logger.info("result_group.already_placed", {
        component: "result-group",
        data: { jobId: jobId },
      });
      return false;
    }

    window.PO.setStatus && window.PO.setStatus("正在下载结果…");
    window.PO.Logger && window.PO.Logger.info("result_group.placement_started", {
      component: "result-group",
      data: { jobId: jobId, artifactCount: artifacts.length },
    });

    /* ── Pre-flight 2: Download all artifacts (OUTSIDE modal) ── */
    var downloaded;
    try {
      downloaded = await window.PO.ArtifactDownloader.downloadAllArtifacts(artifacts, jobId);
    } catch (e) {
      window.PO.Logger && window.PO.Logger.error("result_group.download_failed", {
        component: "result-group",
        error: e,
        data: { jobId: jobId },
      });
      window.PO.setStatus && window.PO.setStatus("下载结果失败");
      throw new Error("下载失败：" + (e.message || ""));
    }

    var capabilityTitle = job.capabilityTitle || job.capabilityId || "Result";
    var jobIdShort = jobId.length > 8 ? jobId.substring(0, 8) : jobId;
    var groupName = "PixelOasis / " + capabilityTitle + " / " + jobIdShort;

    window.PO.setStatus && window.PO.setStatus("正在回填结果…");

    /* ── Single executeAsModal transaction ── */
    try {
      await _core().executeAsModal(async function () {
        var doc = _app().activeDocument;
        if (!doc) throw new Error("文档已关闭");

        /* ── Create/find group ── */
        var groupInfo = await _findOrCreateGroup(groupName);
        var group = groupInfo.group;
        if (!group) throw new Error("无法创建图层组");
        if (groupInfo.created) rollbackGroupId = group.id;

        /* ── Sort by placement.order ── */
        downloaded.sort(function (a, b) {
          var oa = (a.artifact.placement && a.artifact.placement.order) || 999;
          var ob = (b.artifact.placement && b.artifact.placement.order) || 999;
          return oa - ob;
        });

        var placedLayers = [];
        var groupId = group.id;

        /* ── Place each artifact ── */
        for (var i = 0; i < downloaded.length; i++) {
          var item = downloaded[i];
          var placement = item.artifact.placement;

          if (!placement) {
            throw new Error("Artifact #" + (i + 1) + " 缺少 placement 信息");
          }

          /* Place artifact layer */
          var result = await window.PO.ArtifactPlacer.placeArtifact(
            item.fileEntry.fileEntry, placement
          );
          placedLayers.push({ layerId: result.layerId, artifact: item.artifact });
          rollbackLayerIds.push(result.layerId);

          /* Move into group */
          await _moveLayerIntoGroup(result.layerId, groupId);

          /* Apply artifact mask if specified */
          if (placement.maskArtifactId && item.maskFileEntry) {
            await window.PO.MaskPlacer.applyArtifactMask(
              result.layerId, item.maskFileEntry.fileEntry, jobId
            );
          }

          /* Write metadata */
          await window.PO.LayerMetadata.writeLayerMetadata(
            { id: result.layerId }, {
              jobId: jobId,
              artifactId: item.artifact.id,
              capabilityId: job.capabilityId,
              seed: (job.result && job.result.metrics && job.result.metrics.seed) || null,
            }
          );
        }

        window.PO.Logger && window.PO.Logger.info("result_group.placed_all", {
          component: "result-group",
          data: {
            jobId: jobId,
            groupName: groupName,
            layerCount: placedLayers.length,
          },
        });

      }, { commandName: "PixelOasis Place Job Artifacts (" + jobIdShort + ")" });

      /* ── Post-placement ── */
      window.PO.JobStore.markPlaced(jobId);
      await window.PO.ArtifactDownloader.cleanupJobFiles(jobId);

      window.PO.setStatus && window.PO.setStatus("回填完成 — " + artifacts.length + " 个图层");
      window.PO.showTransientStatus &&
        window.PO.showTransientStatus("回填完成：" + artifacts.length + " 个图层已置入");

      window.PO.Logger && window.PO.Logger.info("result_group.completed", {
        component: "result-group",
        data: { jobId: jobId, layerCount: artifacts.length },
      });

      return true;

    } catch (e) {
      await _rollbackPlacement(rollbackGroupId, rollbackLayerIds);
      await window.PO.ArtifactDownloader.cleanupJobFiles(jobId);

      window.PO.Logger && window.PO.Logger.error("result_group.placement_failed", {
        component: "result-group",
        error: e,
        data: { jobId: jobId, groupName: groupName },
      });

      window.PO.setStatus && window.PO.setStatus("回填失败：" + (e.message || "未知错误"));
      throw new Error("回填失败：" + (e.message || ""));
    }
  }

  /* ── Find or create group ── */
  async function _findOrCreateGroup(groupName) {
    var doc = _app().activeDocument;
    if (!doc) return null;

    /* Search for existing group */
    var layers = doc.layers;
    for (var i = 0; i < layers.length; i++) {
      try {
        if (layers[i].name === groupName && layers[i].kind === "group") {
          return { group: layers[i], created: false };
        }
      } catch (_) {}
    }

    /* Create new group */
    await _action().batchPlay(
      [{ _obj: "make", new: { _class: "layerSection" }, from: { _obj: "layerSection", name: groupName }, _options: { dialogOptions: "dontDisplay" } }],
      { synchronousExecution: false, modalBehavior: "execute" },
    );

    return { group: _app().activeDocument.activeLayer, created: true };
  }

  async function _rollbackPlacement(groupId, layerIds) {
    if ((!groupId && (!layerIds || layerIds.length === 0)) || !_app().activeDocument) return;
    try {
      await _core().executeAsModal(async function () {
        if (groupId) {
          await _action().batchPlay(
            [{ _obj: "delete", _target: [{ _ref: "layer", _id: groupId }], _options: { dialogOptions: "dontDisplay" } }],
            { synchronousExecution: false, modalBehavior: "execute" }
          );
          return;
        }
        for (var index = layerIds.length - 1; index >= 0; index--) {
          await _action().batchPlay(
            [{ _obj: "delete", _target: [{ _ref: "layer", _id: layerIds[index] }], _options: { dialogOptions: "dontDisplay" } }],
            { synchronousExecution: false, modalBehavior: "execute" }
          );
        }
      }, { commandName: "PixelOasis Roll Back Failed Placement" });
    } catch (rollbackError) {
      window.PO.Logger && window.PO.Logger.error("result_group.rollback_failed", {
        component: "result-group",
        error: rollbackError,
        data: { groupId: groupId, layerCount: layerIds.length },
      });
    }
  }

  /* ── Move layer into group ── */
  async function _moveLayerIntoGroup(layerId, groupId) {
    if (!layerId || !groupId) return;
    await _action().batchPlay(
      [{ _obj: "move", _target: [{ _ref: "layer", _id: layerId }], to: { _ref: "layer", _id: groupId }, _options: { dialogOptions: "dontDisplay" } }],
      { synchronousExecution: false, modalBehavior: "execute" },
    );
  }

  return {
    placeJobArtifacts: placeJobArtifacts,
  };
})();
