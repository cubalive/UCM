import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";

let realtimeClient: SupabaseClient | null = null;

const realtimeMetrics = {
  tokensIssued: 0,
  broadcastsSent: 0,
  broadcastErrors: 0,
  broadcastsByType: {
    driver_location: 0,
    status_change: 0,
    eta_update: 0,
  } as Record<string, number>,
  windowStartedAt: Date.now(),
  windowTokens: 0,
  windowBroadcasts: 0,
};

function resetWindow() {
  const now = Date.now();
  if (now - realtimeMetrics.windowStartedAt >= 60_000) {
    realtimeMetrics.windowTokens = 0;
    realtimeMetrics.windowBroadcasts = 0;
    realtimeMetrics.windowStartedAt = now;
  }
}

export function getRealtimeMetrics() {
  resetWindow();
  const elapsed = Math.max(1, (Date.now() - realtimeMetrics.windowStartedAt) / 60_000);
  return {
    realtime_tokens_issued_total: realtimeMetrics.tokensIssued,
    realtime_tokens_per_min: Math.round(realtimeMetrics.windowTokens / elapsed),
    realtime_broadcasts_total: realtimeMetrics.broadcastsSent,
    realtime_broadcasts_per_min: Math.round(realtimeMetrics.windowBroadcasts / elapsed),
    realtime_broadcast_errors: realtimeMetrics.broadcastErrors,
    realtime_broadcasts_by_type: { ...realtimeMetrics.broadcastsByType },
  };
}

export function recordTokenIssued() {
  realtimeMetrics.tokensIssued++;
  realtimeMetrics.windowTokens++;
  resetWindow();
}

function getRealtimeClient(): SupabaseClient | null {
  if (realtimeClient) return realtimeClient;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;

  realtimeClient = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return realtimeClient;
}

export function signRealtimeToken(claims: {
  userId: number;
  role: string;
  companyId?: number | null;
  clinicId?: number | null;
  tripId: number;
}): string | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;

  const payload = {
    sub: String(claims.userId),
    role: "authenticated",
    ucm_role: claims.role,
    company_id: claims.companyId || null,
    clinic_id: claims.clinicId || null,
    trip_id: claims.tripId,
    iss: "ucm-server",
    aud: "authenticated",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,
  };

  return jwt.sign(payload, secret);
}

const channelCache = new Map<string, any>();

export async function broadcastTripSupabase(
  tripId: number,
  event: {
    type: "driver_location" | "status_change" | "eta_update";
    data: any;
  }
): Promise<void> {
  const client = getRealtimeClient();
  if (!client) return;

  const channelName = `trip:${tripId}`;

  try {
    let channel = channelCache.get(channelName);
    if (!channel) {
      channel = client.channel(channelName);
      channel.subscribe();
      channelCache.set(channelName, channel);
    }

    await channel.send({
      type: "broadcast",
      event: event.type,
      payload: {
        ...event.data,
        tripId,
        ts: Date.now(),
      },
    });

    realtimeMetrics.broadcastsSent++;
    realtimeMetrics.windowBroadcasts++;
    realtimeMetrics.broadcastsByType[event.type] = (realtimeMetrics.broadcastsByType[event.type] || 0) + 1;
    resetWindow();
  } catch (err: any) {
    realtimeMetrics.broadcastErrors++;
    console.warn(`[SUPABASE-RT] Broadcast error for trip ${tripId}: ${err.message}`);
  }
}

const LOCATION_THROTTLE_MS = 5_000;
const locationThrottleCache = new Map<number, number>();

export async function broadcastTripSupabaseThrottled(
  tripId: number,
  event: {
    type: "driver_location" | "status_change" | "eta_update";
    data: any;
  }
): Promise<void> {
  if (event.type === "driver_location") {
    const now = Date.now();
    const lastSent = locationThrottleCache.get(tripId) || 0;
    if (now - lastSent < LOCATION_THROTTLE_MS) {
      return;
    }
    locationThrottleCache.set(tripId, now);
  }

  await broadcastTripSupabase(tripId, event);
}

export function cleanupChannels(): void {
  channelCache.forEach((channel, name) => {
    try {
      channel.unsubscribe();
    } catch {}
  });
  channelCache.clear();
}
