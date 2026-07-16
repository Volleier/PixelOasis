/* ws-client.js — WebSocket client for real-time ComfyUI progress
 *
 * Parses: execution_start, executing, progress, executed, execution_cached,
 * execution_error. Filters by promptId. Emits node-level callbacks for
 * started, progress (throttled 500ms/1%), completed, cached, failed.
 */

import { WebSocket } from "ws";
import config from "../../config.js";
import logger from "../../utils/logger.js";

const RECONNECT_BACKOFF = [1000, 2000, 5000, 10000, 30000];

export class ComfyUIWebSocket {
  constructor(promptId) {
    this._ws = null;
    this._clientId = null;
    this._promptId = promptId || null;
    this._callbacks = {
      progress: null, executed: null, error: null, start: null,
      onNodeStart: null, onNodeProgress: null, onNodeComplete: null,
      onNodeCached: null, onNodeFailed: null,
    };
    this._reconnectIdx = 0;
    this._shouldReconnect = false;
    this._nodeMap = {};           /* nodeId → { classType, title, stage } */
    this._nodeStartTimes = {};    /* nodeId → timestamp */
    this._lastProgressTime = {};  /* nodeId → last emit timestamp */
    this._lastProgressPct = {};   /* nodeId → last percentage */
  }

  /* ── Set node map for human-readable logging ── */
  setNodeMap(nodeMap) { this._nodeMap = nodeMap || {}; }

  connect(clientId) {
    this._clientId = clientId || ("po-" + Date.now().toString(36));
    this._shouldReconnect = true;
    this._reconnectIdx = 0;
    this._doConnect();
  }

