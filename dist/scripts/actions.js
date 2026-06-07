window.PO = window.PO || {};

/* Capture current selection + update preview.
 * Returns the capture object on success, null if no selection. */
window.PO.captureAndPreview = async function () {
  try {
    window.PO.setStatus("capturing...");
    var capture = await window.PO.captureSelectionData();
    window.PO.updatePreview(capture);
    window.PO.showTransientStatus(window.PO.formatSelectionBounds(capture.bounds));
    return capture;
  } catch (error) {
    window.PO.updatePreview(null);
    window.PO.setStatus(error instanceof Error ? error.message : String(error));
    return null;
  }
};

/* Workflow button handler — capture → preview → open param page */
window.PO.handleWorkflowButton = async function (workflowId) {
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
