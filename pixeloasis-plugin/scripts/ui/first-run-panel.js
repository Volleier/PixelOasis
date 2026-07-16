/* first-run-panel.js — v2 environment status display
 *
 * Read-only health information.  Does NOT install/download models —
 * that is the gateway's responsibility (roadmap §6.6).
 *
 * Provides:
 *   show()    — display environment overlay
 *   refresh() — re-fetch health data
 *   hide()    — dismiss overlay
 */

window.PO = window.PO || {};

window.PO.FirstRunPanel = (function () {
  "use strict";

  var _overlay = null;
  var _healthData = null;

  /* ── Status icons ── */
  var STATUS_OK = "✓";
  var STATUS_WARN = "⚠";
  var STATUS_ERR = "✗";
  var STATUS_UNKNOWN = "?";

  /* ═══════════════════════════════════════════════════════════════════
   * show()
   * ═══════════════════════════════════════════════════════════════════ */

  function show() {
    hide();

    _overlay = document.createElement("div");
    _overlay.className = "po-env-overlay";
    _overlay.setAttribute("role", "dialog");
    _overlay.setAttribute("aria-label", "环境状态");

    /* Header */
    var header = document.createElement("div");
    header.className = "po-env-overlay__header";

    var title = document.createElement("span");
    title.className = "po-env-overlay__title";
    title.textContent = "环境状态";
    header.appendChild(title);

    var closeBtn = document.createElement("button");
    closeBtn.className = "po-env-overlay__close";
    closeBtn.type = "button";
    closeBtn.textContent = "✕";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.addEventListener("click", function () { hide(); });
    header.appendChild(closeBtn);

    _overlay.appendChild(header);

    /* Scroll body */
    var scroll = document.createElement("div");
    scroll.className = "po-env-overlay__scroll";

    /* Refresh button */
    var refreshRow = document.createElement("div");
    refreshRow.className = "po-env-refresh-row";

    var refreshBtn = document.createElement("button");
    refreshBtn.className = "po-button";
    refreshBtn.type = "button";
    refreshBtn.textContent = "刷新状态";
    refreshBtn.addEventListener("click", async function () {
      refreshBtn.textContent = "刷新中…";
      refreshBtn.disabled = true;
      await refresh();
      _renderStatus(scroll, _healthData);
      refreshBtn.textContent = "刷新状态";
      refreshBtn.disabled = false;
    });
    refreshRow.appendChild(refreshBtn);
    scroll.appendChild(refreshRow);

    /* Status sections */
    _renderStatus(scroll, _healthData);

    _overlay.appendChild(scroll);

    /* Keyboard */
    _overlay.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); hide(); }
    });

    var appRoot = document.getElementById("app");
    if (appRoot) appRoot.appendChild(_overlay);

    /* Auto-refresh on first open */
    refresh().then(function () {
      _renderStatus(scroll, _healthData);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
   * refresh() → fetch /v2/health?depth=full
   * ═══════════════════════════════════════════════════════════════════ */

  async function refresh() {
    try {
      var resp = await window.PO.GatewayV2Client.getHealth("full");
      _healthData = (resp && resp.data) || null;

      window.PO.Logger && window.PO.Logger.info("env.health_refreshed", {
        component: "first-run-panel",
        data: _healthData ? {
          gateway: _healthData.gateway,
          comfyui: _healthData.comfyui ? "connected" : "disconnected",
        } : { gateway: "offline" },
      });
    } catch (e) {
      _healthData = null;
      window.PO.Logger && window.PO.Logger.warn("env.health_fetch_failed", {
        component: "first-run-panel",
        error: e,
      });
    }
  }

  /* ═══════════════════════════════════════════════════════════════════
   * _renderStatus(container, data)
   * ═══════════════════════════════════════════════════════════════════ */

  function _renderStatus(container, data) {
    /* Clear existing status rows (keep refresh button) */
    var existingRows = container.querySelectorAll(".po-env-row, .po-env-section");
    for (var i = 0; i < existingRows.length; i++) {
      existingRows[i].remove();
    }

    if (!data) {
      _addSection(container, "网关", STATUS_ERR, "网关离线 — 请检查网关是否运行", "error");
      _addSection(container, "ComfyUI", STATUS_UNKNOWN, "等待网关连接…", "unknown");
      _addSection(container, "GPU", STATUS_UNKNOWN, "等待网关连接…", "unknown");
      _addSection(container, "模型", STATUS_UNKNOWN, "等待网关连接…", "unknown");
      _addSection(container, "节点", STATUS_UNKNOWN, "等待网关连接…", "unknown");
      _addSection(container, "磁盘", STATUS_UNKNOWN, "等待网关连接…", "unknown");
      return;
    }

    /* Gateway */
    var gwOk = data.gateway === "ok" || data.gateway === "online";
    _addSection(container, "网关",
      gwOk ? STATUS_OK : STATUS_ERR,
      gwOk ? "网关已连接" : "网关异常",
      gwOk ? "ok" : "error"
    );

    /* Base URL */
    var baseUrl = (window.PO.state && window.PO.state.gateway && window.PO.state.gateway.baseUrl) || "http://127.0.0.1:8787";
    _addRow(container, "地址", baseUrl, "muted");

    /* ComfyUI */
    var comfyOk = data.comfyui === "connected" || data.comfyui === "ok";
    _addSection(container, "ComfyUI",
      comfyOk ? STATUS_OK : STATUS_ERR,
      comfyOk ? "ComfyUI 已连接" : (data.comfyui || "未连接"),
      comfyOk ? "ok" : "error"
    );

    /* GPU */
    if (data.gpu) {
      var vramInfo = "";
      if (data.gpu.vram_total_gb) vramInfo += data.gpu.vram_total_gb + " GB 总量";
      if (data.gpu.vram_free_gb !== undefined) vramInfo += " / " + data.gpu.vram_free_gb + " GB 可用";

      var gpuOk = data.gpu.vram_free_gb > 4; /* Below 4GB = warning */
      _addSection(container, "GPU",
        gpuOk ? STATUS_OK : STATUS_WARN,
        (data.gpu.name || "GPU") + (vramInfo ? " — " + vramInfo : ""),
        gpuOk ? "ok" : "warn"
      );
    } else {
      _addSection(container, "GPU", STATUS_WARN, "未检测到 GPU 信息", "warn");
    }

    /* Profile */
    if (data.profile) {
      _addRow(container, "质量档", data.profile, "muted");
    }

    /* Models */
    if (data.models) {
      var modelTotal = data.models.total || 0;
      var modelReady = data.models.ready || 0;
      var modelMissing = data.models.missing || 0;
      var modelOk = modelMissing === 0;

      _addSection(container, "模型",
        modelOk ? STATUS_OK : STATUS_ERR,
        modelReady + "/" + modelTotal + " 就绪" + (modelMissing > 0 ? "，缺失 " + modelMissing + " 个" : ""),
        modelOk ? "ok" : "error"
      );

      if (data.models.missing_list && data.models.missing_list.length > 0) {
        for (var mi = 0; mi < data.models.missing_list.length; mi++) {
          _addRow(container, "  缺失", data.models.missing_list[mi], "error");
        }
      }
    } else {
      _addSection(container, "模型", STATUS_UNKNOWN, "无法获取模型状态", "unknown");
    }

    /* Nodes */
    if (data.nodes) {
      var nodeTotal = data.nodes.total || 0;
      var nodeReady = data.nodes.ready || 0;
      var nodeMissing = data.nodes.missing || 0;
      var nodeOk = nodeMissing === 0;

      _addSection(container, "自定义节点",
        nodeOk ? STATUS_OK : STATUS_ERR,
        nodeReady + "/" + nodeTotal + " 就绪" + (nodeMissing > 0 ? "，缺失 " + nodeMissing + " 个" : ""),
        nodeOk ? "ok" : "error"
      );

      if (data.nodes.missing_list && data.nodes.missing_list.length > 0) {
        for (var ni = 0; ni < data.nodes.missing_list.length; ni++) {
          _addRow(container, "  缺失", data.nodes.missing_list[ni], "error");
        }
      }
    } else {
      _addSection(container, "自定义节点", STATUS_UNKNOWN, "无法获取节点状态", "unknown");
    }

    /* Disk */
    if (data.disk) {
      var diskFreeGb = data.disk.free_gb || 0;
      var diskOk = diskFreeGb >= 5;
      _addSection(container, "磁盘",
        diskOk ? STATUS_OK : STATUS_ERR,
        diskFreeGb.toFixed(1) + " GB 可用" + (diskOk ? "" : " — 空间不足"),
        diskOk ? "ok" : "error"
      );
    }

    /* Queue */
    if (data.queue_length !== undefined) {
      _addRow(container, "队列长度", String(data.queue_length) + " 个任务", "muted");
    }
  }

  function _addSection(container, label, icon, message, status) {
    var row = document.createElement("div");
    row.className = "po-env-section po-env-section--" + (status || "unknown");

    var iconEl = document.createElement("span");
    iconEl.className = "po-env-icon po-env-icon--" + (status || "unknown");
    iconEl.textContent = icon;
    row.appendChild(iconEl);

    var labelEl = document.createElement("span");
    labelEl.className = "po-env-label";
    labelEl.textContent = label;
    row.appendChild(labelEl);

    var msgEl = document.createElement("span");
    msgEl.className = "po-env-message";
    msgEl.textContent = message;
    row.appendChild(msgEl);

    container.appendChild(row);
  }

  function _addRow(container, label, message, status) {
    var row = document.createElement("div");
    row.className = "po-env-row po-env-row--" + (status || "muted");

    var labelEl = document.createElement("span");
    labelEl.className = "po-env-row__label";
    labelEl.textContent = label;
    row.appendChild(labelEl);

    var msgEl = document.createElement("span");
    msgEl.className = "po-env-row__message";
    msgEl.textContent = message;
    row.appendChild(msgEl);

    container.appendChild(row);
  }

  /* ═══════════════════════════════════════════════════════════════════
   * hide()
   * ═══════════════════════════════════════════════════════════════════ */

  function hide() {
    if (_overlay && _overlay.parentNode) {
      _overlay.parentNode.removeChild(_overlay);
    }
    _overlay = null;
  }

  return {
    show:    show,
    refresh: refresh,
    hide:    hide,
  };
})();
