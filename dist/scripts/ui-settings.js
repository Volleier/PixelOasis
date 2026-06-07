window.PO = window.PO || {};

window.PO.toggleSettings = function () {
  var state = window.PO.state;
  var els = window.PO.elements;

  state.settingsOpen = !state.settingsOpen;

  if (state.settingsOpen) {
    els.settingsOverlay.hidden = false;
    els.settingsDrawer.hidden = false;
    els.settingsDrawer.setAttribute("aria-hidden", "false");
  } else {
    els.settingsOverlay.hidden = true;
    els.settingsDrawer.hidden = true;
    els.settingsDrawer.setAttribute("aria-hidden", "true");
  }
};

window.PO.initSettings = function () {
  var els = window.PO.elements;

  els.settingsButton.addEventListener("click", window.PO.toggleSettings);

  els.settingsOverlay.addEventListener("click", function () {
    if (window.PO.state.settingsOpen) {
      window.PO.toggleSettings();
    }
  });

  els.themeToggleButton.addEventListener("click", function () {
    var state = window.PO.state;
    state.themePressed = !state.themePressed;
    els.themeToggleButton.setAttribute(
      "aria-pressed",
      state.themePressed ? "true" : "false",
    );
    window.PO.showTransientStatus("theme toggle clicked");
  });

  /* Gateway URL — save on change */
  if (els.gatewayUrlInput) {
    els.gatewayUrlInput.value = window.PO.state.gatewayUrl || "http://127.0.0.1:8787";
    els.gatewayUrlInput.addEventListener("change", function () {
      var val = els.gatewayUrlInput.value.trim();
      if (val) {
        window.PO.state.gatewayUrl = val;
        window.PO.showTransientStatus("网关地址已更新");
      }
    });
  }
};
