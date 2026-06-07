window.PO = window.PO || {};

window.PO.state = {
  settingsOpen: false,
  themePressed: false,
  gatewayUrl: "http://127.0.0.1:8787",
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
