window.PO = window.PO || {};

var selectRectangularMarqueeToolCommand = [
  { _obj: "select", _target: [{ _ref: "marqueeRectTool" }] },
];

/* Shared: capture current selection + update preview.
 * Returns the capture object on success, null if no selection. */
window.PO.captureAndPreview = async function () {
  try {
    window.PO.setStatus("capturing...");
    var capture = await window.PO.captureSelectionData();
    window.PO.updatePreview(capture);
    window.PO.showTransientStatus(window.PO.formatSelectionBounds(capture.bounds));
    return capture;
  } catch (error) {
    /* No selection or no document → clear preview, don't throw */
    window.PO.updatePreview(null);
    window.PO.setStatus(error instanceof Error ? error.message : String(error));
    return null;
  }
};

window.PO.handleCapture = async function () {
  /* Capture, update preview, then open param page */
  await window.PO.captureAndPreview();
  window.PO.openParameterPage("entry.capture");
};

window.PO.handleSelectTool = async function () {
  /* Switch tool, capture current selection (if any), update preview, open param page */
  try {
    var photoshop = window.require("photoshop");
    var app = photoshop.app;
    var action = photoshop.action;
    var core = photoshop.core;
    var before =
      app.currentTool && app.currentTool.id ? app.currentTool.id : "unknown";

    await core.executeAsModal(
      async function () {
        await action.batchPlay(selectRectangularMarqueeToolCommand, {
          synchronousExecution: false,
          modalBehavior: "execute",
        });
      },
      { commandName: "PixelOasis Select Rectangular Marquee Tool" },
    );

    var after =
      app.currentTool && app.currentTool.id ? app.currentTool.id : "unknown";
    window.PO.showTransientStatus("tool: " + before + " -> " + after);
  } catch (error) {
    window.PO.setStatus(error instanceof Error ? error.message : String(error));
  }

  /* Capture + preview after tool switch (silent if no selection) */
  await window.PO.captureAndPreview();
  window.PO.openParameterPage("entry.tool-select");
};

window.PO.bindEvents = function () {
  var els = window.PO.elements;

  /* Settings (overlay + drawer) */
  window.PO.initSettings();

  /* Capture button */
  els.captureButtons.forEach(function (button) {
    button.addEventListener("click", window.PO.handleCapture);
  });

  /* Tool button */
  els.toolButton.addEventListener("click", window.PO.handleSelectTool);
};
