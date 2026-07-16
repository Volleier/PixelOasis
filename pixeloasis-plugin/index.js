/* PixelOasis v2 — Assembly & startup
 *
 * Startup flow (roadmap §5.2):
 *   1. buildTemplate() — query fixed containers and overlay DOM
 *   2. initSettings(), init stores, bindEvents()
 *   3. restoreFavorites(), restoreUiPreferences()
 *   4. refreshGatewayHealth() → refreshCapabilities()
 *   5. renderCapabilityApp() — favorites + all sections
 *   6. (future) recoverActiveJobs()
 *
 * Prohibited at startup:
 *   - auto capture, auto upload, auto placement
 *   - calling v1 loadWorkflowsFromBackend()
 *   - category-fallback rendering
 */

(function () {
  "use strict";

  try {
    /* ── Startup log ── */
    window.PO.Logger && window.PO.Logger.info("plugin.started", {
      component: "startup",
      message: "PixelOasis v2 initializing",
      data: { version: "0.2.0" },
    });

    /* ═══════════════════════════════════════════════════════════════
     * Step 1: Build template (now uses CapabilitySections.renderApp)
     * ═══════════════════════════════════════════════════════════════ */

    var appRoot = document.getElementById("app");
    if (!appRoot) throw new Error("PixelOasis root element not found.");

    /* buildTemplate() delegates to CapabilitySections.renderApp() in v2 */
    window.PO.buildTemplate();

    /* ═══════════════════════════════════════════════════════════════
     * Step 2: Query DOM elements (created by renderApp)
     * ═══════════════════════════════════════════════════════════════ */

    /* Elements are already set by CapabilitySections.renderApp() onto
       window.PO.elements.  Ensure critical elements exist. */
    var els = window.PO.elements;
    if (!els || !els.statusNode || !els.settingsButton) {
      /* v1 fallback: query them from DOM directly */
      window.PO.elements = window.PO.elements || {};
      window.PO.elements.statusNode = document.getElementById("status");
      window.PO.elements.settingsButton = document.getElementById("settings-btn");
      window.PO.elements.settingsOverlay = document.getElementById("settings-overlay");
      window.PO.elements.settingsDrawer = document.getElementById("settings-drawer");
      window.PO.elements.themeToggleButton = document.getElementById("theme-toggle-btn");
      window.PO.elements.gatewayUrlInput = document.getElementById("gateway-url-input");
    }

    /* ═══════════════════════════════════════════════════════════════
     * Step 3: Init settings (binds drawer events)
     * ═══════════════════════════════════════════════════════════════ */

    if (window.PO.initSettings) window.PO.initSettings();

    /* ═══════════════════════════════════════════════════════════════
     * Step 4: Restore persisted state
     * ═══════════════════════════════════════════════════════════════ */

    /* Restore favorites from localStorage */
    if (window.PO.FavoritesStore) {
      window.PO.FavoritesStore.loadFavorites();
    }

    /* Restore section collapse state */
    if (window.PO.CapabilitySections && window.PO.CapabilitySections.restoreCollapseState) {
      window.PO.CapabilitySections.restoreCollapseState();
    }

    /* Restore gateway URL from v1 state (migrate forward) */
    try {
      var savedUrl = localStorage.getItem("po.settings.v2");
      if (!savedUrl) {
        /* Try old setting */
        savedUrl = localStorage.getItem("po.gatewayUrl");
      }
      if (savedUrl) {
        var urlData = JSON.parse(savedUrl);
        var url = (urlData && urlData.gatewayUrl) || urlData;
        if (typeof url === "string" && url.length > 0) {
          window.PO.state.gateway.baseUrl = url;
          if (els && els.gatewayUrlInput) {
            els.gatewayUrlInput.value = url;
          }
        }
      }
    } catch (e) { /* ignore */ }

    /* ═══════════════════════════════════════════════════════════════
     * Step 5: Refresh capabilities
     * ═══════════════════════════════════════════════════════════════ */

    var capsPromise;
    if (window.PO.CapabilityStore) {
      capsPromise = window.PO.CapabilityStore.refreshCapabilities({ force: false });
    } else {
      capsPromise = Promise.resolve();
    }

    /* ═══════════════════════════════════════════════════════════════
     * Step 6: Render UI (after capabilities are available)
     * ═══════════════════════════════════════════════════════════════ */

    capsPromise.then(function () {
      if (window.PO.CapabilitySections) {
        window.PO.CapabilitySections.renderAll();
      }

      /* Prune expired tombstones */
      if (window.PO.FavoritesStore && window.PO.CapabilityStore) {
        var allCaps = window.PO.CapabilityStore.getAll();
        var allIds = [];
        for (var i = 0; i < allCaps.length; i++) {
          allIds.push(allCaps[i].id);
        }
        window.PO.FavoritesStore.pruneTombstones(allIds);
      }

      /* ═══════════════════════════════════════════════════════════════
       * Step 6.5: Recover active jobs
       * ═══════════════════════════════════════════════════════════════ */
      if (window.PO.JobStore && window.PO.JobController) {
        window.PO.JobStore.load();
        var activeJobs = window.PO.JobStore.listActive();
        if (activeJobs.length > 0 && window.PO.CapabilitySections && window.PO.CapabilitySections.updateTaskLink) {
          window.PO.CapabilitySections.updateTaskLink(activeJobs.length);
        }
        /* Recover job tracking in background */
        window.PO.JobController.recoverActiveJobs().catch(function (err) {
          window.PO.Logger && window.PO.Logger.warn("job.recovery_failed", {
            component: "startup",
            error: err,
          });
        });
      }

      /* Update task link */
      if (window.PO.CapabilitySections && window.PO.CapabilitySections.updateTaskLink) {
        window.PO.CapabilitySections.updateTaskLink(0);
      }
    }).catch(function (err) {
      window.PO.Logger && window.PO.Logger.error("capabilities.render_failed", {
        component: "startup",
        error: err,
      });
      /* Try rendering with whatever we have */
      if (window.PO.CapabilitySections) {
        window.PO.CapabilitySections.renderAll();
      }
    });

    /* ═══════════════════════════════════════════════════════════════
     * Step 7: Bind events
     * ═══════════════════════════════════════════════════════════════ */

    window.PO.bindEvents();

    /* ═══════════════════════════════════════════════════════════════
     * Step 8: Gateway health check (background, non-blocking)
     * ═══════════════════════════════════════════════════════════════ */

    if (window.PO.GatewayClient && window.PO.GatewayClient.health) {
      window.PO.GatewayClient.health().then(function (healthy) {
        window.PO.state.gateway.health = healthy ? "online" : "offline";

        if (window.PO.CapabilitySections && window.PO.CapabilitySections.updateEnvStatus) {
          window.PO.CapabilitySections.updateEnvStatus(
            healthy ? "网关已连接" : "网关离线 — 使用本地缓存"
          );
        }

        if (healthy) {
          window.PO.setStatus && window.PO.setStatus("网关就绪");
          /* Try to refresh capabilities from live gateway */
          if (window.PO.CapabilityStore) {
            window.PO.CapabilityStore.refreshCapabilities({ force: true }).then(function () {
              if (window.PO.CapabilitySections) {
                window.PO.CapabilitySections.renderAll();
              }
            }).catch(function () { /* keep fixture/cache data */ });
          }
        } else {
          window.PO.setStatus && window.PO.setStatus("离线模式 — 使用缓存数据");
        }
      }).catch(function () {
        window.PO.state.gateway.health = "offline";
        window.PO.setStatus && window.PO.setStatus("离线模式 — 使用缓存数据");
        if (window.PO.CapabilitySections && window.PO.CapabilitySections.updateEnvStatus) {
          window.PO.CapabilitySections.updateEnvStatus("网关离线 — 使用本地缓存");
        }
      });
    }

    /* ═══════════════════════════════════════════════════════════════
     * Step 9: Photoshop document listener (lightweight, non-blocking)
     * ═══════════════════════════════════════════════════════════════ */

    try {
      var photoshop = window.require("photoshop");
      if (photoshop && photoshop.app) {
        window.PO.refreshSelectionStatus && window.PO.refreshSelectionStatus();
        window.PO.setStatus && window.PO.setStatus("就绪");
      } else {
        window.PO.setStatus && window.PO.setStatus("uxp shell ready");
      }
    } catch (error) {
      window.PO.setStatus &&
        window.PO.setStatus(error instanceof Error ? error.message : String(error));
    }

    window.PO.Logger && window.PO.Logger.info("plugin.ready", {
      component: "startup",
      message: "PixelOasis v2 initialized",
    });

  } catch (error) {
    window.PO.Logger && window.PO.Logger.error("plugin.initialization_failed", {
      component: "startup",
      error: error,
    });
    document.body.innerHTML =
      '<pre class="po-fatal">' +
      (error instanceof Error ? error.stack || error.message : String(error)) +
      "</pre>";
  }
})();
