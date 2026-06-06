window.PO = window.PO || {};

window.PO.state = {
  settingsOpen: false,
  themePressed: false,
  status: "ready",
  capture: null,
  transientTimer: null,
};

window.PO.clearTransientTimer = function () {
  if (window.PO.state.transientTimer) {
    clearTimeout(window.PO.state.transientTimer);
    window.PO.state.transientTimer = null;
  }
};
