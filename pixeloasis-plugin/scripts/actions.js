window.PO = window.PO || {};

/* actions.js — v2 event delegation and v1 backward-compat handlers
 *
 * v2 events use a single delegated listener on the app container.
 * v1 workflow button handlers are kept for backward compat but are
 * only bound when v1 buttons exist in the DOM.
 */

/* ── v1: capture + preview (kept for backward compat) ── */

window.PO.captureAndPreview = async function () {
  try {
    var captureStart = Date.now();
    window.PO.setStatus && window.PO.setStatus("capturing...");
    window.PO.Logger && window.PO.Logger.info("capture.started", { component: "capture" });

    var capture = await window.PO.captureSelectionData();

    window.PO.updatePreview && window.PO.updatePreview(capture);
    window.PO.showTransientStatus &&
      window.PO.showTransientStatus(window.PO.formatSelectionBounds(capture.bounds));

    window.PO.Logger && window.PO.Logger.info("capture.completed", {
      component: "capture",
      durationMs: Date.now() - captureStart,
      data: {
        width: capture.bounds.width,
        height: capture.bounds.height,
        hasMask: !!capture.maskPngBase64,
        documentId: capture.documentId,
      },
    });
    return capture;
  } catch (error) {
    window.PO.updatePreview && window.PO.updatePreview(null);
    window.PO.setStatus && window.PO.setStatus(error instanceof Error ? error.message : String(error));
    window.PO.Logger && window.PO.Logger.error("capture.failed", {
      component: "capture",
      error: error,
    });
    return null;
  }
};

/* ── v1: workflow button handler (kept for backward compat) ── */

window.PO.handleWorkflowButton = async function (workflowId) {
  var startTime = Date.now();
  var workflow = window.PO.WORKFLOWS ? window.PO.WORKFLOWS[workflowId] : null;
  var workflowTitle = workflow ? workflow.title : workflowId;

  window.PO.Logger && window.PO.Logger.info("workflow.button.clicked", {
    component: "actions",
    workflowId: workflowId,
    data: { workflowTitle: workflowTitle, category: workflow ? workflow.category : "unknown" },
  });

  var capture = await window.PO.captureAndPreview();

  if (!capture) {
    window.PO.Logger && window.PO.Logger.warn("workflow.capture.failed", {
      component: "actions",
      workflowId: workflowId,
      durationMs: Date.now() - startTime,
      data: { workflowTitle: workflowTitle },
    });
    window.PO.showTransientStatus &&
      window.PO.showTransientStatus("抓取选区失败 — 请确保有活动选区");
    return;
  }

  window.PO.Logger && window.PO.Logger.info("workflow.parameter_page.opening", {
    component: "actions",
    workflowId: workflowId,
    durationMs: Date.now() - startTime,
    data: { workflowTitle: workflowTitle },
  });

  window.PO.openParameterPage && window.PO.openParameterPage(workflowId);
};

/* ── v1: bind workflow buttons (kept for backward compat) ── */

window.PO.bindWorkflowButtons = function () {
  var workflowBtns = document.querySelectorAll("[data-workflow]");
  for (var i = 0; i < workflowBtns.length; i++) {
    (function (btn) {
      if (btn.getAttribute("data-po-bound") === "workflow") return;
      btn.setAttribute("data-po-bound", "workflow");
      btn.addEventListener("click", function () {
        var workflowId = btn.getAttribute("data-workflow");
        if (workflowId) {
          window.PO.handleWorkflowButton(workflowId);
        }
      });
    })(workflowBtns[i]);
  }
};

/* ═══════════════════════════════════════════════════════════════════
 * v2: delegated event handler
 * ═══════════════════════════════════════════════════════════════════ */

