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

/* v2: update job count in status bar */
window.PO.setJobStatus = function (activeCount) {
  if (window.PO.CapabilitySections && window.PO.CapabilitySections.updateTaskLink) {
    window.PO.CapabilitySections.updateTaskLink(activeCount || 0);
  }
  var statusSuffix = activeCount > 0 ? " — " + activeCount + " 个任务运行中" : "";
  if (window.PO.elements && window.PO.elements.statusNode && window.PO.state.gateway) {
    var health = window.PO.state.gateway.health;
    if (health === "online") {
      window.PO.setStatus("网关就绪" + statusSuffix);
    }
  }
};
