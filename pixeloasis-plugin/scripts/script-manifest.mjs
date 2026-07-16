/* PixelOasis v2 script manifest
 *
 * Single source of truth for script loading order.
 * Used by both prepare-udt-dist.mjs and tools/deploy-plugin.mjs.
 *
 * DO NOT reorder without updating index.html <script> tags to match.
 */

export const sourceScripts = [
  /* 01 */ "scripts/ui-text.js",
  /* 02 */ "scripts/state.js",
  /* 03 */ "scripts/logger.js",
  /* 04 */ "scripts/api/api-errors.js",
  /* 05 */ "scripts/capabilities/capability-labels.js",
  /* 06 */ "scripts/capabilities/favorites-store.js",
  /* 07 */ "scripts/capabilities/capability-store.js",
  /* 08 */ "scripts/vendor/png-encoder.js",
  /* 09 */ "scripts/gateway-client.js",
  /* 10 */ "scripts/photoshop.js",
  /* 11 */ "scripts/photoshop-place-layer.js",
  /* 12 */ "scripts/placement-engine.js",
  /* 13 */ "scripts/ui/capability-sections.js",
  /* 14 */ "scripts/ui-status.js",
  /* 15 */ "scripts/ui-preview.js",
  /* 16 */ "scripts/ui-settings.js",
  /* 17 */ "scripts/ui-workflows.js",
  /* 18 */ "scripts/ui-parameters.js",
  /* 19 */ "scripts/ui-template.js",
  /* 20 */ "scripts/actions.js",
  /* 21 */ "index.js",
];

export const vendorScripts = [
  "scripts/vendor/png-encoder.js",
];

export const rootFiles = [
  "index.html",
  "index.js",
  "panel.css",
  "manifest.json",
];

/* v1 legacy scripts — still loaded for backward compat but not part of v2 core */
export const legacyScripts = [
  "scripts/ui-workflows.js",
  "scripts/ui-parameters.js",
];
