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

export function useTripWs({ tripId, token, onDriverLocation, onStatusChange, onEtaUpdate }: UseTripWsOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const callbacksRef = useRef({ onDriverLocation, onStatusChange, onEtaUpdate });
  callbacksRef.current = { onDriverLocation, onStatusChange, onEtaUpdate };

  const connect = useCallback(() => {
    if (!token || !tripId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({ type: "subscribe_trip", tripId }));
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
        } catch {}
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, 5000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {}
  }, [token, tripId]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const sendPing = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "ping" }));
    }
  }, []);

  return { connected, sendPing };
}
