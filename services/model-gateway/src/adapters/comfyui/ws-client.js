/* ws-client.js — WebSocket client for real-time ComfyUI progress
 *
 * GatewayOrchestrationDesign §7.2: prefer WebSocket, fallback to polling.
 * Parses: execution_start, executing, progress, executed, execution_error.
 */

import { WebSocket } from "ws";
import config from "../../config.js";
import logger from "../../utils/logger.js";

const RECONNECT_BACKOFF = [1000, 2000, 5000, 10000, 30000];

export class ComfyUIWebSocket {
  constructor() {
    this._ws = null;
    this._clientId = null;
    this._callbacks = { progress: null, executed: null, error: null, start: null };
    this._reconnectIdx = 0;
    this._shouldReconnect = false;
  }

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
        if (this._callbacks.start) this._callbacks.start(msg.data);
        break;
      case "executing":
        if (msg.data && msg.data.node && this._callbacks.progress) {
          this._callbacks.progress({ node: msg.data.node, display_node: msg.data.display_node });
        }
        break;
      case "progress":
        if (this._callbacks.progress) {
          this._callbacks.progress({ value: msg.data.value, max: msg.data.max });
        }
        break;
      case "executed":
        if (this._callbacks.executed) this._callbacks.executed(msg.data);
        break;
      case "execution_error":
        if (this._callbacks.error) this._callbacks.error(msg.data);
        break;
      case "execution_cached":
        /* Node was cached — treat as executed */
        if (this._callbacks.executed) this._callbacks.executed(msg.data);
        break;
      default:
        /* status, crystools.monitor, etc. — ignore */ break;
    }
  }

  onProgress(cb) { this._callbacks.progress = cb; }
  onExecuted(cb) { this._callbacks.executed = cb; }
  onError(cb) { this._callbacks.error = cb; }
  onStart(cb) { this._callbacks.start = cb; }

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
