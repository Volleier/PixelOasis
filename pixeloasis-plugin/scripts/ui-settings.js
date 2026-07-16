window.PO = window.PO || {};

/* 窗口级捕获阶段滚轮拦截 —— 这是唯一能阻止 UXP 事件穿透到 Photoshop 的方式 */
window.PO._settingsWheelCapture = function (e) {
  if (!window.PO.state.settingsOpen) return;
  e.preventDefault();
  e.stopPropagation();
  var body = document.querySelector(".po-settings-drawer__body");
  if (body) {
    body.scrollTop += e.deltaY;
  }
};

window.PO.toggleSettings = function () {
  var state = window.PO.state;
  var els = window.PO.elements;

  state.settingsOpen = !state.settingsOpen;

  if (state.settingsOpen) {
    window.PO.Logger.info("settings.opened", {
      component: "settings",
      data: {
        gatewayUrl: state.gatewayUrl,
        loggingEnabled: state.logging.enabled,
        loggingLevel: state.logging.level,
        themePressed: state.themePressed,
      },
    });

    els.settingsOverlay.hidden = false;
    els.settingsDrawer.hidden = false;
    els.settingsDrawer.setAttribute("aria-hidden", "false");

    /* 锁定主内容区 + 根节点滚动 */
    if (els.mainEl) {
      els.mainEl.style.overflowY = "hidden";
    }
    document.documentElement.style.overflow = "hidden";

    /* 窗口级捕获阶段拦截滚轮事件（capture: true 确保在到达任何 DOM 元素之前拦截） */
    window.addEventListener("wheel", window.PO._settingsWheelCapture, { capture: true, passive: false });
  } else {
    window.PO.Logger.info("settings.closed", {
      component: "settings",
      data: {
        gatewayUrl: state.gatewayUrl,
        loggingEnabled: state.logging.enabled,
        loggingLevel: state.logging.level,
        themePressed: state.themePressed,
      },
    });

    els.settingsOverlay.hidden = true;
    els.settingsDrawer.hidden = true;
    els.settingsDrawer.setAttribute("aria-hidden", "true");

    /* 恢复滚动 */
    if (els.mainEl) {
      els.mainEl.style.overflowY = "";
    }
    document.documentElement.style.overflow = "";

    /* 移除滚轮拦截 */
    window.removeEventListener("wheel", window.PO._settingsWheelCapture, { capture: true });
  }
};

window.PO.initSettings = function () {
  var els = window.PO.elements;

  if (window.PO.state && window.PO.state._settingsInitialized) return;
  if (window.PO.state) window.PO.state._settingsInitialized = true;

  els.settingsButton.addEventListener("click", window.PO.toggleSettings);

  els.settingsOverlay.addEventListener("click", function () {
    if (window.PO.state.settingsOpen) {
      window.PO.Logger.info("settings.overlay_dismissed", { component: "settings" });
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
    window.PO.Logger.info("settings.theme_toggled", {
      component: "settings",
      data: { darkMode: state.themePressed },
    });
    window.PO.showTransientStatus("theme toggle clicked");
  });

  /* Gateway URL — save on change */
  if (els.gatewayUrlInput) {
    els.gatewayUrlInput.value = window.PO.state.gatewayUrl || "http://127.0.0.1:8787";
    els.gatewayUrlInput.addEventListener("change", function () {
      var val = els.gatewayUrlInput.value.trim();
      var oldUrl = window.PO.state.gatewayUrl;
      if (val) {
        window.PO.state.gatewayUrl = val;
        window.PO.Logger.info("settings.gateway_url_changed", {
          component: "settings",
          data: { oldUrl: oldUrl, newUrl: val },
        });
        window.PO.showTransientStatus("网关地址已更新");
      }
    });
  }

  /* ── Log settings ── */
  var logToggleBtn = document.getElementById("log-toggle-btn");
  var logOpenBtn = document.getElementById("log-open-btn");

  if (logToggleBtn) {
    logToggleBtn.setAttribute("aria-pressed", window.PO.state.logging.enabled ? "true" : "false");
    logToggleBtn.addEventListener("click", function () {
      window.PO.state.logging.enabled = !window.PO.state.logging.enabled;
      var enabled = window.PO.state.logging.enabled;
      logToggleBtn.setAttribute("aria-pressed", enabled ? "true" : "false");
      window.PO.Logger.info("settings.logging_toggled", {
        component: "settings",
        data: { enabled: enabled },
      });
      window.PO.showTransientStatus("日志已" + (enabled ? "开启" : "关闭"));
    });
  }

  if (logOpenBtn) {
    logOpenBtn.addEventListener("click", async function () {
      var openStart = Date.now();
      window.PO.Logger.info("settings.open_log_clicked", { component: "settings" });
      try {
        var filePath = await window.PO.Logger.getLogFilePath();
        if (filePath && filePath !== "(unavailable)" && filePath !== "(error)" && filePath !== "(unknown)") {
          var uxp = window.require("uxp");
          await uxp.shell.openPath(filePath);
          window.PO.Logger.info("settings.open_log.completed", {
            component: "settings",
            durationMs: Date.now() - openStart,
            data: { filePath: filePath },
          });
          window.PO.showTransientStatus("已打开日志文件");
        } else {
          window.PO.Logger.warn("settings.open_log.unavailable", {
            component: "settings",
            data: { filePath: filePath },
          });
          window.PO.showTransientStatus("日志文件不可用");
        }
      } catch (e) {
        window.PO.Logger.error("settings.open_log.failed", {
          component: "settings",
          durationMs: Date.now() - openStart,
          error: e,
        });
        window.PO.showTransientStatus("打开日志文件失败: " + (e.message || e));
      }
    });
  }
};
