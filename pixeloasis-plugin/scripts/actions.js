window.PO = window.PO || {};

var selectRectangularMarqueeToolCommand = [
  { _obj: "select", _target: [{ _ref: "marqueeRectTool" }] },
];

window.PO.handleCapture = async function () {
  try {
    window.PO.setStatus("capturing...");
    var capture = await window.PO.captureSelectionData();
    window.PO.updatePreview(capture);
    window.PO.showTransientStatus(window.PO.formatSelectionBounds(capture.bounds));
  } catch (error) {
    window.PO.setStatus(error instanceof Error ? error.message : String(error));
  }
};

window.PO.handleSelectTool = async function () {
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
};

window.PO.bindEvents = function () {
  var els = window.PO.elements;

  /* Settings (overlay + drawer) */
  window.PO.initSettings();

  /* Capture buttons */
  els.captureButtons.forEach(function (button) {
    button.addEventListener("click", window.PO.handleCapture);
  });

  /* Tool button */
  els.toolButton.addEventListener("click", window.PO.handleSelectTool);
};
