window.PO = window.PO || {};

window.PO.toggleSettings = function () {
  var state = window.PO.state;
  var els = window.PO.elements;

  state.settingsOpen = !state.settingsOpen;

  if (state.settingsOpen) {
    els.settingsOverlay.hidden = false;
    els.settingsDrawer.hidden = false;
    els.settingsDrawer.setAttribute("aria-hidden", "false");
  } else {
    els.settingsOverlay.hidden = true;
    els.settingsDrawer.hidden = true;
    els.settingsDrawer.setAttribute("aria-hidden", "true");
  }
};

window.PO.initSettings = function () {
  var els = window.PO.elements;

  els.settingsButton.addEventListener("click", window.PO.toggleSettings);

  els.settingsOverlay.addEventListener("click", function () {
    if (window.PO.state.settingsOpen) {
      window.PO.toggleSettings();
    }
  });

  els.themeToggleButton.addEventListener("click", function () {
    var state = window.PO.state;
    state.themePressed = !state.themePressed;
    els.themeToggleButton.setAttribute(
      "aria-pressed",
      state.themePressed ? "true" : "false",
    );
    window.PO.showTransientStatus("theme toggle clicked");
  });

  /* Gateway URL — save on change */
  if (els.gatewayUrlInput) {
    els.gatewayUrlInput.value = window.PO.state.gatewayUrl || "http://127.0.0.1:8787";
    els.gatewayUrlInput.addEventListener("change", function () {
      var val = els.gatewayUrlInput.value.trim();
      if (val) {
        window.PO.state.gatewayUrl = val;
        window.PO.showTransientStatus("网关地址已更新");
      }
    });
  }

  /* ── Log settings ── */
  var logToggleBtn = document.getElementById("log-toggle-btn");
  var logLevelSelect = document.getElementById("log-level-select");
  var logClearBtn = document.getElementById("log-clear-btn");
  var logPathNode = document.getElementById("log-path-display");

  if (logToggleBtn) {
    logToggleBtn.setAttribute("aria-pressed", window.PO.state.logging.enabled ? "true" : "false");
    logToggleBtn.addEventListener("click", function () {
      window.PO.state.logging.enabled = !window.PO.state.logging.enabled;
      logToggleBtn.setAttribute("aria-pressed", window.PO.state.logging.enabled ? "true" : "false");
      window.PO.showTransientStatus("日志已" + (window.PO.state.logging.enabled ? "开启" : "关闭"));
    });
  }

  if (logLevelSelect) {
    logLevelSelect.value = window.PO.state.logging.level || "info";
    logLevelSelect.addEventListener("change", function () {
      window.PO.state.logging.level = logLevelSelect.value;
      window.PO.showTransientStatus("日志级别: " + logLevelSelect.value);
    });
  }

  if (logClearBtn) {
    logClearBtn.addEventListener("click", async function () {
      try {
        await window.PO.Logger.clearLogs();
        window.PO.showTransientStatus("日志已清空");
      } catch (e) {
        window.PO.showTransientStatus("清空日志失败: " + (e.message || e));
      }
    });
  }

  /* Display log path */
  if (logPathNode) {
    window.PO.Logger.getLogPath().then(function (p) {
      logPathNode.textContent = p;
    });
  }
};
