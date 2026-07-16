window.PO = window.PO || {};

/* Simplified preview — image only, no metadata rows */
window.PO.updatePreview = function (capture) {
  window.PO.state.capture = capture;

  var els = window.PO.elements;
  if (!capture) {
    if (els.previewEmpty) els.previewEmpty.hidden = false;
    if (els.previewImage) {
      els.previewImage.hidden = true;
      els.previewImage.removeAttribute("src");
    }
    return;
  }

  if (els.previewImage) {
    els.previewImage.setAttribute(
      "src",
      window.PO.toDataUrl(capture.previewJpegBase64, "image/jpeg"),
    );
    els.previewImage.hidden = false;
  }
  if (els.previewEmpty) els.previewEmpty.hidden = true;
};

/* v2: render a small capture preview DOM element (used by parameter panel) */
window.PO.renderCapturePreview = function (capture) {
  if (!capture) return null;

  var container = document.createElement("div");
  container.className = "po-capture-preview";

  if (capture.preview) {
    var img = document.createElement("img");
    img.className = "po-capture-preview__thumb";
    img.src = window.PO.toDataUrl(capture.preview, "image/jpeg");
    img.alt = "选区预览";
    container.appendChild(img);
  }

  var info = document.createElement("div");
  info.className = "po-capture-preview__info";

  var bounds = capture.editBounds || capture.subjectBounds || capture.bounds;
  if (bounds) {
    info.textContent = bounds.width + " × " + bounds.height + " px";
  }
  if (capture.scope) {
    var scopeText = capture.scope === "document" ? "整图" :
                    capture.scope === "selection" ? "选区" :
                    capture.scope === "subject" ? "主体" : capture.scope;
    info.textContent = scopeText + " — " + info.textContent;
  }
  container.appendChild(info);

  return container;
};
