import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { getWsUrl } from "@/lib/api";

interface BrokerUpdateEvent {
  type: "broker_update";
  brokerId: number;
  data: {
    type: "bid_awarded" | "bid_submitted" | "request_status_change" | "trip_status_change";
    requestId?: number;
    bidId?: number;
    tripId?: number;
    status?: string;
    previousStatus?: string;
    driverId?: number;
    publicId?: string;
    awardedCompanyId?: number;
    bidAmount?: number;
    companyId?: number;
  };
  ts: number;
}

interface UseBrokerWsOptions {
  brokerId?: number | null;
  onBrokerUpdate?: (data: BrokerUpdateEvent["data"]) => void;
  enabled?: boolean;
}

export function useBrokerWs({
  brokerId,
  onBrokerUpdate,
  enabled = true,
}: UseBrokerWsOptions) {
  const { token } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    if (!token || !enabled || !brokerId) return;

    const wsUrl = getWsUrl(token);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempts.current = 0;
        ws.send(JSON.stringify({ type: "subscribe_broker", brokerId }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "broker_update") {
            onBrokerUpdate?.(msg.data);

            // Auto-invalidate broker queries
            queryClient.invalidateQueries({ queryKey: ["/api/broker/trip-requests"] });
            queryClient.invalidateQueries({ queryKey: ["/api/broker/live-trips"] });
            queryClient.invalidateQueries({ queryKey: ["/api/broker/dashboard"] });
            queryClient.invalidateQueries({ queryKey: ["/api/broker/analytics"] });
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
  }, [token, brokerId, enabled, onBrokerUpdate]);

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
