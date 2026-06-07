window.PO = window.PO || {};

window.PO.setStatus = function (message) {
  window.PO.state.status = message;
  if (window.PO.elements && window.PO.elements.statusNode) {
    window.PO.elements.statusNode.textContent = message;
  }
};

window.PO.showTransientStatus = function (message) {
  window.PO.clearTransientTimer();
  window.PO.setStatus(message);
  window.PO.state.transientTimer = setTimeout(function () {
    window.PO.refreshSelectionStatus();
  }, 1500);
};

window.PO.refreshSelectionStatus = async function () {
  window.PO.clearTransientTimer();
  try {
    var bounds = await window.PO.getSelectionBounds();
    window.PO.setStatus(window.PO.formatSelectionBounds(bounds));
  } catch (error) {
    window.PO.setStatus(error instanceof Error ? error.message : String(error));
  }
};
