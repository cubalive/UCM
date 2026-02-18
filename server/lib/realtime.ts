import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { URL } from "url";

interface TripSubscription {
  tripId: number;
  ws: WebSocket;
}

const tripSubscriptions = new Map<number, Set<WebSocket>>();

let wss: WebSocketServer | null = null;

const WS_MAX_MESSAGES_PER_MIN = 60;
const WS_HEARTBEAT_INTERVAL_MS = 30_000;
const WS_HEARTBEAT_TIMEOUT_MS = 10_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function verifyJwt(token: string): { userId: number; role: string; companyId?: number | null } | null {
  try {
    const { verifyToken } = require("../auth");
    return verifyToken(token);
  } catch {
    return null;
  }
}

function checkRateLimit(ws: WebSocket): boolean {
  const meta = ws as any;
  const now = Date.now();
  if (!meta._msgTimestamps) meta._msgTimestamps = [];
  const cutoff = now - 60_000;
  meta._msgTimestamps = (meta._msgTimestamps as number[]).filter((t: number) => t > cutoff);
  if (meta._msgTimestamps.length >= WS_MAX_MESSAGES_PER_MIN) {
    return false;
  }
  meta._msgTimestamps.push(now);
  return true;
}

export function initWebSocket(httpServer: Server): WebSocketServer {
  wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const token = url.searchParams.get("token");

    if (!token) {
      ws.close(4001, "Missing token");
      return;
    }

    const user = verifyJwt(token);
    if (!user) {
      ws.close(4001, "Invalid token");
      return;
    }

    const meta = ws as any;
    meta._user = user;
    meta._subscribedTrips = new Set<number>();
    meta._alive = true;
    meta._msgTimestamps = [];

    ws.on("pong", () => {
      meta._alive = true;
    });

    ws.on("message", (raw) => {
      if (!checkRateLimit(ws)) {
        ws.send(JSON.stringify({ type: "error", message: "rate_limited" }));
        ws.close(4429, "Rate limited");
        return;
      }
      try {
        const msg = JSON.parse(raw.toString());
        handleMessage(ws, msg);
      } catch {}
    });

    ws.on("close", () => {
      const subscribed = meta._subscribedTrips as Set<number> | undefined;
      if (subscribed) {
        for (const tripId of subscribed) {
          unsubscribeFromTrip(ws, tripId);
        }
      }
    });

    ws.send(JSON.stringify({ type: "connected", ts: Date.now() }));
  });

  heartbeatTimer = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      const meta = ws as any;
      if (meta._alive === false) {
        ws.terminate();
        return;
      }
      meta._alive = false;
      ws.ping();
    });
  }, WS_HEARTBEAT_INTERVAL_MS);

  console.log("[WS] WebSocket server initialized on /ws (rate-limit: 60 msg/min, heartbeat: 30s)");
  return wss;
}

function handleMessage(ws: WebSocket, msg: any): void {
  switch (msg.type) {
    case "subscribe_trip": {
      const tripId = parseInt(msg.tripId);
      if (isNaN(tripId)) return;
      subscribeToTrip(ws, tripId);
      ws.send(JSON.stringify({ type: "subscribed", tripId }));
      break;
    }
    case "unsubscribe_trip": {
      const tripId = parseInt(msg.tripId);
      if (isNaN(tripId)) return;
      unsubscribeFromTrip(ws, tripId);
      ws.send(JSON.stringify({ type: "unsubscribed", tripId }));
      break;
    }
    case "ping": {
      ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
      break;
    }
  }
}

function subscribeToTrip(ws: WebSocket, tripId: number): void {
  let subs = tripSubscriptions.get(tripId);
  if (!subs) {
    subs = new Set();
    tripSubscriptions.set(tripId, subs);
  }
  subs.add(ws);

  const subscribedSet = (ws as any)._subscribedTrips as Set<number>;
  if (subscribedSet) subscribedSet.add(tripId);
}

function unsubscribeFromTrip(ws: WebSocket, tripId: number): void {
  const subs = tripSubscriptions.get(tripId);
  if (subs) {
    subs.delete(ws);
    if (subs.size === 0) {
      tripSubscriptions.delete(tripId);
    }
  }

  const subscribedSet = (ws as any)._subscribedTrips as Set<number>;
  if (subscribedSet) subscribedSet.delete(tripId);
}

export function broadcastToTrip(tripId: number, event: {
  type: "driver_location" | "status_change" | "eta_update";
  data: any;
}): void {
  const subs = tripSubscriptions.get(tripId);
  if (!subs || subs.size === 0) return;

  const payload = JSON.stringify({ ...event, tripId, ts: Date.now() });

  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      subs.delete(ws);
    }
  }

  if (subs.size === 0) {
    tripSubscriptions.delete(tripId);
  }
}

export function getActiveSubscriptionCount(): number {
  let total = 0;
  for (const subs of tripSubscriptions.values()) {
    total += subs.size;
  }
  return total;
}

export function getActiveConnectionCount(): number {
  if (!wss) return 0;
  let count = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) count++;
  });
  return count;
}

export function getTripSubscriberCount(tripId: number): number {
  return tripSubscriptions.get(tripId)?.size || 0;
}
