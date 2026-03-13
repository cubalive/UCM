import { useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { getWsUrl } from "@/lib/api";

interface OrderUpdateEvent {
  type: "order_update";
  pharmacyId: number;
  data: {
    type: "order_status_change" | "trip_status_change";
    orderId?: number;
    tripId?: number;
    status: string;
    previousStatus?: string;
    driverId?: number;
    publicId?: string;
  };
  ts: number;
}

interface UsePharmacyWsOptions {
  pharmacyId?: number | null;
  onOrderUpdate?: (data: OrderUpdateEvent["data"]) => void;
  enabled?: boolean;
}

export function usePharmacyWs({
  pharmacyId,
  onOrderUpdate,
  enabled = true,
}: UsePharmacyWsOptions) {
  const { token } = useAuth();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    if (!token || !enabled || !pharmacyId) return;

    const wsUrl = getWsUrl(token);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempts.current = 0;
        ws.send(JSON.stringify({ type: "subscribe_pharmacy", pharmacyId }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "order_update") {
            onOrderUpdate?.(msg.data);

            // Auto-invalidate pharmacy queries
            queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/orders"] });
            queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/active-deliveries"] });
            queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/dashboard"] });
            queryClient.invalidateQueries({ queryKey: ["/api/pharmacy/metrics"] });
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
  }, [token, pharmacyId, enabled, onOrderUpdate]);

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
