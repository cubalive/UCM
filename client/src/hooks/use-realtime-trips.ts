import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";

interface TripUpdateEvent {
  type: "trip_update";
  companyId?: number;
  clinicId?: number;
  data: {
    tripId: number;
    status: string;
    previousStatus: string;
    driverId?: number;
    clinicId?: number;
    cityId?: number;
    publicId?: string;
  };
  ts: number;
}

interface UseRealtimeTripsOptions {
  companyId?: number | null;
  clinicId?: number | null;
  onTripUpdate?: (data: TripUpdateEvent["data"]) => void;
  invalidateKeys?: string[];
  enabled?: boolean;
}

export function useRealtimeTrips({
  companyId,
  clinicId,
  onTripUpdate,
  invalidateKeys = [],
  enabled = true,
}: UseRealtimeTripsOptions) {
  const { token } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    if (!token || !enabled) return;
    if (!companyId && !clinicId) return;

    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempts.current = 0;

        if (companyId) {
          ws.send(JSON.stringify({ type: "subscribe_company", companyId }));
        }
        if (clinicId) {
          ws.send(JSON.stringify({ type: "subscribe_clinic", clinicId }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "trip_update") {
            if (onTripUpdate) {
              onTripUpdate(msg.data);
            }

            for (const key of invalidateKeys) {
              queryClient.invalidateQueries({ queryKey: [key] });
            }

            if (invalidateKeys.length === 0) {
              queryClient.invalidateQueries({ queryKey: ["/api/dispatch/trips"] });
              queryClient.invalidateQueries({ queryKey: ["/api/trips"] });
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        wsRef.current = null;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {}
  }, [token, companyId, clinicId, enabled, onTripUpdate, invalidateKeys]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  return {
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
  };
}
