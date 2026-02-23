import { useEffect, useRef, useCallback, useState } from "react";

export interface DriverWsEvent {
  type: "dispatch_notify" | "dispatch_now" | "tracking_stale" | "tracking_restored" | "subscribed_driver";
  driverId?: number;
  tripId?: number;
  pickupAddress?: string;
  dropoffAddress?: string;
  pickupTime?: string;
  patientId?: number;
  dispatchAt?: string;
  status?: string;
  message?: string;
  ts?: number;
}

interface UseDriverWsOptions {
  driverId: number | null;
  token: string | null;
  onDispatchNotify?: (event: DriverWsEvent) => void;
  onDispatchNow?: (event: DriverWsEvent) => void;
  onTrackingStale?: (event: DriverWsEvent) => void;
  onTrackingRestored?: (event: DriverWsEvent) => void;
}

const WS_RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000];
const MAX_RECONNECT_ATTEMPTS = 10;
const PING_INTERVAL_MS = 25_000;

export function useDriverWs({ driverId, token, onDispatchNotify, onDispatchNow, onTrackingStale, onTrackingRestored }: UseDriverWsOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  const [connected, setConnected] = useState(false);

  const callbacksRef = useRef({ onDispatchNotify, onDispatchNow, onTrackingStale, onTrackingRestored });
  callbacksRef.current = { onDispatchNotify, onDispatchNow, onTrackingStale, onTrackingRestored };

  const connect = useCallback(() => {
    if (!token || !driverId) return;
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
          ws.send(JSON.stringify({ type: "subscribe_driver", driverId }));
        } catch (e) {
          console.warn("[DRIVER-WS] subscribe error:", e);
        }

        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as DriverWsEvent;
          switch (msg.type) {
            case "dispatch_notify":
              callbacksRef.current.onDispatchNotify?.(msg);
              break;
            case "dispatch_now":
              callbacksRef.current.onDispatchNow?.(msg);
              break;
            case "tracking_stale":
              callbacksRef.current.onTrackingStale?.(msg);
              break;
            case "tracking_restored":
              callbacksRef.current.onTrackingRestored?.(msg);
              break;
          }
        } catch (e) {
          console.warn("[DRIVER-WS] message parse error:", e);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        if (!mountedRef.current) return;
        const attempt = reconnectAttemptRef.current;
        if (attempt >= MAX_RECONNECT_ATTEMPTS) return;
        const delayIdx = Math.min(attempt, WS_RECONNECT_DELAYS.length - 1);
        reconnectAttemptRef.current = attempt + 1;
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connect();
        }, WS_RECONNECT_DELAYS[delayIdx]);
      };

      ws.onerror = () => {
        try { ws.close(); } catch {}
      };
    } catch (e) {
      console.error("[DRIVER-WS] connect() error:", e);
    }
  }, [token, driverId]);

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
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
    };
  }, [connect]);

  return { connected };
}
