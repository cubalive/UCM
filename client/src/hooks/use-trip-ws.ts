import { useEffect, useRef, useCallback, useState } from "react";

interface TripWsEvent {
  type: "driver_location" | "status_change" | "eta_update";
  tripId: number;
  data: any;
  ts: number;
}

interface UseTripWsOptions {
  tripId: number | null;
  token: string | null;
  onDriverLocation?: (data: { driverId: number; lat: number; lng: number; ts: number }) => void;
  onStatusChange?: (data: { status: string; tripId: number }) => void;
  onEtaUpdate?: (data: { minutes: number; distanceMiles: number }) => void;
}

const WS_RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];
const MAX_WS_RECONNECT_ATTEMPTS = 10;

export function useTripWs({ tripId, token, onDriverLocation, onStatusChange, onEtaUpdate }: UseTripWsOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  const [connected, setConnected] = useState(false);
  const callbacksRef = useRef({ onDriverLocation, onStatusChange, onEtaUpdate });
  callbacksRef.current = { onDriverLocation, onStatusChange, onEtaUpdate };

  const connect = useCallback(() => {
    if (!token || !tripId) return;
    if (!mountedRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttemptRef.current = 0;
        try {
          ws.send(JSON.stringify({ type: "subscribe_trip", tripId }));
        } catch (e) {
          console.warn("[UCM] WS send subscribe error:", e);
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as TripWsEvent;
          switch (msg.type) {
            case "driver_location":
              callbacksRef.current.onDriverLocation?.(msg.data);
              break;
            case "status_change":
              callbacksRef.current.onStatusChange?.(msg.data);
              break;
            case "eta_update":
              callbacksRef.current.onEtaUpdate?.(msg.data);
              break;
          }
        } catch (e) {
          console.warn("[UCM] WS message parse error:", e);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!mountedRef.current) return;
        const attempt = reconnectAttemptRef.current;
        if (attempt >= MAX_WS_RECONNECT_ATTEMPTS) {
          console.warn("[UCM] WS max reconnect attempts reached, giving up");
          return;
        }
        const delayIdx = Math.min(attempt, WS_RECONNECT_DELAYS.length - 1);
        const delay = WS_RECONNECT_DELAYS[delayIdx];
        reconnectAttemptRef.current = attempt + 1;
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, delay);
      };

      ws.onerror = (e) => {
        console.warn("[UCM] WS error, closing", e);
        try { ws.close(); } catch {}
      };
    } catch (e) {
      console.error("[UCM] WS connect() crashed:", e);
    }
  }, [token, tripId]);

  useEffect(() => {
    mountedRef.current = true;
    reconnectAttemptRef.current = 0;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
    };
  }, [connect]);

  const sendPing = useCallback(() => {
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    } catch (e) {
      console.warn("[UCM] WS sendPing error:", e);
    }
  }, []);

  return { connected, sendPing };
}