  _doConnect() {
    const wsUrl = config.comfyui.baseUrl.replace("http://", "ws://").replace("https://", "wss://") + "/ws?clientId=" + this._clientId;

    try {
      this._ws = new WebSocket(wsUrl);
    } catch (e) {
      logger.warn("comfyui.ws_create_failed", { component: "ws-client", error: e });
      this._scheduleReconnect();
      return;
    }

    this._ws.on("open", () => {
      this._reconnectIdx = 0;
      logger.info("comfyui.ws_connected", { component: "ws-client", data: { clientId: this._clientId } });
    });

    this._ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        this._handleMessage(msg);
      } catch (e) { /* ignore malformed messages */ }
    });

    this._ws.on("error", (e) => {
      logger.warn("comfyui.ws_error", { component: "ws-client", error: e });
    });

    this._ws.on("close", () => {
      logger.info("comfyui.ws_closed", { component: "ws-client", data: { clientId: this._clientId } });
      this._ws = null;
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (!this._shouldReconnect) return;
    const delay = RECONNECT_BACKOFF[Math.min(this._reconnectIdx, RECONNECT_BACKOFF.length - 1)];
    this._reconnectIdx++;
    logger.info("comfyui.ws_reconnect", { component: "ws-client", data: { delayMs: delay, attempt: this._reconnectIdx } });
    setTimeout(() => { if (this._shouldReconnect) this._doConnect(); }, delay);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case "execution_start":
        if (this._promptId && msg.data && msg.data.prompt_id !== this._promptId) return;
        if (this._callbacks.start) this._callbacks.start(msg.data);
        break;

      case "executing": {
        if (!msg.data) break;
        /* Only process messages for our prompt */
        if (this._promptId && msg.data.prompt_id !== this._promptId) return;

        /* Node started */
        if (msg.data.node && this._callbacks.onNodeStart) {
          const nodeId = String(msg.data.node);
          const meta = this._nodeMap[nodeId] || {};
          this._nodeStartTimes[nodeId] = Date.now();
          this._callbacks.onNodeStart({
            nodeId: nodeId,
            classType: meta.classType || null,
            title: meta.title || null,
            displayNode: msg.data.display_node || null,
          });
        }

        /* Legacy progress callback */
        if (msg.data.node && msg.data.display_node && this._callbacks.progress) {
          this._callbacks.progress({ node: msg.data.node, display_node: msg.data.display_node });
        }
        break;
      }

      case "progress": {
        if (!msg.data || !this._callbacks.onNodeProgress) break;
        const { value, max, node: nodeId } = msg.data;
        if (!nodeId) break;
        const nodeKey = String(nodeId);
        const now = Date.now();
        const pct = max > 0 ? Math.round((value / max) * 100) : 0;

        /* Throttle: max every 500ms, min 1% change */
        const lastTime = this._lastProgressTime[nodeKey] || 0;
        const lastPct = this._lastProgressPct[nodeKey] !== undefined ? this._lastProgressPct[nodeKey] : -1;
        if (now - lastTime < 500 && pct - lastPct < 1) break;

        this._lastProgressTime[nodeKey] = now;
        this._lastProgressPct[nodeKey] = pct;

        if (this._callbacks.progress) this._callbacks.progress({ value, max });

        /* Also emit as node progress */
        const meta = this._nodeMap[nodeKey] || {};
        this._callbacks.onNodeProgress({
          nodeId: nodeKey,
          classType: meta.classType || null,
          progress: pct,
          value: value,
          max: max,
        });
        break;
      }

      case "executed": {
        if (!msg.data) break;
        if (this._promptId && msg.data.prompt_id !== this._promptId) return;

        const exeNodeId = msg.data.node ? String(msg.data.node) : null;
        if (exeNodeId && this._callbacks.onNodeComplete) {
          const meta = this._nodeMap[exeNodeId] || {};
          const startTime = this._nodeStartTimes[exeNodeId];
          this._callbacks.onNodeComplete({
            nodeId: exeNodeId,
            classType: meta.classType || null,
            title: meta.title || null,
            durationMs: startTime ? Date.now() - startTime : null,
          });
          delete this._nodeStartTimes[exeNodeId];
        }
        if (this._callbacks.executed) this._callbacks.executed(msg.data);
        break;
      }

      case "execution_cached": {
        if (!msg.data) break;
        const cachedNodes = msg.data.nodes || (msg.data.node ? [msg.data.node] : []);
        for (const cn of cachedNodes) {
          const cachedId = String(cn);
          if (this._callbacks.onNodeCached) {
            const meta = this._nodeMap[cachedId] || {};
            this._callbacks.onNodeCached({
              nodeId: cachedId,
              classType: meta.classType || null,
              title: meta.title || null,
            });
          }
        }
        if (this._callbacks.executed) this._callbacks.executed(msg.data);
        break;
      }

      case "execution_error": {
        if (!msg.data) break;
        if (this._promptId && msg.data.prompt_id !== this._promptId) return;
        if (this._callbacks.onNodeFailed && msg.data.node) {
          const failedId = String(msg.data.node);
          const meta = this._nodeMap[failedId] || {};
          this._callbacks.onNodeFailed({
            nodeId: failedId,
            classType: meta.classType || null,
            title: meta.title || null,
            errorType: msg.data.exception_type || null,
            errorMessage: msg.data.exception_message ? String(msg.data.exception_message).substring(0, 512) : null,
          });
        }
        if (this._callbacks.error) this._callbacks.error(msg.data);
        break;
      }

      default:
        /* status, crystools.monitor, etc. — ignore */ break;
    }
  }

  /* ── Standard callbacks ── */
  onProgress(cb) { this._callbacks.progress = cb; }
  onExecuted(cb) { this._callbacks.executed = cb; }
  onError(cb) { this._callbacks.error = cb; }
  onStart(cb) { this._callbacks.start = cb; }

  /* ── Node-level callbacks ── */
  onNodeStart(cb)    { this._callbacks.onNodeStart = cb; }
  onNodeProgress(cb) { this._callbacks.onNodeProgress = cb; }
  onNodeComplete(cb) { this._callbacks.onNodeComplete = cb; }
  onNodeCached(cb)   { this._callbacks.onNodeCached = cb; }
  onNodeFailed(cb)   { this._callbacks.onNodeFailed = cb; }

  isConnected() { return this._ws && this._ws.readyState === WebSocket.OPEN; }

  disconnect() {
    this._shouldReconnect = false;
    if (this._ws) {
      try { this._ws.close(); } catch (_) {}
      this._ws = null;
    }
  }
}

export default { ComfyUIWebSocket };