function _onAppClick(e) {
  var target = e.target;

  /* Walk up to find actionable element */
  var el = target;
  while (el) {
    /* ── Favorite toggle ── */
    if (el.getAttribute && el.getAttribute("data-action") === "toggle-favorite") {
      e.preventDefault();
      e.stopPropagation();
      var favCapId = el.getAttribute("data-capability-id");
      if (favCapId) {
        var result = window.PO.FavoritesStore.toggleFavorite(favCapId);
        if (result.reason === "max-reached") {
          window.PO.showTransientStatus &&
            window.PO.showTransientStatus(window.PO.TEXT.favoritesMax);
        }
        /* Update aria-pressed on the button */
        var isFav = window.PO.FavoritesStore.isFavorite(favCapId);
        el.setAttribute("aria-pressed", isFav ? "true" : "false");
        el.textContent = isFav ? "★" : "☆";
        /* Re-render favorites and sections */
        if (window.PO.CapabilitySections) {
          window.PO.CapabilitySections.renderFavorites();
          window.PO.CapabilitySections.renderAllSections();
        }
      }
      return;
    }

    /* ── Move favorite ── */
    if (el.getAttribute && el.getAttribute("data-action") === "move-favorite") {
      e.preventDefault();
      e.stopPropagation();
      var mvCapId = el.getAttribute("data-capability-id");
      var delta = parseInt(el.getAttribute("data-delta") || "0", 10);
      if (mvCapId && delta !== 0) {
        window.PO.FavoritesStore.moveFavorite(mvCapId, delta);
        if (window.PO.CapabilitySections) {
          window.PO.CapabilitySections.renderFavorites();
        }
      }
      return;
    }

    /* ── Toggle section ── */
    if (el.getAttribute && el.getAttribute("data-action") === "toggle-section") {
      e.preventDefault();
      var secId = el.getAttribute("data-section-id");
      if (secId && window.PO.CapabilitySections) {
        window.PO.CapabilitySections.toggleSection(secId);
      }
      return;
    }

    /* ── Capability card body (NOT favorite button) ── */
    if (el.getAttribute && el.getAttribute("data-capability-id") &&
        el.getAttribute("data-action") !== "toggle-favorite" &&
        el.getAttribute("data-action") !== "move-favorite") {
      var capId = el.getAttribute("data-capability-id");
      if (capId && window.PO.CapabilityController) {
        window.PO.CapabilityController.openCapability(capId);
      } else if (capId && window.PO.CapabilitySections) {
        /* Fallback if controller not loaded */
        window.PO.CapabilitySections.showPlaceholder(capId);
      }
      return;
    }

    /* ── Clear favorites ── */
    if (el.id === "clear-favorites-btn") {
      if (confirm(window.PO.TEXT.clearFavoritesConfirm)) {
        window.PO.FavoritesStore.clearAll();
        if (window.PO.CapabilitySections) {
          window.PO.CapabilitySections.renderAll();
        }
        window.PO.showTransientStatus &&
          window.PO.showTransientStatus("收藏已清除");
      }
      return;
    }

    /* ── Clear cache ── */
    if (el.id === "clear-cache-btn") {
      if (confirm(window.PO.TEXT.clearCacheConfirm)) {
        try { localStorage.removeItem("po.capabilityCache.v2"); } catch (_) {}
        window.PO.showTransientStatus &&
          window.PO.showTransientStatus("能力缓存已清除");
      }
      return;
    }

    /* ── Clear drafts ── */
    if (el.id === "clear-drafts-btn") {
      if (confirm("确定要清除所有参数草稿吗？此操作不可撤销。")) {
        if (window.PO.ParameterForm) {
          window.PO.ParameterForm.clearDrafts();
          window.PO.showTransientStatus &&
            window.PO.showTransientStatus("参数草稿已清除");
        }
      }
      return;
    }

    /* ── Open environment panel ── */
    if (el.id === "env-open-btn") {
      if (window.PO.FirstRunPanel) {
        window.PO.FirstRunPanel.show();
      }
      return;
    }

    el = el.parentElement;
  }
}

/* ── Search input handler ── */
var _searchTimer = null;
function _onSearchInput(e) {
  var query = e.target.value || "";
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function () {
    if (window.PO.CapabilitySections) {
      window.PO.CapabilitySections.setSearch(query);
    }
  }, 150); /* 150ms debounce */
}

/* ── Keyboard handler for accessibility ── */
function _onAppKeydown(e) {
  /* Enter/Space on capability cards */
  if (e.key === "Enter" || e.key === " ") {
    var target = e.target;
    if (target && target.getAttribute && target.getAttribute("data-capability-id") &&
        target.getAttribute("data-action") !== "toggle-favorite") {
      e.preventDefault();
      target.click();
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * bindEvents — v2 event delegation
 * ═══════════════════════════════════════════════════════════════════ */

window.PO.bindEvents = function () {
  var appRoot = document.getElementById("app");
  if (!appRoot) return;

  /* Remove any existing listener (idempotent via AbortController pattern not available in UXP;
     use a guard attribute) */
  if (appRoot.getAttribute("data-po-events") === "v2") return;
  appRoot.setAttribute("data-po-events", "v2");

  /* Delegated click */
  appRoot.addEventListener("click", _onAppClick);

  /* Delegated keyboard */
  appRoot.addEventListener("keydown", _onAppKeydown);

  /* Search input */
  var searchInput = appRoot.querySelector('[data-action="search-input"]');
  if (searchInput && !searchInput.getAttribute("data-po-bound")) {
    searchInput.setAttribute("data-po-bound", "search");
    searchInput.addEventListener("input", _onSearchInput);
  }

  /* ── Settings (delegated via _onAppClick) + init ── */
  if (window.PO.initSettings) window.PO.initSettings();

  /* ── v1 workflow buttons (only if v1 template is active) ── */
  if (window.PO.bindWorkflowButtons) {
    window.PO.bindWorkflowButtons();
  }

  /* ── Init parameter page if v1 modules present ── */
  if (window.PO.initParameterPage) {
    window.PO.initParameterPage();
  }
};
