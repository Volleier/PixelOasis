window.PO = window.PO || {};

/* Simplified preview — image only, no metadata rows */
window.PO.updatePreview = function (capture) {
  window.PO.state.capture = capture;

  var els = window.PO.elements;
  if (!capture) {
    els.previewEmpty.hidden = false;
    els.previewImage.hidden = true;
    els.previewImage.removeAttribute("src");
    return;
  }

  els.previewImage.setAttribute(
    "src",
    window.PO.toDataUrl(capture.previewJpegBase64, "image/jpeg"),
  );
  els.previewImage.hidden = false;
  els.previewEmpty.hidden = true;
};
