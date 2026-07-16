/* result-panel.js — v2 job result display
 *
 * Shows completed job results: artifact count, seed, duration, warnings.
 * In P2: "回填到当前文档" is shown but DISABLED (placement is P3).
 *
 * Provides:
 *   show(jobId, result) — display success result
 *   showError(jobId, error) — display error result
 *   hide() — dismiss
 */

window.PO = window.PO || {};

window.PO.ResultPanel = (function () {
  "use strict";

  var _container = null;

  /* ═══════════════════════════════════════════════════════════════════
   * show(jobId, result)
   * ═══════════════════════════════════════════════════════════════════ */

  function show(jobId, result) {
    hide();

    var job = window.PO.JobStore.get(jobId);
    if (!job) return;

    var mainScroll = document.querySelector(".po-main-scroll");
    if (!mainScroll) return;

    _container = document.createElement("div");
    _container.className = "po-result-panel";
    _container.setAttribute("role", "region");
    _container.setAttribute("aria-label", "任务结果");

    /* ── Header ── */
    var header = document.createElement("div");
    header.className = "po-result-header";

    var icon = document.createElement("span");
    icon.className = "po-result-icon";
    icon.textContent = "✓";
    header.appendChild(icon);

    var title = document.createElement("span");
    title.className = "po-result-title";
    title.textContent = "任务完成 — " + (job.capabilityTitle || job.capabilityId);
    header.appendChild(title);

    _container.appendChild(header);

    /* ── Artifact list ── */
    var artifacts = result.artifacts || [];
    if (artifacts.length > 0) {
      var artSection = document.createElement("div");
      artSection.className = "po-result-section";

      var artLabel = document.createElement("div");
      artLabel.className = "po-result-label";
      artLabel.textContent = "生成结果：" + artifacts.length + " 个图层";
      artSection.appendChild(artLabel);

      var ROLE_ZH = { background: "背景层", foreground: "前景层", subject: "主体层", result: "结果层", rimLight: "轮廓光", ambientHaze: "环境雾", glow: "辉光", lightning: "雷电", sparks: "火花", debris: "碎石", smoke: "烟雾", dust: "粉尘", backlight: "逆光", relitSubject: "重照主体", haze: "空气透视", contactShadow: "接触阴影", backdrop: "棚背景", subjectCutout: "主体抠图", colorBlend: "色彩融合", cleanupPatch: "清理修补", backgroundGrade: "背景调色", compositePreview: "合成预览", hairBody: "发型主体", hairEdges: "发丝边缘", hairStrands: "发丝", flowingHair: "飘发", flyawayStrands: "碎发", skinRepaint: "皮肤重绘", eyeEffect: "眼睛效果", faceRepaint: "面部重绘", bodyEdit: "身体编辑", garmentRepair: "服装修复", supportRemoval: "移除结果", removedMask: "移除蒙版", gearRemoval: "器材移除", environmentSpill: "环境溢光", subjectUnderlight: "主体底光", lightingEnhancement: "光影增强", dimensionalRender: "立体化渲染", lightShade: "明暗增强", cleanupComposite: "清场合成", waterHighlights: "水面波光", sparkleGlow: "闪烁辉光", farDust: "远景沙尘", nearDebris: "近景碎石", desertBackground: "沙漠背景", backTrails: "后景弹道", frontTrails: "前景弹道", impactSparks: "撞击火花", environmentReflection: "环境反射", longHair: "长发", doll01: "玩偶1", doll02: "玩偶2", doll03: "玩偶3", doll04: "玩偶4", doll05: "玩偶5" };
      for (var ai = 0; ai < artifacts.length; ai++) {
        var art = artifacts[ai];
        var artRow = document.createElement("div");
        artRow.className = "po-result-artifact";
        var roleLabel = ROLE_ZH[art.role] || art.role || ("图层 " + (ai + 1));
        artRow.textContent = "• " + roleLabel;
        artSection.appendChild(artRow);
      }

      _container.appendChild(artSection);
    }

    /* ── Metrics ── */
    var metrics = result.metrics || {};
    if (metrics.durationMs || metrics.seed || metrics.profile) {
      var metSection = document.createElement("div");
      metSection.className = "po-result-section";

      if (metrics.durationMs) {
        var dur = document.createElement("div");
        dur.className = "po-result-metric";
        dur.textContent = "耗时：" + (metrics.durationMs / 1000).toFixed(1) + " 秒";
        metSection.appendChild(dur);
      }

      if (metrics.seed !== undefined) {
        var seed = document.createElement("div");
        seed.className = "po-result-metric";
        seed.textContent = "Seed：" + metrics.seed;
        metSection.appendChild(seed);
      }

      if (metrics.profile) {
        var prof = document.createElement("div");
        prof.className = "po-result-metric";
        prof.textContent = "配置档：" + metrics.profile;
        metSection.appendChild(prof);
      }

      _container.appendChild(metSection);
    }

    /* ── Warnings ── */
    var warnings = result.warnings || [];
    if (warnings.length > 0) {
      var warnSection = document.createElement("div");
      warnSection.className = "po-result-warnings";
      for (var wi = 0; wi < warnings.length; wi++) {
        var warn = document.createElement("div");
        warn.textContent = "⚠ " + (warnings[wi].message || warnings[wi]);
        warnSection.appendChild(warn);
      }
      _container.appendChild(warnSection);
    }

    /* ── Mock indicator ── */
    if (result._mock) {
      var mockBadge = document.createElement("div");
      mockBadge.className = "po-result-mock-badge";
      mockBadge.textContent = "Mock 结果 — 网关不可用时使用模拟数据";
      _container.appendChild(mockBadge);
    }

    /* ── Actions ── */
    var actions = document.createElement("div");
    actions.className = "po-result-actions";

    /* Check if job already placed in this document */
    var alreadyPlaced = window.PO.LayerMetadata && window.PO.LayerMetadata.checkJobAlreadyPlaced(jobId);

    /* Place button */
    var placeBtn = document.createElement("button");
    placeBtn.className = "po-button po-button--primary";
    placeBtn.type = "button";

    if (alreadyPlaced || (job.placementPlaced)) {
      placeBtn.textContent = "✓ 已回填";
      placeBtn.disabled = true;
      placeBtn.title = "此任务结果已回填到当前文档";
    } else {
      placeBtn.textContent = "回填到当前文档";
      placeBtn.disabled = false;
      placeBtn.title = "";

      /* Check document match */
      var docInfo = window.PO.CaptureUtils.getDocumentInfo();
      if (docInfo && job.documentId && String(docInfo.id) !== String(job.documentId)) {
        placeBtn.textContent = "回填到当前文档（文档已变更）";
        placeBtn.disabled = true;
        placeBtn.title = "当前文档与生成时的文档不匹配，结果可能位置不对";
      }

      if (!placeBtn.disabled) {
        placeBtn.addEventListener("click", async function () {
          placeBtn.textContent = "回填中…";
          placeBtn.disabled = true;

          try {
            var photoshop = window.require("photoshop");
            var doc = photoshop.app.activeDocument;
            if (!doc) throw new Error("无活动文档");

            await window.PO.ResultGroup.placeJobArtifacts(job, doc);

            placeBtn.textContent = "✓ 已回填";
            placeBtn.disabled = true;
          } catch (err) {
            placeBtn.textContent = "回填失败，点击重试";
            placeBtn.disabled = false;
            window.PO.showTransientStatus &&
              window.PO.showTransientStatus("回填失败：" + (err.userMessage || err.message || ""));
          }
        });
      }
    }
    actions.appendChild(placeBtn);

    /* Dismiss button */
    var dismissBtn = document.createElement("button");
    dismissBtn.className = "po-button po-button--secondary";
    dismissBtn.type = "button";
    dismissBtn.textContent = "放弃结果";
    dismissBtn.addEventListener("click", function () {
      window.PO.JobStore.remove(jobId);
      hide();
    });
    actions.appendChild(dismissBtn);

    _container.appendChild(actions);

    mainScroll.insertBefore(_container, mainScroll.firstChild);

    /* Log */
    window.PO.Logger && window.PO.Logger.info("result.displayed", {
      component: "result-panel",
      data: {
        jobId: jobId,
        artifactCount: artifacts.length,
        mock: result._mock || false,
      },
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
   * showError(jobId, error)
   * ═══════════════════════════════════════════════════════════════════ */

  function showError(jobId, error) {
    hide();

    var job = window.PO.JobStore.get(jobId);
    var mainScroll = document.querySelector(".po-main-scroll");
    if (!mainScroll) return;

    _container = document.createElement("div");
    _container.className = "po-result-panel po-result-panel--error";

    var header = document.createElement("div");
    header.className = "po-result-header";

    var icon = document.createElement("span");
    icon.className = "po-result-icon po-result-icon--error";
    icon.textContent = "✗";
    header.appendChild(icon);

    var title = document.createElement("span");
    title.className = "po-result-title";
    title.textContent = "任务失败 — " + (job ? (job.capabilityTitle || job.capabilityId) : jobId);
    header.appendChild(title);
    _container.appendChild(header);

    var errMsg = document.createElement("div");
    errMsg.className = "po-result-error";
    errMsg.textContent = (error && (error.userMessage || error.message)) || "未知错误";
    _container.appendChild(errMsg);

    if (error && error.code) {
      var errCode = document.createElement("div");
      errCode.className = "po-result-error-code";
      errCode.textContent = "错误码：" + error.code;
      _container.appendChild(errCode);
    }

    var dismissBtn = document.createElement("button");
    dismissBtn.className = "po-button po-button--secondary";
    dismissBtn.type = "button";
    dismissBtn.textContent = "关闭";
    dismissBtn.style.cssText = "margin-top:8px;width:100%;";
    dismissBtn.addEventListener("click", function () { hide(); });
    _container.appendChild(dismissBtn);

    mainScroll.insertBefore(_container, mainScroll.firstChild);
  }

  /* ═══════════════════════════════════════════════════════════════════
   * hide()
   * ═══════════════════════════════════════════════════════════════════ */

  function hide() {
    if (_container && _container.parentNode) {
      _container.parentNode.removeChild(_container);
    }
    _container = null;
  }

  return {
    show:      show,
    showError: showError,
    hide:      hide,
  };
})();
