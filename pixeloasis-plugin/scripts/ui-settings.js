window.PO = window.PO || {};

window.PO.toggleSettings = function () {
  var state = window.PO.state;
  var els = window.PO.elements;

  state.settingsOpen = !state.settingsOpen;

  if (state.settingsOpen) {
    els.settingsOverlay.hidden = false;
    els.settingsDrawer.hidden = false;
    els.settingsDrawer.setAttribute("aria-hidden", "false");
    window.PO.showTransientStatus("settings opened");
  } else {
    els.settingsOverlay.hidden = true;
    els.settingsDrawer.hidden = true;
    els.settingsDrawer.setAttribute("aria-hidden", "true");
    window.PO.showTransientStatus("settings closed");
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
};
