import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import type { RealtimeDebugInfo } from "@/hooks/use-trip-realtime";

interface RealtimeDebugPanelProps {
  debugInfo: RealtimeDebugInfo;
  pollingActive: boolean;
  pollingIntervalMs: number | false;
  tripId: number | null;
}

const DEBUG_ENABLED =
  import.meta.env.VITE_UCM_DEBUG === "true" ||
  import.meta.env.VITE_UCM_DEBUG_REALTIME === "true";

export function RealtimeDebugPanel({
  debugInfo,
  pollingActive,
  pollingIntervalMs,
  tripId,
}: RealtimeDebugPanelProps) {
  const { token } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [directionsLast60s, setDirectionsLast60s] = useState(0);
  const [recomputeThrottled, setRecomputeThrottled] = useState(0);
  const [pingSending, setPingSending] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  if (!DEBUG_ENABLED) return null;

  const directionsQuery = useQuery<any>({
    queryKey: ["/api/ops/directions-metrics"],
    queryFn: async () => {
      if (!token) return null;
      const resp = await fetch("/api/ops/directions-metrics", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) return null;
      return resp.json();
    },
    enabled: !!token && !!tripId,
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (directionsQuery.data) {
      setDirectionsLast60s(directionsQuery.data.directions_calls_last_60s ?? 0);
      setRecomputeThrottled(directionsQuery.data.recompute_blocked_by_throttle ?? 0);
    }
  }, [directionsQuery.data]);

  const sendTestPing = useCallback(async () => {
    if (!token || !tripId || pingSending) return;
    setPingSending(true);
    setPingResult(null);
    try {
      const resp = await fetch("/api/realtime/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tripId }),
      });
      if (resp.ok) {
        setPingResult("sent");
      } else {
        const data = await resp.json().catch(() => ({ message: "failed" }));
        setPingResult(data.message || "error");
      }
    } catch (err) {
      setPingResult("network error");
    } finally {
      setPingSending(false);
      setTimeout(() => setPingResult(null), 5000);
    }
  }, [token, tripId, pingSending]);

  const pollingLabel = pollingActive
    ? `ON (${typeof pollingIntervalMs === "number" ? `${pollingIntervalMs / 1000}s` : "—"})`
    : "OFF";

  const lastEventAge = debugInfo.lastEventTs
    ? `${Math.round((Date.now() - debugInfo.lastEventTs) / 1000)}s ago`
    : "—";

  const statusColor =
    debugInfo.connectionState === "CONNECTED"
      ? "bg-green-400"
      : debugInfo.connectionState === "CONNECTING"
        ? "bg-yellow-400"
        : "bg-red-400";

  const [, forceUpdate] = useState(0);
  useEffect(() => {
    intervalRef.current = setInterval(() => forceUpdate((n) => n + 1), 2000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (collapsed) {
    return (
      <div
        className="fixed top-2 right-2 z-[9999] cursor-pointer select-none"
        style={{ pointerEvents: "auto" }}
        onClick={() => setCollapsed(false)}
        data-testid="debug-panel-collapsed"
      >
        <div className="flex items-center gap-1 rounded px-2 py-1 text-xs font-mono bg-black/80 text-white">
          <span className={`inline-block w-2 h-2 rounded-full ${statusColor}`} />
          UCM
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed top-2 right-2 z-[9999] select-none"
      style={{ pointerEvents: "auto", maxWidth: "280px" }}
      data-testid="debug-panel"
    >
      <div className="rounded-md bg-black/90 text-white text-xs font-mono p-3 space-y-1.5 shadow-lg">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-[11px] tracking-wide uppercase opacity-70">UCM Debug</span>
          <button
            onClick={() => setCollapsed(true)}
            className="text-white/50 hover:text-white text-[10px]"
            data-testid="button-debug-collapse"
          >
            [hide]
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
          <span>Realtime: {debugInfo.connectionState}</span>
        </div>

        {debugInfo.errorReason && (
          <div className="text-red-400 text-[10px] break-words" data-testid="text-realtime-error">
            {debugInfo.errorReason}
          </div>
        )}

        {import.meta.env.VITE_SUPABASE_ANON_KEY && !import.meta.env.VITE_SUPABASE_ANON_KEY.startsWith("eyJ") && (
          <div className="text-orange-400 text-[10px] break-words">
            Key invalid: should start with "eyJ"
          </div>
        )}

        <div className="opacity-80">
          Channel: {debugInfo.channel ?? "—"}
        </div>

        <div className="opacity-80">
          Last event: {debugInfo.lastEventType ?? "—"} {debugInfo.lastEventTs ? `(${lastEventAge})` : ""}
        </div>

        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${pollingActive ? "bg-yellow-400" : "bg-gray-500"}`} />
          <span>Polling fallback: {pollingLabel}</span>
        </div>

        <div className="border-t border-white/20 pt-1.5 mt-1.5">
          <div className="opacity-80">
            Directions (60s): {directionsLast60s}
          </div>
          <div className="opacity-80">
            Recompute throttled: {recomputeThrottled}
          </div>
        </div>

        {tripId && (
          <div className="border-t border-white/20 pt-1.5 mt-1.5 space-y-1">
            <div className="opacity-50 text-[10px]">
              Trip #{tripId}
            </div>
            <button
              onClick={sendTestPing}
              disabled={pingSending}
              className={`w-full rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                pingSending
                  ? "bg-white/10 text-white/30 cursor-not-allowed"
                  : "bg-white/20 text-white hover:bg-white/30 cursor-pointer"
              }`}
              data-testid="button-send-test-ping"
            >
              {pingSending ? "Sending..." : "Send Test Ping"}
            </button>
            {pingResult && (
              <div className={`text-[10px] ${pingResult === "sent" ? "text-green-400" : "text-red-400"}`} data-testid="text-ping-result">
                {pingResult === "sent" ? "Ping published to server" : `Error: ${pingResult}`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
