/* api-errors.js — v2 error normalization and Chinese error-code mapping
 *
 * Provides:
 *   normalizeApiError(error)  — map raw error to { code, userMessage, retryable, action, stage }
 *   ERROR_MESSAGES_ZH         — Chinese error code → user message mapping
 */

window.PO = window.PO || {};

window.PO.ApiErrors = (function () {
  "use strict";

  /* ── Chinese error messages ── */
  var ERROR_MESSAGES_ZH = {
    REQUEST_SCHEMA_INVALID:    "请求参数格式错误",
    CAPABILITY_NOT_FOUND:      "能力不存在或已停用",
    ASSET_NOT_FOUND:           "上传素材已过期，请重新捕获",
    DOCUMENT_STATE_CONFLICT:   "文档状态已变化，结果无法自动回填",
    INPUT_MASK_REQUIRED:       "此功能需要编辑区域选区，请先选择要处理的区域",
    SUBJECT_NOT_FOUND:         "未能识别主体，请手动选择主体区域",
    POLICY_INPUT_UNSAFE:       "此输入不符合安全策略，操作被拒绝",
    MODEL_MISSING:             "所需模型文件缺失，请检查环境状态",
    NODE_MISSING:              "所需 ComfyUI 节点缺失，请检查环境状态",
    QUEUE_LIMIT_EXCEEDED:      "排队任务过多，请等待现有任务完成后再试",
    PIPELINE_FAILED:           "处理流程失败，请重试",
    ARTIFACT_INVALID:          "生成结果校验失败，请重试",
    COMFYUI_UNAVAILABLE:       "ComfyUI 不可用，请检查 ComfyUI 是否运行",
    COMFYUI_EXECUTION_FAILED:  "ComfyUI 执行失败",
    DISK_SPACE_LOW:            "磁盘空间不足，请清理后重试",
    GATEWAY_OFFLINE:           "网关未连接，请检查网关地址和网络",
    NETWORK_ERROR:             "网络请求失败，请检查连接",
    TIMEOUT:                   "请求超时，请重试",
    STORAGE_CORRUPT:           "本地存储数据损坏，已重置",
    UNKNOWN:                   "发生未知错误",
  };

  /* ── Suggested actions for each error ── */
  var ERROR_ACTIONS = {
    REQUEST_SCHEMA_INVALID:    "check-params",
    CAPABILITY_NOT_FOUND:      "refresh-capabilities",
    ASSET_NOT_FOUND:           "recapture",
    DOCUMENT_STATE_CONFLICT:   "manual-download",
    INPUT_MASK_REQUIRED:       "recapture-selection",
    SUBJECT_NOT_FOUND:         "provide-subject",
    POLICY_INPUT_UNSAFE:       "dismiss",
    MODEL_MISSING:             "open-environment",
    NODE_MISSING:              "open-environment",
    QUEUE_LIMIT_EXCEEDED:      "view-jobs",
    PIPELINE_FAILED:           "retry",
    ARTIFACT_INVALID:          "retry",
    COMFYUI_UNAVAILABLE:       "check-comfyui",
    COMFYUI_EXECUTION_FAILED:  "retry",
    DISK_SPACE_LOW:            "cleanup",
    GATEWAY_OFFLINE:           "check-gateway",
    NETWORK_ERROR:             "retry",
    TIMEOUT:                   "retry",
    STORAGE_CORRUPT:           "reset",
    UNKNOWN:                   "retry",
  };

  /* ── Retryable flags ── */
  var RETRYABLE_CODES = {
    PIPELINE_FAILED:           true,
    ARTIFACT_INVALID:          true,
    COMFYUI_UNAVAILABLE:       true,
    COMFYUI_EXECUTION_FAILED:  true,
    NETWORK_ERROR:             true,
    TIMEOUT:                   true,
    QUEUE_LIMIT_EXCEEDED:      false,
    DISK_SPACE_LOW:            false,
  };

  /* ── normalizeApiError ── */
  function normalizeApiError(error) {
    if (!error) {
      return {
        code: "UNKNOWN",
        userMessage: ERROR_MESSAGES_ZH.UNKNOWN,
        retryable: false,
        action: "retry",
        stage: "unknown",
      };
    }

    /* Already normalized */
    if (error._normalized) return error;

    /* Extract code from various error shapes */
    var code = error.code || error.errorCode || null;

    /* HTTP status → code mapping */
    if (!code && error.status) {
      switch (error.status) {
        case 400: code = "REQUEST_SCHEMA_INVALID"; break;
        case 404: code = error.message && error.message.indexOf("asset") !== -1 ? "ASSET_NOT_FOUND" : "CAPABILITY_NOT_FOUND"; break;
        case 409: code = "DOCUMENT_STATE_CONFLICT"; break;
        case 422: code = error.message && error.message.indexOf("mask") !== -1 ? "INPUT_MASK_REQUIRED" : "SUBJECT_NOT_FOUND"; break;
        case 424: code = error.message && error.message.indexOf("model") !== -1 ? "MODEL_MISSING" : "NODE_MISSING"; break;
        case 429: code = "QUEUE_LIMIT_EXCEEDED"; break;
        case 500: code = "PIPELINE_FAILED"; break;
        case 502: code = "COMFYUI_UNAVAILABLE"; break;
        case 507: code = "DISK_SPACE_LOW"; break;
        default:  code = "UNKNOWN"; break;
      }
    }

    /* Gateway offline detection */
    if (!code && error.message) {
      var msg = String(error.message).toLowerCase();
      if (msg.indexOf("fetch") !== -1 || msg.indexOf("network") !== -1 || msg.indexOf("econnrefused") !== -1) {
        code = "GATEWAY_OFFLINE";
      } else if (msg.indexOf("timeout") !== -1 || msg.indexOf("abort") !== -1) {
        code = "TIMEOUT";
      }
    }

    if (!code) code = "UNKNOWN";

    var userMessage = ERROR_MESSAGES_ZH[code] || ERROR_MESSAGES_ZH.UNKNOWN;

    /* Append detail if available and safe */
    if (error.details && typeof error.details === "string" && error.details.length < 200) {
      userMessage = userMessage + "：" + error.details;
    }

    return {
      code: code,
      userMessage: userMessage,
      retryable: RETRYABLE_CODES[code] === true,
      action: ERROR_ACTIONS[code] || "retry",
      stage: error.stage || "unknown",
      correlationId: error.correlationId || null,
      _normalized: true,
      _original: error,
    };
  }

  return {
    ERROR_MESSAGES_ZH: ERROR_MESSAGES_ZH,
    normalizeApiError: normalizeApiError,
  };
})();
