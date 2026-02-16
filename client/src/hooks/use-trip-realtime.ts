import { useEffect, useRef, useCallback, useState } from "react";
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";

const VITE_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const VITE_SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

interface TripRealtimeEvent {
  driverId?: number;
  lat?: number;
  lng?: number;
  ts?: number;
  seq?: number;
  tripId?: number;
  status?: string;
  minutes?: number;
  distanceMiles?: number;
  source?: string;
  message?: string;
}

interface UseTripRealtimeOptions {
  tripId: number | null;
  authToken: string | null;
  onDriverLocation?: (data: { driverId: number; lat: number; lng: number; ts: number }) => void;
  onStatusChange?: (data: { status: string; tripId: number }) => void;
  onEtaUpdate?: (data: { minutes: number; distanceMiles: number }) => void;
  onTestPing?: (data: { ts: number; message: string }) => void;
}

export type RealtimeConnectionState = "DISCONNECTED" | "CONNECTING" | "CONNECTED";

export interface RealtimeDebugInfo {
  connectionState: RealtimeConnectionState;
  connected: boolean;
  channel: string | null;
  lastEventType: string | null;
  lastEventTs: number | null;
  errorReason: string | null;
}

let sharedClient: SupabaseClient | null = null;

function getSharedClient(): SupabaseClient | null {
  if (sharedClient) return sharedClient;
  if (!VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) return null;

  sharedClient = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return sharedClient;
}

const LOCATION_RENDER_MS = 5_000;
const ETA_RENDER_MS = 60_000;
const RECONNECT_DELAYS = [2_000, 5_000, 10_000, 30_000];
const POLL_INTERVAL_DISCONNECTED_MS = 10_000;

