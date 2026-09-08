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
  var GATEWAY_PRESETS = {
    local: "http://127.0.0.1:8787",
    online: "http://127.0.0.1:8790",
  };

  function saveGatewaySettings() {
    try {
      localStorage.setItem("po.settings.v2", JSON.stringify({
        gatewayMode: window.PO.state.gateway.mode,
        gatewayUrl: window.PO.state.gatewayUrl,
        onlineModel: window.PO.state.gateway.onlineModel,
      }));
    } catch (_) {}
  }

  /* Load initial saved settings */
  try {
    var saved = JSON.parse(localStorage.getItem("po.settings.v2") || "{}");
    if (saved.onlineModel) {
      window.PO.state.gateway.onlineModel = saved.onlineModel;
    }
  } catch (_) {}

  function refreshGateway() {
    window.PO.state.gateway.health = "unknown";
    if (window.PO.CapabilityStore) {
      window.PO.CapabilityStore.refreshCapabilities({ force: true }).then(function () {
        if (window.PO.CapabilitySections) window.PO.CapabilitySections.renderAll();
      }).catch(function () {});
    }
    window.PO.GatewayV2Client.getHealth("full").then(function (response) {
      var data = response && response.data;
      var healthy = !!(response && response.ok && data && data.status === "ok");
      window.PO.state.gateway.health = healthy ? "online" : "offline";
      if (data && data.models && Array.isArray(data.models)) {
        window.PO.state.gateway.availableModels = data.models;
      }
      if (window.PO.CapabilitySections) {
        var backend = data && data.mode === "online" ? ("在线生图 (" + (data.model || "在线") + ")") : "本地 ComfyUI";
        window.PO.CapabilitySections.updateEnvStatus(healthy ? backend + " 已连接" : backend + " 未连接");
      }
    }).catch(function () { window.PO.state.gateway.health = "offline"; });
  }

  if (window.PO.state && window.PO.state._settingsInitialized) return;
  if (window.PO.state) window.PO.state._settingsInitialized = true;

  els.settingsButton.addEventListener("click", window.PO.toggleSettings);

  els.settingsOverlay.addEventListener("click", function () {
    if (window.PO.state.settingsOpen) {
      window.PO.Logger.info("settings.overlay_dismissed", { component: "settings" });
      window.PO.toggleSettings();
    }
  });

  if (els.gatewayModeSelect) {
    els.gatewayModeSelect.value = window.PO.state.gateway.mode || "local";
    els.gatewayModeSelect.addEventListener("change", function () {
      var mode = els.gatewayModeSelect.value;
      window.PO.state.gateway.mode = mode;
      if (GATEWAY_PRESETS[mode]) {
        window.PO.state.gatewayUrl = GATEWAY_PRESETS[mode];
        if (els.gatewayUrlInput) els.gatewayUrlInput.value = GATEWAY_PRESETS[mode];
      }
      saveGatewaySettings();
      window.PO.showTransientStatus(mode === "online" ? "已切换到在线生图" : "已切换运算后端");
      refreshGateway();
    });
  }

  if (els.gatewayModelSelect) {
    els.gatewayModelSelect.value = window.PO.state.gateway.onlineModel || "nano-banana-2";
    els.gatewayModelSelect.addEventListener("change", function () {
      var model = els.gatewayModelSelect.value;
      window.PO.state.gateway.onlineModel = model;
      saveGatewaySettings();
      if (window.PO.state.gateway.mode === "online" || (window.PO.state.gatewayUrl && window.PO.state.gatewayUrl.indexOf(":8790") !== -1)) {
        fetch(window.PO.state.gatewayUrl + "/v2/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: model }),
        }).catch(function () {});
      }
      window.PO.showTransientStatus("已切换生图模型为 " + model);
      refreshGateway();
    });
  }

  /* Gateway URL — save on change */
  if (els.gatewayUrlInput) {
    els.gatewayUrlInput.value = window.PO.state.gatewayUrl || "http://127.0.0.1:8787";
    els.gatewayUrlInput.addEventListener("change", function () {
      var val = els.gatewayUrlInput.value.trim();
      var oldUrl = window.PO.state.gatewayUrl;
      if (val) {
        window.PO.state.gatewayUrl = val;
        if (window.PO.state.gateway.mode !== "custom" && val !== GATEWAY_PRESETS[window.PO.state.gateway.mode]) {
          window.PO.state.gateway.mode = "custom";
          if (els.gatewayModeSelect) els.gatewayModeSelect.value = "custom";
        }
        saveGatewaySettings();
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
