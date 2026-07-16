window.PO = window.PO || {};

/* ui-template.js — v2 static HTML template
 *
 * In v2, the template is built by CapabilitySections.renderApp() using
 * DOM API.  This file keeps buildTemplate() as the entry point that
 * index.js calls, and it delegates to CapabilitySections.renderApp().
 *
 * The old v1 buildSections() and renderWorkflowButtons() are kept for
 * backward compatibility but are no longer called by the v2 startup path.
 */

/* ── Legacy v1: render workflow buttons (kept for backward compat) ── */
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

/* ── Legacy v1: build sections (kept for backward compat) ── */
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

/* ── v2 buildTemplate — delegates to CapabilitySections.renderApp() ── */
window.PO.buildTemplate = function () {
  var appRoot = document.getElementById("app");
  if (!appRoot) return "";

  /* If CapabilitySections is loaded (v2 path), use DOM API */
  if (window.PO.CapabilitySections && window.PO.CapabilitySections.renderApp) {
    window.PO.CapabilitySections.renderApp(appRoot);
    return ""; /* renderApp already populated the DOM */
  }

  /* Fallback: v1 template (used when v2 modules aren't loaded) */
  var TEXT = window.PO.TEXT;
  return [
    '<div class="po-root">',
    '<main class="po-main">',
    '<div class="po-main-scroll">',
    window.PO.buildSections(),
    "</div>",
    "</main>",
    '<section class="po-preview">',
    '<div class="po-preview__viewport">',
    '<img id="preview-image" class="po-preview__image" alt="selection preview" />',
    '<div id="preview-empty" class="po-preview__empty">' + TEXT.previewEmpty + "</div>",
    "</div>",
    "</section>",
    '<footer class="po-bottom-bar">',
    '<div id="status" class="po-status">' + TEXT.ready + "</div>",
    '<button id="settings-btn" class="po-bottom-button" type="button">' + TEXT.settings + "</button>",
    "</footer>",
    '<div id="settings-overlay" class="po-settings-overlay" hidden></div>',
    '<aside id="settings-drawer" class="po-settings-drawer" hidden>',
    '<div class="po-settings-drawer__body">',
    '<div class="po-setting-group">',
    '<label class="po-setting-row__label" for="gateway-url-input">' + TEXT.gatewayUrlLabel + "</label>",
    '<input id="gateway-url-input" class="po-settings-url-input" type="text" placeholder="' + TEXT.gatewayUrlPlaceholder + '" />',
    "</div>",
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
    window.PO.buildParameterPage ? window.PO.buildParameterPage() : "",
    "</div>",
  ].join("");
};
