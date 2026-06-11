window.PO = window.PO || {};

/* Capture current selection + update preview.
 * Returns the capture object on success, null if no selection. */
window.PO.captureAndPreview = async function () {
  try {
    var captureStart = Date.now();
    window.PO.setStatus("capturing...");
    window.PO.Logger.info("capture.started", { component: "capture" });

    var capture = await window.PO.captureSelectionData();

    window.PO.updatePreview(capture);
    window.PO.showTransientStatus(window.PO.formatSelectionBounds(capture.bounds));

    window.PO.Logger.info("capture.completed", {
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
    window.PO.updatePreview(null);
    window.PO.setStatus(error instanceof Error ? error.message : String(error));

    window.PO.Logger.error("capture.failed", {
      component: "capture",
      error: error,
    });
    return null;
  }
};

/* Workflow button handler — capture → preview → open param page */
window.PO.handleWorkflowButton = async function (workflowId) {
  var startTime = Date.now();
  window.PO.Logger.info("workflow.clicked", {
    component: "actions",
    workflowId: workflowId,
  });

  await window.PO.captureAndPreview();
  window.PO.openParameterPage(workflowId);
};

window.PO.bindEvents = function () {
  /* Settings (overlay + drawer) */
  window.PO.initSettings();

  /* Workflow buttons — any [data-workflow] element */
  var workflowBtns = document.querySelectorAll("[data-workflow]");
  for (var i = 0; i < workflowBtns.length; i++) {
    (function (btn) {
      btn.addEventListener("click", function () {
        var workflowId = btn.getAttribute("data-workflow");
        if (workflowId) {
          window.PO.handleWorkflowButton(workflowId);
        }
      });
    })(workflowBtns[i]);
  }
};
