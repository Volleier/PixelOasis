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

      for (var ai = 0; ai < artifacts.length; ai++) {
        var art = artifacts[ai];
        var artRow = document.createElement("div");
        artRow.className = "po-result-artifact";
        artRow.textContent = (art.placement && art.placement.layerName) || art.role || ("图层 " + (ai + 1));
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

    /* Place button (P2: disabled — placement is P3) */
    var placeBtn = document.createElement("button");
    placeBtn.className = "po-button po-button--primary";
    placeBtn.type = "button";
    placeBtn.textContent = "回填到当前文档";
    placeBtn.disabled = true;
    placeBtn.title = "图层回填将在下一阶段（P3）接入";
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
