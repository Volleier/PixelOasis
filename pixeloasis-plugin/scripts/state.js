window.PO = window.PO || {};

/* v2 state structure (roadmap §4.1).
 * v1 backward-compat fields (capture, gatewayUrl, settingsOpen, etc.) are
 * kept as aliases where safe, but the canonical locations are the nested objects. */

window.PO.state = {
  /* ── v2: gateway ── */
  gateway: {
    baseUrl: "http://127.0.0.1:8787",
    health: "unknown",   /* unknown | online | offline */
    apiVersion: null,
  },

  /* ── v2: capabilities ── */
  capabilities: {
    status: "idle",       /* idle | loading | ready | error */
    revision: null,
    items: [],
    filteredIds: [],
    error: null,
  },

  /* ── v2: favorites (mirror of FavoritesStore state) ── */
  favorites: {
    ids: [],
    tombstones: {},
  },

  /* ── v2: capture ── */
  capture: {
    status: "idle",       /* idle | capturing | ready | error */
    active: null,         /* capture session object; released after upload/close */
    preview: null,        /* small JPEG preview */
  },

  /* ── v2: parameter panel ── */
  parameterPanel: {
    open: false,
    capabilityId: null,
    draft: {},
    validation: {},
  },

  /* ── v2: jobs ── */
  jobs: {
    byId: {},
    activeIds: [],
    selectedJobId: null,
  },

  /* ── v2: UI transient state ── */
  ui: {
    search: "",
    collapsedSections: {},
    settingsOpen: false,
    activeOverlay: null,
  },

  /* ── Shared ── */
  transientTimer: null,

  /* ── Logging config ── */
  logging: {
    enabled: true,
    level: "info",
    maxFileBytes: 1024 * 1024,
    retainFiles: 5,
    logPromptText: false,
  },

  /* ── v1 backward-compat: flat aliases (some v1 code still reads these) ── */
  get settingsOpen() { return this.ui.settingsOpen; },
  set settingsOpen(v) { this.ui.settingsOpen = v; },

  get gatewayUrl() { return this.gateway.baseUrl; },
  set gatewayUrl(v) { this.gateway.baseUrl = v; },

  /* v1 'status' was a simple string; keep for legacy reads */
  status: "ready",
  themePressed: false,
};

window.PO.clearTransientTimer = function () {
  if (window.PO.state.transientTimer) {
    clearTimeout(window.PO.state.transientTimer);
    window.PO.state.transientTimer = null;
  }
};
