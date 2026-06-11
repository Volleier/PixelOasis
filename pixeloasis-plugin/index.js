/* PixelOasis — Assembly & startup
 *
 * Dependencies (loaded via <script> tags in index.html, in order):
 *   scripts/ui-text.js        → window.PO.TEXT
 *   scripts/state.js           → window.PO.state, clearTransientTimer
 *   scripts/ui-template.js     → window.PO.buildTemplate
 *   scripts/ui-workflows.js    → window.PO.WORKFLOWS, CATEGORY_WORKFLOW
 *   scripts/vendor/png-encoder.js → window.PO.PngEncoder
 *   scripts/photoshop.js       → PS API wrappers
 *   scripts/ui-status.js      → setStatus, showTransientStatus, refreshSelectionStatus
 *   scripts/ui-preview.js      → updatePreview
 *   scripts/ui-settings.js     → toggleSettings, initSettings
 *   scripts/ui-parameters.js   → buildParameterPage, open/close/save, initParameterPage
 *   scripts/actions.js         → handleCapture, handleSelectTool, bindEvents
 */

(function () {
  try {
    /* ── Startup log ── */
    window.PO.Logger.info("plugin.started", {
      component: "startup",
      message: "PixelOasis initializing",
      data: { version: "0.1.0" },
    });

    /* ── Render template ── */
    var appRoot = document.getElementById("app");
    if (!appRoot) throw new Error("PixelOasis root element not found.");
    appRoot.innerHTML = window.PO.buildTemplate();

    /* ── Query DOM elements ── */
    window.PO.elements = {
      settingsButton: document.getElementById("settings-btn"),
      settingsOverlay: document.getElementById("settings-overlay"),
      settingsDrawer: document.getElementById("settings-drawer"),
      themeToggleButton: document.getElementById("theme-toggle-btn"),
      gatewayUrlInput: document.getElementById("gateway-url-input"),
      statusNode: document.getElementById("status"),
      previewEmpty: document.getElementById("preview-empty"),
      previewImage: document.getElementById("preview-image"),
    };

    /* ── Query parameter page elements ── */
    window.PO.paramElements = {
      page: document.getElementById("param-page"),
      title: document.getElementById("param-title"),
      backBtn: document.getElementById("param-back-btn"),
      backBtnBottom: document.getElementById("param-back-btn-bottom"),
      prompt: document.getElementById("param-prompt"),
      negPrompt: document.getElementById("param-neg-prompt"),
      seed: document.getElementById("param-seed"),
      randomSeedBtn: document.getElementById("param-random-seed"),
      steps: document.getElementById("param-steps"),
      stepsVal: document.getElementById("param-steps-val"),
      cfg: document.getElementById("param-cfg"),
      cfgVal: document.getElementById("param-cfg-val"),
      denoise: document.getElementById("param-denoise"),
      denoiseVal: document.getElementById("param-denoise-val"),
      sampler: document.getElementById("param-sampler"),
      scheduler: document.getElementById("param-scheduler"),
      runBtn: document.getElementById("param-run-btn"),
    };

    var els = window.PO.elements;

    /* Validate critical elements */
    if (
      !els.settingsButton ||
      !els.settingsOverlay ||
      !els.settingsDrawer ||
      !els.themeToggleButton ||
      !els.statusNode ||
      !els.previewEmpty ||
      !els.previewImage
    ) {
      throw new Error("PixelOasis UI element not found.");
    }

    /* ── Bind events ── */
    window.PO.bindEvents();

    /* ── Init parameter page ── */
    window.PO.initParameterPage();

    /* ── Startup ── */
    try {
      var photoshop = window.require("photoshop");
      if (photoshop && photoshop.app) {
        window.PO.updatePreview(null);
        window.PO.refreshSelectionStatus();
      } else {
        window.PO.setStatus("uxp shell ready");
      }
    } catch (error) {
      window.PO.setStatus(error instanceof Error ? error.message : String(error));
    }
  } catch (error) {
    window.PO.Logger.error("plugin.initialization_failed", {
      component: "startup",
      error: error,
    });
    document.body.innerHTML =
      '<pre class="po-fatal">' +
      (error instanceof Error ? error.stack || error.message : String(error)) +
      "</pre>";
  }
})();
