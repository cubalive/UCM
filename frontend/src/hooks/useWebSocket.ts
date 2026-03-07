import { useEffect, useRef, useCallback, useState } from "react";
import { getToken, logout } from "../lib/api";

type EventHandler = (data: any) => void;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const [connected, setConnected] = useState(false);
  const reconnectTimeoutRef = useRef<number>();
  const reconnectAttemptRef = useRef(0);

  const connect = useCallback(() => {
    const token = getToken();
    if (!token) return;

    // Use auth handshake instead of URL token to avoid logging credentials
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      // Send auth token via message (not URL) to prevent token in server logs
      ws.send(JSON.stringify({ type: "auth", token }));
      setConnected(true);
      reconnectAttemptRef.current = 0;
      console.log("[WS] Connected");

      // Heartbeat every 30s
      const hb = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30000);
      ws.addEventListener("close", () => clearInterval(hb));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const handlers = handlersRef.current.get(msg.type);
        if (handlers) {
          handlers.forEach((handler) => handler(msg.data));
        }
      } catch { /* ignore malformed */ }
    };

    ws.onclose = (event) => {
      setConnected(false);

      // Don't reconnect on auth failures — redirect to login
      if (event.code === 4001 || event.code === 4002) {
        console.log("[WS] Auth failed, redirecting to login");
        logout();
        return;
      }

      // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
      console.log(`[WS] Disconnected, reconnecting in ${delay / 1000}s...`);
      reconnectTimeoutRef.current = window.setTimeout(connect, delay);
    };

    ws.onerror = () => { ws.close(); };
    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const on = useCallback((event: string, handler: EventHandler) => {
    if (!handlersRef.current.has(event)) {
      handlersRef.current.set(event, new Set());
    }
    handlersRef.current.get(event)!.add(handler);
    return () => { handlersRef.current.get(event)?.delete(handler); };
  }, []);

  const send = useCallback((type: string, data?: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  return { connected, on, send };
}
