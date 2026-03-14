/**
 * WebSocket client for real-time communication with the UCM server.
 * Replaces polling in driver-v4 and other portals.
 */
import { resolveUrl, getStoredToken } from "./api";
import { getTokenKey } from "./hostDetection";

type EventHandler = (data: any) => void;

interface WebSocketClient {
  on: (event: string, handler: EventHandler) => void;
  off: (event: string, handler: EventHandler) => void;
  send: (msg: Record<string, unknown>) => void;
  disconnect: () => void;
  reconnect: () => void;
  isConnected: () => boolean;
}

const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 30000;
const PING_INTERVAL_MS = 25000;

export function createWebSocketConnection(): WebSocketClient {
  const listeners = new Map<string, Set<EventHandler>>();
  let ws: WebSocket | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let intentionalClose = false;

  function getWsUrl(): string {
    const base = resolveUrl("/ws");
    const url = new URL(base, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  function emit(event: string, data: any) {
    const handlers = listeners.get(event);
    if (handlers) {
      for (const h of handlers) {
        try { h(data); } catch (e) { console.error("[WS] Handler error:", e); }
      }
    }
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_INTERVAL_MS);
  }

  function stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    intentionalClose = false;
    const wsUrl = getWsUrl();
    const token = localStorage.getItem(getTokenKey()) || getStoredToken() || "";

    // Pass token via subprotocol for native app compatibility
    const protocols = token ? ["access_token", token] : undefined;

    try {
      ws = new WebSocket(wsUrl, protocols);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      reconnectAttempt = 0;
      startPing();
      emit("connect", {});
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        emit(msg.type, msg);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      stopPing();
      emit("disconnect", {});
      if (!intentionalClose) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onerror is always followed by onclose
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt), RECONNECT_MAX_MS);
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function disconnect() {
    intentionalClose = true;
    stopPing();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  // Start connection immediately
  connect();

  return {
    on(event: string, handler: EventHandler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    off(event: string, handler: EventHandler) {
      listeners.get(event)?.delete(handler);
    },
    send(msg: Record<string, unknown>) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    disconnect,
    reconnect() {
      disconnect();
      intentionalClose = false;
      reconnectAttempt = 0;
      connect();
    },
    isConnected() {
      return ws?.readyState === WebSocket.OPEN;
    },
  };
}
