/* PixelOasis — Assembly & startup
 *
 * Dependencies (loaded via <script> tags in index.html, in order):
 *   scripts/ui-text.js       → window.PO.TEXT
 *   scripts/state.js          → window.PO.state, clearTransientTimer
 *   scripts/ui-template.js    → window.PO.buildTemplate
 *   scripts/photoshop.js      → PS API wrappers
 *   scripts/ui-status.js     → setStatus, showTransientStatus, refreshSelectionStatus
 *   scripts/ui-preview.js     → updatePreview
 *   scripts/ui-settings.js    → toggleSettings, initSettings
 *   scripts/actions.js        → handleCapture, handleSelectTool, bindEvents
 */

(function () {
  try {
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
      captureButtons: [
        document.getElementById("capture-btn"),
        document.getElementById("capture-btn-preview"),
      ].filter(Boolean),
      statusNode: document.getElementById("status"),
      previewEmpty: document.getElementById("preview-empty"),
      previewImage: document.getElementById("preview-image"),
      toolButton: document.getElementById("tool-btn"),
    };

    var els = window.PO.elements;

    /* Validate critical elements */
    if (
      !els.settingsButton ||
      !els.settingsOverlay ||
      !els.settingsDrawer ||
      !els.themeToggleButton ||
      !els.captureButtons.length ||
      !els.statusNode ||
      !els.previewEmpty ||
      !els.previewImage ||
      !els.toolButton
    ) {
      throw new Error("PixelOasis UI element not found.");
    }

    /* ── Bind events ── */
    window.PO.bindEvents();

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
    document.body.innerHTML =
      '<pre class="po-fatal">' +
      (error instanceof Error ? error.stack || error.message : String(error)) +
      "</pre>";
  }
})();
