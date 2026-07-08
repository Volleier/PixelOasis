window.PO = window.PO || {};

/* ── Render workflow buttons dynamically from the registry (ImplList §8.1) ── */
window.PO.renderWorkflowButtons = function (category) {
  var ids = window.PO.PHASE1_WORKFLOW_IDS || [];
  var html = ['<div class="po-action-row">'];

  for (var i = 0; i < ids.length; i++) {
    var wf = window.PO.WORKFLOWS[ids[i]];
    var wfCategory = wf ? wf.category : ids[i].split(".")[0];
    if (category && wfCategory !== category) continue;
    var title = wf ? wf.title : ids[i];
    html.push(
      '<button class="po-button" type="button" data-workflow="' +
      ids[i] + '">' + title + '</button>'
    );
  }

  html.push('</div>');
  return html.join("");
};

window.PO.buildSections = function () {
  var TEXT = window.PO.TEXT;

  function sectionBody(section) {
    if (section.id === "composition") {
      return window.PO.renderWorkflowButtons("composition");
    }
    if (section.id === "quality") {
      return window.PO.renderWorkflowButtons("quality");
    }
    return '<div class="po-section__placeholder">' + section.hint + "</div>";
  }

  return TEXT.sections
    .map(function (section) {
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
        sectionBody(section),
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

    /* ── 设置区 (overlay + drawer) ── */
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

    /* Log settings */
    '<div class="po-setting-group">',
    '<div class="po-setting-row">',
    '<span class="po-setting-row__label">日志记录</span>',
    '<button id="log-toggle-btn" class="po-toggle" type="button" aria-pressed="true">',
    '<span class="po-toggle__thumb"></span>',
    "</button>",
    "</div>",
    '<button id="log-open-btn" class="po-button po-button--secondary" type="button" style="margin-top:8px;width:100%;">打开日志</button>',
    "</div>",

    "</div>",
    "</aside>",

    /* ── 参数页 (full-screen overlay) ── */
    window.PO.buildParameterPage ? window.PO.buildParameterPage() : "",

    "</div>",
  ].join("");
};