export function useTripRealtime({
  tripId,
  authToken,
  onDriverLocation,
  onStatusChange,
  onEtaUpdate,
  onTestPing,
}: UseTripRealtimeOptions) {
  const [connected, setConnected] = useState(false);
  const [debugInfo, setDebugInfo] = useState<RealtimeDebugInfo>({
    connectionState: "DISCONNECTED",
    connected: false,
    channel: null,
    lastEventType: null,
    lastEventTs: null,
    errorReason: null,
  });
  const channelRef = useRef<RealtimeChannel | null>(null);
  const callbacksRef = useRef({ onDriverLocation, onStatusChange, onEtaUpdate, onTestPing });
  callbacksRef.current = { onDriverLocation, onStatusChange, onEtaUpdate, onTestPing };
  const mountedRef = useRef(true);
  const lastLocationRenderRef = useRef(0);
  const lastEtaRenderRef = useRef(0);
  const lastSeqRef = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectRef = useRef<() => void>(() => {});

  const recordEvent = useCallback((type: string) => {
    const ts = Date.now();
    setDebugInfo((prev) => ({ ...prev, lastEventType: type, lastEventTs: ts }));
  }, []);

  const setError = useCallback((reason: string) => {
    console.warn("[UCM] Realtime error:", reason);
    setConnected(false);
    setDebugInfo((prev) => ({
      ...prev,
      connected: false,
      connectionState: "DISCONNECTED",
      errorReason: reason,
    }));
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const removeChannel = useCallback(() => {
    if (channelRef.current) {
      try {
        const client = getSharedClient();
        if (client) client.removeChannel(channelRef.current);
      } catch {}
      channelRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearReconnectTimer();
    clearPollTimer();
    removeChannel();
    setConnected(false);
    setDebugInfo({
      connectionState: "DISCONNECTED",
      connected: false,
      channel: null,
      lastEventType: null,
      lastEventTs: null,
      errorReason: null,
    });
  }, [clearReconnectTimer, clearPollTimer, removeChannel]);

  const startPollingFallback = useCallback(() => {
    clearPollTimer();
    if (!tripId || !authToken) return;
    pollTimerRef.current = setInterval(async () => {
      if (!mountedRef.current || pausedRef.current) return;
      try {
        const res = await fetch(`/api/trips/${tripId}/eta-to-pickup`, {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.minutes != null && data.distanceMiles != null) {
            callbacksRef.current.onEtaUpdate?.({
              minutes: data.minutes,
              distanceMiles: data.distanceMiles,
            });
          }
        }
      } catch {}
    }, POLL_INTERVAL_DISCONNECTED_MS);
  }, [tripId, authToken, clearPollTimer]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current || pausedRef.current) return;
    clearReconnectTimer();

    const attempt = reconnectAttemptRef.current;
    const delayIdx = Math.min(attempt, RECONNECT_DELAYS.length - 1);
    const delay = RECONNECT_DELAYS[delayIdx];
    reconnectAttemptRef.current = attempt + 1;

    reconnectTimerRef.current = setTimeout(() => {
      if (mountedRef.current && !pausedRef.current) {
        connectRef.current();
      }
    }, delay);
  }, [clearReconnectTimer]);

  const connect = useCallback(() => {
    try {
      if (!tripId || !authToken) return;
      if (pausedRef.current) return;

      removeChannel();
      clearReconnectTimer();

      if (!VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) {
        setError("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
        startPollingFallback();
        return;
      }

      const client = getSharedClient();
      if (!client) {
        setError("Failed to create Supabase client");
        startPollingFallback();
        return;
      }

      const channelName = `trip:${tripId}`;
      setDebugInfo((prev) => ({ ...prev, connectionState: "CONNECTING", errorReason: null, channel: channelName }));

      const channel = client.channel(channelName, {
        config: {
          broadcast: { self: true },
        },
      });

      channel
        .on("broadcast", { event: "driver_location" }, (payload) => {
          try {
            if (pausedRef.current) return;
            const data = payload.payload as TripRealtimeEvent;
            recordEvent("driver_location");

            if (data.seq != null && data.seq <= lastSeqRef.current) return;
            if (data.seq != null) lastSeqRef.current = data.seq;

            const now = Date.now();
            if (now - lastLocationRenderRef.current < LOCATION_RENDER_MS) return;
            lastLocationRenderRef.current = now;
            if (data.driverId && data.lat != null && data.lng != null) {
              callbacksRef.current.onDriverLocation?.({
                driverId: data.driverId,
                lat: data.lat,
                lng: data.lng,
                ts: data.ts || now,
              });
            }
          } catch (e) {
            console.warn("[UCM] Realtime driver_location handler error:", e);
          }
        })
        .on("broadcast", { event: "status_change" }, (payload) => {
          try {
            const data = payload.payload as TripRealtimeEvent;
            recordEvent("status_change");
            if (data.status) {
              callbacksRef.current.onStatusChange?.({
                status: data.status,
                tripId: data.tripId || tripId,
              });
            }
          } catch (e) {
            console.warn("[UCM] Realtime status_change handler error:", e);
          }
        })
        .on("broadcast", { event: "eta_update" }, (payload) => {
          try {
            if (pausedRef.current) return;
            const data = payload.payload as TripRealtimeEvent;
            recordEvent("eta_update");
            const now = Date.now();
            if (now - lastEtaRenderRef.current < ETA_RENDER_MS) return;
            lastEtaRenderRef.current = now;
            if (data.minutes != null && data.distanceMiles != null) {
              callbacksRef.current.onEtaUpdate?.({
                minutes: data.minutes,
                distanceMiles: data.distanceMiles,
              });
            }
          } catch (e) {
            console.warn("[UCM] Realtime eta_update handler error:", e);
          }
        })
        .on("broadcast", { event: "test_ping" }, (payload) => {
          try {
            const data = payload.payload as TripRealtimeEvent;
            recordEvent("test_ping");
            callbacksRef.current.onTestPing?.({
              ts: data.ts || Date.now(),
              message: data.message || "ok",
            });
          } catch (e) {
            console.warn("[UCM] Realtime test_ping handler error:", e);
          }
        })
        .subscribe((status, err) => {
          try {
            if (!mountedRef.current) return;
            if (status === "SUBSCRIBED") {
              setConnected(true);
              reconnectAttemptRef.current = 0;
              clearPollTimer();
              setDebugInfo((prev) => ({
                ...prev,
                connected: true,
                connectionState: "CONNECTED",
                errorReason: null,
              }));
            } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              const reason = status === "CLOSED" ? "Channel closed" : status === "TIMED_OUT" ? "Connection timed out" : (err?.message || "CHANNEL_ERROR");
              setError(reason);
              startPollingFallback();
              scheduleReconnect();
            }
          } catch (e) {
            console.warn("[UCM] Realtime subscribe callback error:", e);
            startPollingFallback();
          }
        });

      channelRef.current = channel;
    } catch (e) {
      console.error("[UCM] Realtime connect() crashed:", e);
      setError(`Connect failed: ${(e as Error).message}`);
      startPollingFallback();
      scheduleReconnect();
    }
  }, [tripId, authToken, removeChannel, clearReconnectTimer, clearPollTimer, recordEvent, setError, startPollingFallback, scheduleReconnect]);

  connectRef.current = connect;

  useEffect(() => {
    mountedRef.current = true;
    lastSeqRef.current = 0;
    reconnectAttemptRef.current = 0;
    connect();

    const handleVisibilityChange = () => {
      if (document.hidden) {
        pausedRef.current = true;
        clearReconnectTimer();
        clearPollTimer();
        removeChannel();
        setConnected(false);
        setDebugInfo((prev) => ({
          ...prev,
          connected: false,
          connectionState: "DISCONNECTED",
          errorReason: "tab_hidden",
        }));
      } else {
        pausedRef.current = false;
        lastSeqRef.current = 0;
        reconnectAttemptRef.current = 0;
        connectRef.current();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      cleanup();
    };
  }, [connect, cleanup, clearReconnectTimer, clearPollTimer, removeChannel]);

  return { connected, debugInfo };
}
