/* progress-panel.js — v2 job progress display
 *
 * Shows active job progress inline below the favorites area.
 * Handles multiple concurrent jobs in a list.
 * NO raw prompt display.
 *
 * Provides:
 *   show() — show the progress panel
 *   update(jobId, state, progress) — update a job's display
 *   hide() — dismiss
 */

window.PO = window.PO || {};

window.PO.ProgressPanel = (function () {
  "use strict";

  var _container = null;
  var _jobEls = {};  /* { jobId → HTMLElement } */

  /* ── State labels ── */
  var STATE_LABELS = {
    queued:          "排队中",
    preparing:       "准备中",
    running:         "生成中",
    postprocessing:  "后处理中",
    succeeded:       "已完成",
    failed:          "失败",
    canceled:        "已取消",
  };

  /* ═══════════════════════════════════════════════════════════════════
   * show()
   * ═══════════════════════════════════════════════════════════════════ */

  function show() {
    if (_container) return; /* Already visible */

    var mainScroll = document.querySelector(".po-main-scroll");
    if (!mainScroll) return;

    _container = document.createElement("div");
    _container.className = "po-progress-panel";
    _container.setAttribute("role", "region");
    _container.setAttribute("aria-label", "任务进度");

    mainScroll.insertBefore(_container, mainScroll.firstChild);

    /* Render existing active jobs */
    var activeJobs = window.PO.JobStore.listActive();
    for (var i = 0; i < activeJobs.length; i++) {
      _renderJob(activeJobs[i]);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * update(jobId, state, progress)
   * ═══════════════════════════════════════════════════════════════════ */

  function update(jobId, state, progress) {
    if (!_container) show();

    var job = window.PO.JobStore.get(jobId);
    if (!job) return;

    var el = _jobEls[jobId];
    if (!el) {
      el = _renderJob(job);
    }

    /* Update state badge */
    var badge = el.querySelector(".po-progress-state");
    if (badge && state) {
      badge.textContent = STATE_LABELS[state] || state;
      badge.className = "po-progress-state po-progress-state--" + state;
    }

    /* Update progress bar */
    var bar = el.querySelector(".po-progress-bar__fill");
    if (bar && typeof progress === "number") {
      bar.style.width = Math.min(100, Math.max(0, progress)) + "%";
    }

    /* Update progress text */
    var text = el.querySelector(".po-progress-text");
    if (text) {
      var pct = typeof progress === "number" ? Math.round(progress) : 0;
      text.textContent = (STATE_LABELS[state] || state || "") + " — " + pct + "%";
    }

    /* Terminal states: fade out after delay */
    if (state === "succeeded" || state === "failed" || state === "canceled") {
      setTimeout(function () {
        if (el && el.parentNode) {
          el.style.opacity = "0.5";
        }
      }, 3000);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * hide()
   * ═══════════════════════════════════════════════════════════════════ */

  function hide() {
    if (_container && _container.parentNode) {
      _container.parentNode.removeChild(_container);
    }
    _container = null;
    _jobEls = {};
  }

  /* ── Render a single job entry ── */
  function _renderJob(job) {
    if (!_container) return null;

    var el = document.createElement("div");
    el.className = "po-progress-job";
    el.setAttribute("data-job-id", job.jobId);

    /* Header row */
    var header = document.createElement("div");
    header.className = "po-progress-job__header";

    var title = document.createElement("span");
    title.className = "po-progress-job__title";
    title.textContent = job.capabilityTitle || job.capabilityId || "未知任务";
    header.appendChild(title);

    var state = document.createElement("span");
    state.className = "po-progress-state po-progress-state--" + (job.state || "queued");
    state.textContent = STATE_LABELS[job.state] || job.state || "排队中";
    header.appendChild(state);

    el.appendChild(header);

    /* Progress bar */
    var barContainer = document.createElement("div");
    barContainer.className = "po-progress-bar";

    var barFill = document.createElement("div");
    barFill.className = "po-progress-bar__fill";
    barFill.style.width = (typeof job.progress === "number" ? job.progress : 0) + "%";
    barContainer.appendChild(barFill);

    el.appendChild(barContainer);

    /* Progress text */
    var text = document.createElement("div");
    text.className = "po-progress-text";
    var pct = typeof job.progress === "number" ? Math.round(job.progress) : 0;
    text.textContent = (STATE_LABELS[job.state] || "") + " — " + pct + "%";
    el.appendChild(text);

    /* Cancel button */
    var cancelBtn = document.createElement("button");
    cancelBtn.className = "po-progress-cancel";
    cancelBtn.type = "button";
    cancelBtn.textContent = "取消";
    cancelBtn.setAttribute("aria-label", "取消任务");
    cancelBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (window.PO.JobController) {
        window.PO.JobController.cancel(job.jobId);
      }
    });
    el.appendChild(cancelBtn);

    _jobEls[job.jobId] = el;
    _container.appendChild(el);

    return el;
  }

  return {
    show:   show,
    update: update,
    hide:   hide,
  };
})();
