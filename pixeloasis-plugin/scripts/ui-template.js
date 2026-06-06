window.PO = window.PO || {};

window.PO.buildSections = function () {
  var TEXT = window.PO.TEXT;
  return TEXT.sections
    .map(function (section) {
      var actionMarkup =
        section.id === "composition"
          ? [
              '<div class="po-action-row">',
              '<button id="tool-btn" class="po-button" type="button">' + TEXT.selectRectTool + "</button>",
              '<button id="capture-btn" class="po-button po-button--secondary" type="button">' + TEXT.captureSelection + "</button>",
              "</div>",
            ].join("")
          : '<div class="po-section__placeholder">' + section.hint + "</div>";

      return [
        '<section class="po-section" data-section="',
        section.id,
        '">',
        '<div class="po-section__header">',
        '<h2 class="po-section__title">',
        section.title,
        "</h2>",
        "</div>",
        '<div class="po-section__body">',
        actionMarkup,
        "</div>",
        "</section>",
      ].join("");
    })
    .join("");
};

window.PO.buildTemplate = function () {
  var TEXT = window.PO.TEXT;
  return [
    '<div class="po-root">',

    /* ── Main content ── */
    '<main class="po-main">',
    '<div class="po-main-scroll">',
    window.PO.buildSections(),
    "</div>",
    "</main>",

    /* ── Preview area (in normal flow, below main) ── */
    '<section class="po-preview">',
    '<div class="po-preview__viewport">',
    '<img id="preview-image" class="po-preview__image" alt="selection preview" />',
    '<div id="preview-empty" class="po-preview__empty">' + TEXT.previewEmpty + "</div>",
    "</div>",
    "</section>",

    /* ── Bottom bar ── */
    '<footer class="po-bottom-bar">',
    '<div id="status" class="po-status">' + TEXT.ready + "</div>",
    '<button id="settings-btn" class="po-bottom-button" type="button">' + TEXT.settings + "</button>",
    "</footer>",

    /* ── 设置区 (overlay + drawer, root-level, covers main + preview) ── */
    '<div id="settings-overlay" class="po-settings-overlay" hidden></div>',
    '<aside id="settings-drawer" class="po-settings-drawer" hidden>',
    '<div class="po-settings-drawer__body">',
    '<div class="po-setting-row">',
    '<div class="po-setting-copy">',
    '<div class="po-setting-row__label">' + TEXT.themeMode + "</div>",
    '<div class="po-setting-row__hint">' + TEXT.themeHint + "</div>",
    "</div>",
    '<button id="theme-toggle-btn" class="po-toggle" type="button" aria-pressed="false">',
    '<span class="po-toggle__thumb"></span>',
    "</button>",
    "</div>",

    /* Gateway URL */
    '<div class="po-setting-group">',
    '<label class="po-setting-row__label" for="gateway-url-input">' + TEXT.gatewayUrlLabel + "</label>",
    '<input id="gateway-url-input" class="po-settings-url-input" type="text" placeholder="' + TEXT.gatewayUrlPlaceholder + '" />',
    "</div>",

    "</div>",
    "</aside>",

    /* ── 参数页 (full-screen overlay, covers main + preview, not bottom bar) ── */
    window.PO.buildParameterPage ? window.PO.buildParameterPage() : "",

    "</div>",
  ].join("");
};
