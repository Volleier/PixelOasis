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
  /* 08 */ "scripts/capture/capture-utils.js",
  /* 09 */ "scripts/capture/document-capture.js",
  /* 10 */ "scripts/capture/selection-capture.js",
  /* 11 */ "scripts/capture/subject-capture.js",
  /* 12 */ "scripts/capabilities/preflight.js",
  /* 13 */ "scripts/capabilities/parameter-form.js",
  /* 14 */ "scripts/vendor/png-encoder.js",
  /* 15 */ "scripts/gateway-client.js",
  /* 16 */ "scripts/photoshop.js",
  /* 17 */ "scripts/photoshop-place-layer.js",
  /* 18 */ "scripts/placement-engine.js",
  /* 19 */ "scripts/ui/capability-sections.js",
  /* 20 */ "scripts/ui/parameter-panel.js",
  /* 21 */ "scripts/ui-status.js",
  /* 22 */ "scripts/ui-preview.js",
  /* 23 */ "scripts/ui-settings.js",
  /* 24 */ "scripts/ui-workflows.js",
  /* 25 */ "scripts/ui-parameters.js",
  /* 26 */ "scripts/capabilities/capability-controller.js",
  /* 27 */ "scripts/api/gateway-v2-client.js",
  /* 28 */ "scripts/capture/asset-uploader.js",
  /* 29 */ "scripts/jobs/job-store.js",
  /* 30 */ "scripts/jobs/job-events.js",
  /* 31 */ "scripts/jobs/job-controller.js",
  /* 32 */ "scripts/placement/artifact-downloader.js",
  /* 33 */ "scripts/placement/artifact-placer.js",
  /* 34 */ "scripts/placement/mask-placer.js",
  /* 35 */ "scripts/placement/layer-metadata.js",
  /* 36 */ "scripts/placement/result-group.js",
  /* 37 */ "scripts/ui/progress-panel.js",
  /* 38 */ "scripts/ui/result-panel.js",
  /* 39 */ "scripts/ui-template.js",
  /* 40 */ "scripts/actions.js",
  /* 41 */ "index.js",
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
