/* v1-workflow-map.js — v1→v2 migration bridge (short-term)
 *
 * Maps old v1 workflowId values to new v2 capabilityId values.
 * Used only during the migration period — removed after two release
 * cycles with zero v1 calls.
 *
 * Provides:
 *   getV2CapabilityId(v1WorkflowId) → capabilityId | null
 *   getV1MigrationStats() → { total, mapped, unmapped }
 */

window.PO = window.PO || {};

window.PO.V1MigrationMap = (function () {
  "use strict";

  /* ── V1 workflowId → V2 capabilityId mapping ── */
  var V1_TO_V2_MAP = {
    /* Composition tools */
    "composition.inpaint.pro":    "scene.quickCleanupGrade",
    "composition.inpaint.basic":  "scene.quickCleanupGrade",
    "composition.remove.pro":     "cleanup.removeLightingGear",
    "composition.remove.local":   "cleanup.removeSupport",
    "composition.remove.basic":   "cleanup.removeSupport",
    "composition.outpaint.basic": null, /* No v2 equivalent — dropped */

    /* Quality tools */
    "quality.realism.pro":        "lighting.enhance",
    "quality.realism-enhance.basic": "lighting.enhance",
    "quality.upscale.basic":      null, /* Not real upscale — dropped */

    /* Portrait */
    "portrait.skin-retouch.basic": "portrait.impastoMakeup",

    /* Lighting */
    "lighting.relight.basic":      "lighting.underlight",

    /* Effects */
    "effects.style-transfer.basic": "scene.lightBlend",
  };

  /* ── Lookup ── */
  function getV2CapabilityId(v1WorkflowId) {
    if (!v1WorkflowId || typeof v1WorkflowId !== "string") return null;
    var mapped = V1_TO_V2_MAP[v1WorkflowId];
    return mapped || null; /* Explicit null = deliberately unmapped */
  }

  /* ── Migration stats ── */
  function getV1MigrationStats() {
    var keys = Object.keys(V1_TO_V2_MAP);
    var total = keys.length;
    var mapped = 0;
    var unmapped = 0;

    for (var i = 0; i < keys.length; i++) {
      if (V1_TO_V2_MAP[keys[i]]) {
        mapped++;
      } else {
        unmapped++;
      }
    }

    return { total: total, mapped: mapped, unmapped: unmapped };
  }

  return {
    V1_TO_V2_MAP:         V1_TO_V2_MAP,
    getV2CapabilityId:    getV2CapabilityId,
    getV1MigrationStats:  getV1MigrationStats,
  };
})();
