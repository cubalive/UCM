import { useEffect, useRef, useCallback, useState } from "react";
import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";

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
}

interface UseTripRealtimeOptions {
  tripId: number | null;
  authToken: string | null;
  onDriverLocation?: (data: { driverId: number; lat: number; lng: number; ts: number }) => void;
  onStatusChange?: (data: { status: string; tripId: number }) => void;
  onEtaUpdate?: (data: { minutes: number; distanceMiles: number }) => void;
}

interface RealtimeTokenResponse {
  token: string;
  channel: string;
  supabaseUrl: string;
  anonKey: string;
  expiresIn: number;
}

export interface RealtimeDebugInfo {
  connected: boolean;
  channel: string | null;
  lastEventType: string | null;
  lastEventTs: number | null;
}

export function useTripRealtime({
  tripId,
  authToken,
  onDriverLocation,
  onStatusChange,
  onEtaUpdate,
}: UseTripRealtimeOptions) {
  const [connected, setConnected] = useState(false);
  const [debugInfo, setDebugInfo] = useState<RealtimeDebugInfo>({
    connected: false,
    channel: null,
    lastEventType: null,
    lastEventTs: null,
  });
  const clientRef = useRef<SupabaseClient | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onDriverLocation, onStatusChange, onEtaUpdate });
  callbacksRef.current = { onDriverLocation, onStatusChange, onEtaUpdate };
  const mountedRef = useRef(true);
  const channelNameRef = useRef<string | null>(null);

  const recordEvent = useCallback((type: string) => {
    const ts = Date.now();
    if (import.meta.env.DEV) {
      console.debug("[UCM] Realtime event", { type, ts });
    }
    setDebugInfo((prev) => ({ ...prev, lastEventType: type, lastEventTs: ts }));
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
    setDebugInfo({ connected: false, channel: null, lastEventType: null, lastEventTs: null });
  }, []);

  const connect = useCallback(async () => {
    if (!tripId || !authToken) return;

    cleanup();

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
        console.warn("[TRIP-RT] Token request failed:", resp.status);
        return;
      }

      const tokenData: RealtimeTokenResponse = await resp.json();
      if (!tokenData.supabaseUrl || !tokenData.anonKey || !tokenData.token) {
        console.warn("[TRIP-RT] Missing realtime config");
        return;
      }

      if (!mountedRef.current) return;

      channelNameRef.current = tokenData.channel;
      if (import.meta.env.DEV) {
        console.debug("[UCM] Realtime subscribe", { channel: tokenData.channel });
      }
      setDebugInfo((prev) => ({ ...prev, channel: tokenData.channel }));

      const client = createClient(tokenData.supabaseUrl, tokenData.anonKey, {
        realtime: {
          params: {
            apikey: tokenData.anonKey,
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
          broadcast: { self: false },
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
        .subscribe((status) => {
          if (!mountedRef.current) return;
          const isConnected = status === "SUBSCRIBED";
          if (import.meta.env.DEV) {
            console.debug("[UCM] Realtime status", { connected: isConnected, status });
          }
          if (isConnected) {
            setConnected(true);
            setDebugInfo((prev) => ({ ...prev, connected: true }));
          } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
            setConnected(false);
            setDebugInfo((prev) => ({ ...prev, connected: false }));
          }
        });

      channelRef.current = channel;

      const refreshMs = Math.max((tokenData.expiresIn - 60) * 1000, 60_000);
      refreshTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, refreshMs);
    } catch (err) {
      console.warn("[TRIP-RT] Connection error:", err);
      setConnected(false);
      setDebugInfo((prev) => ({ ...prev, connected: false }));
    }
  }, [tripId, authToken, cleanup, recordEvent]);

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
