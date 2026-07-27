/* preflight.js — v2 capability preflight checks
 *
 * Runs BEFORE any capture.  Validates: active document, readiness, input
 * contract (selection/points), color mode, sensitive actions, and the
 * requiresConfirm rule.
 *
 * Provides:
 *   prepare(capability) → { passed, checks, requireAdultConfirm, ... }
 *   checkInputContract(capability) → { passed, error?, requiresSelection, ... }
 *   isSensitiveAction(capabilityId) → boolean
 *   confirmSensitive(capabilityId, documentId, sessionId) → token
 */

window.PO = window.PO || {};

window.PO.Preflight = (function () {
  "use strict";

  /* ── Sensitive capability IDs (require adult confirmation) ── */
  var SENSITIVE_IDS = {
    "portrait.bustEnhance":          true,
    "wardrobe.removeSafetyShorts":   true,
  };

  /* ── Selection-required capability IDs (input.editMask === "required") ── */
  function _requiresSelection(input) {
    if (!input) return false;
    if (input.source === "selection") return true;
    if (input.editMask === "required") return true;
    if (input.mask === "required") return true;
    return false;
  }

  /* ── Check if input requires subject ── */
  function _requiresSubject(input) {
    if (!input) return false;
    if (input.subjectMask === "required") return true;
    return false;
  }

  /* ── Check if input requires points ── */
  function _requiresPoints(input) {
    if (!input) return false;
    if (input.points === "two") return 2;
    return 0;
  }

  /* ═══════════════════════════════════════════════════════════════════
   * prepare(capability) → preflight result
   * ═══════════════════════════════════════════════════════════════════ */

  function prepare(capability) { return _prepareAsync(capability); }
  async function _prepareAsync(capability) {
    if (!capability) {
      return { passed: false, error: { code: "CAPABILITY_NOT_FOUND", userMessage: "能力不存在" } };
    }

    var checks = {};
    var warnings = [];
    var requireAdultConfirm = false;
    var requireSubjectChoice = false;

    /* ── 1. Active document ── */
    var docInfo = window.PO.CaptureUtils.getDocumentInfo();
    if (!docInfo) {
      return {
        passed: false,
        error: {
          code: "NO_DOCUMENT",
          userMessage: "请先打开一个 Photoshop 文档",
          action: "open-document",
        },
      };
    }
    checks.document = { passed: true, docInfo: docInfo };

    if (!window.PO.state || !window.PO.state.gateway || window.PO.state.gateway.health !== "online") {
      return {
        passed: false,
        error: {
          code: "COMFYUI_UNAVAILABLE",
          userMessage: "v2 模型网关不可用，请先启动并完成环境检查",
          action: "open-environment",
        },
      };
    }

    /* ── 2. Readiness ── */
    var avail = capability.availability;
    if (avail) {
      switch (avail.state) {
        case "missing_models":
          return {
            passed: false,
            error: {
              code: "MODEL_MISSING",
              userMessage: "所需模型文件缺失，请检查环境状态",
              action: "open-environment",
            },
          };
        case "missing_nodes":
          return {
            passed: false,
            error: {
              code: "NODE_MISSING",
              userMessage: "所需 ComfyUI 节点缺失，请检查环境状态",
              action: "open-environment",
            },
          };
        case "unsupported_hardware":
          return {
            passed: false,
            error: {
              code: "UNSUPPORTED_HARDWARE",
              userMessage: "当前设备显存不足，不支持此功能",
              action: "dismiss",
            },
          };
        case "degraded":
          warnings.push({
            type: "degraded",
            message: "兼容模式 — 使用降级配置，质量和速度可能受影响",
          });
          break;
        case "policy_disabled":
          return {
            passed: false,
            error: {
              code: "POLICY_DISABLED",
              userMessage: "此功能已被禁用",
              action: "dismiss",
            },
          };
      }
    }
    checks.readiness = { passed: true, state: avail ? avail.state : "ready" };

    /* ── 3. Input contract — selection ── */
    var needsSelection = _requiresSelection(capability.input);
    checks.selection = { passed: true, required: needsSelection };

    if (needsSelection) {
      /* Check actual Photoshop selection — NOT full-canvas fake */
      try {
        var selBounds = await window.PO.getSelectionBounds();
        if (!selBounds || selBounds.width <= 0 || selBounds.height <= 0) {
          return {
            passed: false,
            error: {
              code: "INPUT_MASK_REQUIRED",
              userMessage: "此功能需要编辑区域选区，请先选择要处理的区域",
              action: "recapture-selection",
            },
          };
        }
        /* Verify selection is real (not full-canvas) */
        var doc = window.require("photoshop").app.activeDocument;
        if (doc && selBounds.width === doc.width && selBounds.height === doc.height) {
          return {
            passed: false,
            error: {
              code: "INPUT_MASK_REQUIRED",
              userMessage: "请选择具体编辑区域，不能使用全画布选区",
              action: "recapture-selection",
            },
          };
        }
        checks.selection.found = true;
      } catch (e) {
        return {
          passed: false,
          error: {
            code: "INPUT_MASK_REQUIRED",
            userMessage: "此功能需要编辑区域选区，请先选择要处理的区域",
            action: "recapture-selection",
          },
        };
      }
    }

    /* ── 4. Input contract — subject ── */
    var needsSubject = _requiresSubject(capability.input);
    checks.subject = { passed: true, required: needsSubject };
    if (needsSubject) {
      requireSubjectChoice = true;
    }

    /* ── 4b. Occlusion guidance — when auto + no subjectMask ── */
    var hasSubjectMask = capability.input && capability.input.subjectMask === "optional";
    var hasSubjectSelection = hasSubjectMask ? await _checkRealSelection(docInfo) : false;
    if (hasSubjectMask && !hasSubjectSelection) {
      warnings.push({
        type: "occlusionInfo",
        message: "未检测到主体选区 — 将仅生成后景烟雾（occlusion=back）",
      });
    }

    /* ── 5. Input contract — points ── */
    var pointsRequired = _requiresPoints(capability.input);
    checks.points = { passed: true, required: pointsRequired };

    /* ── 6. Color mode ── */
    var conversionNeeded = window.PO.CaptureUtils.needsConversion(docInfo.mode, docInfo.bitDepth);
    checks.colorMode = { passed: true, conversionNeeded: conversionNeeded };
    if (conversionNeeded) {
      if (!window.PO.CaptureUtils.isConversionSafe(docInfo.mode, docInfo.bitDepth)) {
        return {
          passed: false,
          error: {
            code: "COLOR_MODE_UNSUPPORTED",
            userMessage: "文档色彩模式不支持（" + docInfo.mode + " " + docInfo.bitDepth + "-bit）",
            action: "dismiss",
          },
        };
      }
      warnings.push({
        type: "colorConversion",
        message: "文档色彩模式将转换为 sRGB 8-bit 处理",
      });
    }

    /* ── 7. Sensitive actions ── */
    if (isSensitiveAction(capability.id)) {
      requireAdultConfirm = true;
      checks.sensitive = { passed: false, requiresConfirm: true };
    } else {
      checks.sensitive = { passed: true, requiresConfirm: false };
    }

    /* ── 8. requiresConfirm — default true (roadmap §1.2) ── */
    var requiresConfirm = true;
    if (capability.ui && typeof capability.ui.requiresConfirm === "boolean") {
      requiresConfirm = capability.ui.requiresConfirm;
    }
    checks.requiresConfirm = { passed: true, value: requiresConfirm };

    return {
      passed: true,
      checks: checks,
      warnings: warnings,
      requireAdultConfirm: requireAdultConfirm,
      requireSubjectChoice: requireSubjectChoice,
      hasSubjectSelection: hasSubjectSelection,
      requiresSelection: needsSelection,
      pointsRequired: pointsRequired,
    };
  }

  /* ── Check for real (non-full-canvas) selection ── */
  async function _checkRealSelection(docInfo) {
    try {
      var photoshop = window.require("photoshop");
      var doc = photoshop.app.activeDocument;
      if (!doc) return false;

      var selection = await window.PO.getSelectionBounds();
      if (!selection || selection.width <= 0 || selection.height <= 0) return false;
      return !(selection.left === 0 && selection.top === 0 &&
        selection.width === docInfo.width && selection.height === docInfo.height);
    } catch (e) {
      return false;
    }
  }

  /* ── Check if it's a sensitive action ── */
  function isSensitiveAction(capabilityId) {
    return SENSITIVE_IDS[capabilityId] === true;
  }

  /* ── Generate adult confirmation token (session-only, not persisted) ── */
  var _sensitiveTokens = {};
  function confirmSensitive(capabilityId, documentId, sessionId) {
    var key = capabilityId + ":" + (documentId || "0") + ":" + (sessionId || "0");
    var token = {
      confirmedAt: Date.now(),
      capabilityId: capabilityId,
      documentId: documentId,
      sessionId: sessionId,
    };
    _sensitiveTokens[key] = token;
    return token;
  }

  /* ── Check if sensitive action was confirmed for current context ── */
  function isSensitiveConfirmed(capabilityId, documentId, sessionId) {
    var key = capabilityId + ":" + (documentId || "0") + ":" + (sessionId || "0");
    return !!_sensitiveTokens[key];
  }

  /* ── Check input contract (standalone) ── */
  function checkInputContract(capability) {
    if (!capability) return { passed: false };
    var input = capability.input || {};
    return {
      passed: true,
      requiresSelection: _requiresSelection(input),
      requiresSubject: _requiresSubject(input),
      requiresPoints: _requiresPoints(input),
      source: input.source || "document",
    };
  }

  return {
    prepare:             prepare,
    checkInputContract:  checkInputContract,
    isSensitiveAction:   isSensitiveAction,
    confirmSensitive:    confirmSensitive,
    isSensitiveConfirmed: isSensitiveConfirmed,
  };
})();
