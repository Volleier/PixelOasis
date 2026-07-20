/* pipelines/definitions/all-pipelines.js — All 27 capability pipeline definitions
 *
 * Stages 6-7: complete pipeline definitions organized by capability family.
 * Each pipeline is a sequence of runners: image → comfyui → qualityGate → artifact.
 */

import { definePipeline } from "../registry.js";

/* ═══════════════════════════════════════════════════════════════════
 * Particle / light effects family (6 capabilities)
 * ═══════════════════════════════════════════════════════════════════ */

definePipeline("desert-sandstorm-v1", [
  { name: "resize",       runner: "image",  config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "sandstorm",    runner: "comfyui", config: { workflow: "desert-qwen-quality" } },
  { name: "dimensions",   runner: "qualityGate", config: { gate: "dimensions" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("black-smoke-v1", [
  { name: "smokeGen",     runner: "comfyui", config: { workflow: "smoke-dust-quality", timeoutMs: 600000 } },
  { name: "blank",        runner: "qualityGate", config: { gate: "blankOrCorrupt" } },
  { name: "dimensions",   runner: "qualityGate", config: { gate: "dimensions" } },
]);

definePipeline("water-sparkle-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "sparkle",      runner: "comfyui", config: { workflow: "water-sparkle-quality" } },
  { name: "blank",        runner: "qualityGate", config: { gate: "blankOrCorrupt" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("lightning-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "lightning",    runner: "comfyui", config: { workflow: "lightning-quality" } },
  { name: "dimensions",   runner: "qualityGate", config: { gate: "dimensions" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("sparks-debris-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "sparks",       runner: "comfyui", config: { workflow: "sparks-debris-quality" } },
  { name: "blank",        runner: "qualityGate", config: { gate: "blankOrCorrupt" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("bullet-storm-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "bullets",      runner: "comfyui", config: { workflow: "bullet-storm-quality" } },
  { name: "dimensions",   runner: "qualityGate", config: { gate: "dimensions" } },
  { name: "package",      runner: "artifact", config: {} },
]);

/* ═══════════════════════════════════════════════════════════════════
 * Studio / cleanup / composite family (6 capabilities)
 * ═══════════════════════════════════════════════════════════════════ */

definePipeline("quick-cleanup-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "cleanup",      runner: "comfyui", config: { workflow: "cleanup-grade-quality" } },
  { name: "blank",        runner: "qualityGate", config: { gate: "blankOrCorrupt" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("white-studio-v1", [
  { name: "segment",      runner: "comfyui", config: { workflow: "subject-birefnet" } },
  { name: "decontaminate",runner: "image",   config: { operation: "decontaminateAlpha" } },
  { name: "backdrop",     runner: "image",   config: { operation: "alphaCompose" } },
  { name: "relight",      runner: "comfyui", config: { workflow: "studio-relight-quality" } },
  { name: "seam",         runner: "qualityGate", config: { gate: "seam" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("light-blend-v1", [
  { name: "colorMatch",   runner: "image",   config: { operation: "colorMatch" } },
  { name: "relight",      runner: "comfyui", config: { workflow: "light-blend-quality" } },
  { name: "dimensions",   runner: "qualityGate", config: { gate: "dimensions" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("dimensionalize-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "dimensional",  runner: "comfyui", config: { workflow: "dimensionalize-quality" } },
  { name: "dimensions",   runner: "qualityGate", config: { gate: "dimensions" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("full-cleanup-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "cleanup",      runner: "comfyui", config: { workflow: "full-cleanup-quality" } },
  { name: "seam",         runner: "qualityGate", config: { gate: "seam" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("fufu-dolls-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "dolls",        runner: "comfyui", config: { workflow: "fufu-dolls-quality" } },
  { name: "blank",        runner: "qualityGate", config: { gate: "blankOrCorrupt" } },
  { name: "package",      runner: "artifact", config: {} },
]);

/* ═══════════════════════════════════════════════════════════════════
 * Portrait family (5 capabilities)
 * ═══════════════════════════════════════════════════════════════════ */

definePipeline("impasto-makeup-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1024, height: 1024 } },
  { name: "makeup",       runner: "comfyui", config: { workflow: "impasto-makeup-quality" } },
  { name: "blank",        runner: "qualityGate", config: { gate: "blankOrCorrupt" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("impasto-eyes-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1024, height: 1024 } },
  { name: "eyes",         runner: "comfyui", config: { workflow: "impasto-eyes-quality" } },
  { name: "blank",        runner: "qualityGate", config: { gate: "blankOrCorrupt" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("masculine-face-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1024, height: 1024 } },
  { name: "face",         runner: "comfyui", config: { workflow: "masculine-face-quality" } },
  { name: "blank",        runner: "qualityGate", config: { gate: "blankOrCorrupt" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("bust-enhance-v1", [
  { name: "policy",       runner: "policy",  config: { check: "adultConfirmation" } },
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1024, height: 1024 } },
  { name: "enhance",      runner: "comfyui", config: { workflow: "bust-enhance-quality" } },
  { name: "blank",        runner: "qualityGate", config: { gate: "blankOrCorrupt" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("garment-repair-v1", [
  { name: "policy",       runner: "policy",  config: { check: "adultConfirmation" } },
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1024, height: 1024 } },
  { name: "repair",       runner: "comfyui", config: { workflow: "garment-repair-quality" } },
  { name: "seam",         runner: "qualityGate", config: { gate: "seam" } },
  { name: "package",      runner: "artifact", config: {} },
]);

/* ═══════════════════════════════════════════════════════════════════
 * Hair family (4 capabilities)
 * ═══════════════════════════════════════════════════════════════════ */

definePipeline("handdrawn-long-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "hair",         runner: "comfyui", config: { workflow: "handdrawn-long-quality" } },
  { name: "blank",        runner: "qualityGate", config: { gate: "blankOrCorrupt" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("hair-beautify-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1024, height: 1024 } },
  { name: "beautify",     runner: "comfyui", config: { workflow: "hair-beautify-quality" } },
  { name: "seam",         runner: "qualityGate", config: { gate: "seam" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("hair-strands-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1024, height: 1024 } },
  { name: "strands",      runner: "comfyui", config: { workflow: "hair-strands-quality" } },
  { name: "blank",        runner: "qualityGate", config: { gate: "blankOrCorrupt" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("hair-windflow-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1024, height: 1024 } },
  { name: "windflow",     runner: "comfyui", config: { workflow: "hair-windflow-quality" } },
  { name: "blank",        runner: "qualityGate", config: { gate: "blankOrCorrupt" } },
  { name: "package",      runner: "artifact", config: {} },
]);

/* ═══════════════════════════════════════════════════════════════════
 * Lighting / cleanup family (6 capabilities)
 * ═══════════════════════════════════════════════════════════════════ */

definePipeline("flash-rim-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "rim",          runner: "comfyui", config: { workflow: "flash-rim-quality" } },
  { name: "dimensions",   runner: "qualityGate", config: { gate: "dimensions" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("remove-support-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "remove",       runner: "comfyui", config: { workflow: "remove-support-quality" } },
  { name: "maskCoverage", runner: "qualityGate", config: { gate: "maskCoverage" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("underlight-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "underlight",   runner: "comfyui", config: { workflow: "underlight-quality" } },
  { name: "dimensions",   runner: "qualityGate", config: { gate: "dimensions" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("remove-gear-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "remove",       runner: "comfyui", config: { workflow: "remove-gear-quality" } },
  { name: "seam",         runner: "qualityGate", config: { gate: "seam" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("lighting-enhance-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "enhance",      runner: "comfyui", config: { workflow: "lighting-enhance-quality" } },
  { name: "dimensions",   runner: "qualityGate", config: { gate: "dimensions" } },
  { name: "package",      runner: "artifact", config: {} },
]);

definePipeline("backlight-v1", [
  { name: "resize",       runner: "image",   config: { operation: "resizeProxy", width: 1280, height: 1280 } },
  { name: "backlight",    runner: "comfyui", config: { workflow: "backlight-quality" } },
  { name: "dimensions",   runner: "qualityGate", config: { gate: "dimensions" } },
  { name: "package",      runner: "artifact", config: {} },
]);

/* Auto-load on import */
