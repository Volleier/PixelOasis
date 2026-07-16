/* error-normalizer.js — Map ComfyUI errors to v2 standardized error codes
 *
 * GatewayOrchestrationDesign §7.7: strips Python tracebacks, keeps
 * node title and human-readable message. Never exposes raw stacks.
 */

const ERROR_MAP = [
  /* Pattern → { code, userMessage, retryable } */
  { pattern: /Cannot find model/i,       code: "MODEL_MISSING",         userMessage: "模型文件缺失",         retryable: false },
  { pattern: /Cannot find node/i,        code: "NODE_MISSING",          userMessage: "自定义节点缺失",       retryable: false },
  { pattern: /OutOfMemory|OOM|CUDA out/i,code: "COMFYUI_EXECUTION_FAILED", userMessage: "显存不足，请降低分辨率或切换配置档", retryable: true },
  { pattern: /timed?[\s-]?out/i,         code: "COMFYUI_EXECUTION_FAILED", userMessage: "生成超时",             retryable: true },
  { pattern: /connection refused|ECONNREFUSED|unreachable/i, code: "COMFYUI_UNAVAILABLE", userMessage: "ComfyUI 不可用", retryable: true },
  { pattern: /HTTP\s*5\d{2}/i,          code: "COMFYUI_UNAVAILABLE",   userMessage: "ComfyUI 服务异常",     retryable: true },
  { pattern: /HTTP\s*4\d{2}/i,          code: "REQUEST_SCHEMA_INVALID", userMessage: "请求参数错误",           retryable: false },
  { pattern: /validation/i,              code: "REQUEST_SCHEMA_INVALID", userMessage: "工作流验证失败",         retryable: false },
  { pattern: /no output/i,               code: "ARTIFACT_INVALID",      userMessage: "生成无输出",             retryable: false },
  { pattern: /interrupted|cancelled|canceled/i, code: "JOB_CANCELED",  userMessage: "任务已取消",             retryable: false },
];

export function normalize(error) {
  if (!error) return { code: "UNKNOWN", userMessage: "未知错误", retryable: false, stage: "unknown", nodeTitle: null };

  /* Already normalized */
  if (error._v2Normalized) return error;

  const message = (error.message || String(error)).replace(/\n.*/s, ""); /* First line only, strip tracebacks */
  const nodeTitle = error.nodeTitle || error.node_title || _extractNodeTitle(error);

  for (const mapping of ERROR_MAP) {
    if (mapping.pattern.test(message)) {
      return {
        code: mapping.code,
        userMessage: mapping.userMessage,
        retryable: mapping.retryable,
        stage: "comfyui",
        nodeTitle,
        originalMessage: message,
        _v2Normalized: true,
      };
    }
  }

  return {
    code: "COMFYUI_EXECUTION_FAILED",
    userMessage: "ComfyUI 执行失败",
    retryable: true,
    stage: "comfyui",
    nodeTitle,
    originalMessage: message,
    _v2Normalized: true,
  };
}

function _extractNodeTitle(error) {
  try {
    /* ComfyUI errors sometimes include node info */
    if (error.details && error.details.node_title) return error.details.node_title;
    if (error.node_errors) {
      const keys = Object.keys(error.node_errors);
      if (keys.length > 0) return "Node #" + keys[0];
    }
  } catch (_) {}
  return null;
}

export default { normalize };
