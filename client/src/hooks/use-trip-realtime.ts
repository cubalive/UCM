import { useEffect, useRef, useCallback, useState } from "react";
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";

const VITE_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const VITE_SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

interface TripRealtimeEvent {
  driverId?: number;
  lat?: number;
  lng?: number;
  ts?: number;
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

interface RealtimeTokenResponse {
  token: string;
  channel: string;
  expiresIn: number;
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
  const clientRef = useRef<SupabaseClient | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onDriverLocation, onStatusChange, onEtaUpdate, onTestPing });
  callbacksRef.current = { onDriverLocation, onStatusChange, onEtaUpdate, onTestPing };
  const mountedRef = useRef(true);
  const channelNameRef = useRef<string | null>(null);

  const recordEvent = useCallback((type: string) => {
    const ts = Date.now();
    console.debug("[UCM] Realtime event", { type, ts });
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

  const cleanup = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (channelRef.current) {
      try {
        channelRef.current.unsubscribe();
      } catch {}
      channelRef.current = null;
    }
    if (clientRef.current) {
      try {
        clientRef.current.removeAllChannels();
      } catch {}
      clientRef.current = null;
    }
    setConnected(false);
    setDebugInfo({
      connectionState: "DISCONNECTED",
      connected: false,
      channel: null,
      lastEventType: null,
      lastEventTs: null,
      errorReason: null,
    });
  }, []);

  const connect = useCallback(async () => {
    if (!tripId || !authToken) return;

    cleanup();

    if (!VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) {
      setError("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY");
      return;
    }

    setDebugInfo((prev) => ({ ...prev, connectionState: "CONNECTING", errorReason: null }));

    try {
      const resp = await fetch("/api/realtime/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ tripId }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ message: `HTTP ${resp.status}` }));
        setError(`Token request failed: ${errData.message || resp.status}`);
        return;
      }

      const tokenData: RealtimeTokenResponse = await resp.json();
      if (!tokenData.token) {
        setError("Server returned empty token");
        return;
      }

      if (!mountedRef.current) return;

      channelNameRef.current = tokenData.channel;
      console.debug("[UCM] Realtime subscribe", { channel: tokenData.channel, supabaseUrl: VITE_SUPABASE_URL });
      setDebugInfo((prev) => ({ ...prev, channel: tokenData.channel }));

      const client = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
        realtime: {
          params: {
            apikey: VITE_SUPABASE_ANON_KEY,
          },
        },
        global: {
          headers: {
            Authorization: `Bearer ${tokenData.token}`,
          },
        },
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });

      client.realtime.setAuth(tokenData.token);
      clientRef.current = client;

      const channel = client.channel(tokenData.channel, {
        config: {
          broadcast: { self: true },
        },
      });

      channel
        .on("broadcast", { event: "driver_location" }, (payload) => {
          const data = payload.payload as TripRealtimeEvent;
          recordEvent("driver_location");
          if (data.driverId && data.lat != null && data.lng != null) {
            callbacksRef.current.onDriverLocation?.({
              driverId: data.driverId,
              lat: data.lat,
              lng: data.lng,
              ts: data.ts || Date.now(),
            });
          }
        })
        .on("broadcast", { event: "status_change" }, (payload) => {
          const data = payload.payload as TripRealtimeEvent;
          recordEvent("status_change");
          if (data.status) {
            callbacksRef.current.onStatusChange?.({
              status: data.status,
              tripId: data.tripId || tripId,
            });
          }
        })
        .on("broadcast", { event: "eta_update" }, (payload) => {
          const data = payload.payload as TripRealtimeEvent;
          recordEvent("eta_update");
          if (data.minutes != null && data.distanceMiles != null) {
            callbacksRef.current.onEtaUpdate?.({
              minutes: data.minutes,
              distanceMiles: data.distanceMiles,
            });
          }
        })
        .on("broadcast", { event: "test_ping" }, (payload) => {
          const data = payload.payload as TripRealtimeEvent;
          recordEvent("test_ping");
          callbacksRef.current.onTestPing?.({
            ts: data.ts || Date.now(),
            message: data.message || "ok",
          });
        })
        .subscribe((status, err) => {
          if (!mountedRef.current) return;
          console.debug("[UCM] Realtime status", { status, error: err?.message });
          if (status === "SUBSCRIBED") {
            setConnected(true);
            setDebugInfo((prev) => ({
              ...prev,
              connected: true,
              connectionState: "CONNECTED",
              errorReason: null,
            }));
          } else if (status === "CLOSED") {
            setError("Channel closed");
          } else if (status === "CHANNEL_ERROR") {
            setError(err?.message || "CHANNEL_ERROR (check Supabase project settings)");
          } else if (status === "TIMED_OUT") {
            setError("Connection timed out");
          }
        });

      channelRef.current = channel;

      const refreshMs = Math.max((tokenData.expiresIn - 60) * 1000, 60_000);
      refreshTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, refreshMs);
    } catch (err: any) {
      setError(err?.message || "Connection error");
    }
  }, [tripId, authToken, cleanup, recordEvent, setError]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [connect, cleanup]);

  return { connected, debugInfo };
}
