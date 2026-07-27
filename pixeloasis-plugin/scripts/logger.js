/* logger.js — PixelOasis plugin-side compatibility stub
 *
 * All operational logging is now handled exclusively by the model-gateway.
 * This module preserves the window.PO.Logger API as no-op stubs so existing
 * call sites do not throw. No files are created in the UXP data folder.
 *
 * API (all no-op):
 *   window.PO.Logger.debug(event, opts)
 *   window.PO.Logger.info(event, opts)
 *   window.PO.Logger.warn(event, opts)
 *   window.PO.Logger.error(event, opts)
 */

window.PO = window.PO || {};

window.PO.Logger = (function () {
  "use strict";

  function debug(event, opts) { /* no-op — gateway is the sole log writer */ }
  function info(event, opts)  { /* no-op */ }
  function warn(event, opts)  { /* no-op */ }
  function errorLog(event, opts) { /* no-op */ }

  async function clearLogs() { /* no-op */ }
  async function getLogPath() { return "(gateway-managed)"; }
  async function getLogFilePath() { return "(gateway-managed)"; }
  async function exportRecent(maxLines) { return ""; }

  return {
    debug: debug,
    info: info,
    warn: warn,
    error: errorLog,
    clearLogs: clearLogs,
    getLogPath: getLogPath,
    getLogFilePath: getLogFilePath,
    exportRecent: exportRecent,
  };
})();
