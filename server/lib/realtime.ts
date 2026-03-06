import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { URL } from "url";

interface TripSubscription {
  tripId: number;
  ws: WebSocket;
}

const tripSubscriptions = new Map<number, Set<WebSocket>>();
const driverSubscriptions = new Map<number, Set<WebSocket>>();

let wss: WebSocketServer | null = null;

const WS_MAX_MESSAGES_PER_MIN = 60;
const WS_HEARTBEAT_INTERVAL_MS = 30_000;
const WS_HEARTBEAT_TIMEOUT_MS = 10_000;
const WS_MAX_CONNECTIONS = parseInt(process.env.WS_MAX_CONNECTIONS || "500", 10);
const WS_MAX_PAYLOAD_BYTES = 4096;

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
  wss = new WebSocketServer({ server: httpServer, path: "/ws", maxPayload: WS_MAX_PAYLOAD_BYTES });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    if (wss && wss.clients.size > WS_MAX_CONNECTIONS) {
      ws.close(4503, "Too many connections");
      return;
    }

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
        handleMessage(ws, msg).catch((err) => {
          console.warn(`[WS] handleMessage error: ${err.message}`);
        });
      } catch {
        // Invalid JSON — ignore malformed messages
      }
    });

    ws.on("close", () => {
      const subscribed = meta._subscribedTrips as Set<number> | undefined;
      if (subscribed) {
        for (const tripId of subscribed) {
          unsubscribeFromTrip(ws, tripId);
        }
      }
      if (meta._subscribedDriverId) {
        unsubscribeFromDriver(ws, meta._subscribedDriverId);
      }
      try {
        const { cleanupChannelSubscriptions } = require("./tripTransitionHelper");
        cleanupChannelSubscriptions(ws);
      } catch (e) { console.warn("[WS] cleanupChannelSubscriptions failed:", e); }
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

async function handleMessage(ws: WebSocket, msg: any): Promise<void> {
  switch (msg.type) {
    case "subscribe_trip": {
      const tripId = parseInt(msg.tripId);
      if (isNaN(tripId)) return;
      const tripUser = (ws as any)._user;
      if (!tripUser) return;
      // Company-scoped users can only subscribe to trips from their company
      // Ownership check is async; verify trip belongs to user's company
      if (tripUser.role !== "SUPER_ADMIN" && tripUser.companyId) {
        try {
          const { db } = require("../db");
          const { trips } = require("@shared/schema");
          const { eq } = require("drizzle-orm");
          const [trip] = await db.select({ companyId: trips.companyId }).from(trips).where(eq(trips.id, tripId));
          if (trip && trip.companyId !== tripUser.companyId) {
            ws.send(JSON.stringify({ type: "error", message: "access_denied" }));
            return;
          }
        } catch (e) { console.warn("[WS] subscribe_trip ownership check failed:", e); }
      }
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
    case "subscribe_company": {
      const user = (ws as any)._user;
      if (!user) return;
      const companyId = msg.companyId ? parseInt(msg.companyId) : user.companyId;
      if (!companyId) return;
      if (user.role !== "SUPER_ADMIN" && user.companyId !== companyId) {
        ws.send(JSON.stringify({ type: "error", message: "access_denied" }));
        return;
      }
      const { subscribeToCompanyChannel } = require("./tripTransitionHelper");
      subscribeToCompanyChannel(ws, companyId);
      ws.send(JSON.stringify({ type: "subscribed_company", companyId }));
      break;
    }
    case "unsubscribe_company": {
      const companyId = parseInt(msg.companyId);
      if (isNaN(companyId)) return;
      const { unsubscribeFromCompanyChannel } = require("./tripTransitionHelper");
      unsubscribeFromCompanyChannel(ws, companyId);
      ws.send(JSON.stringify({ type: "unsubscribed_company", companyId }));
      break;
    }
    case "subscribe_clinic": {
      const user = (ws as any)._user;
      if (!user) return;
      const clinicId = parseInt(msg.clinicId);
      if (isNaN(clinicId)) return;
      if (user.role !== "SUPER_ADMIN") {
        const isClinicUser = user.clinicId != null;
        const isCompanyUser = ["ADMIN", "DISPATCHER", "COMPANY_ADMIN"].includes(user.role);
        if (isClinicUser && user.clinicId !== clinicId) {
          ws.send(JSON.stringify({ type: "error", message: "access_denied" }));
          return;
        }
        if (!isClinicUser && !isCompanyUser) {
          ws.send(JSON.stringify({ type: "error", message: "access_denied" }));
          return;
        }
        // Company users: verify clinic belongs to their company
        if (isCompanyUser && user.companyId) {
          try {
            const { db } = require("../db");
            const { clinics } = require("@shared/schema");
            const { eq } = require("drizzle-orm");
            const [clinic] = await db.select({ companyId: clinics.companyId }).from(clinics).where(eq(clinics.id, clinicId));
            if (clinic && clinic.companyId !== user.companyId) {
              ws.send(JSON.stringify({ type: "error", message: "access_denied" }));
              return;
            }
          } catch (e) { console.warn("[WS] subscribe_clinic ownership check failed:", e); }
        }
      }
      const { subscribeToClinicChannel } = require("./tripTransitionHelper");
      subscribeToClinicChannel(ws, clinicId);
      ws.send(JSON.stringify({ type: "subscribed_clinic", clinicId }));
      break;
    }
    case "unsubscribe_clinic": {
      const clinicId = parseInt(msg.clinicId);
      if (isNaN(clinicId)) return;
      const { unsubscribeFromClinicChannel } = require("./tripTransitionHelper");
      unsubscribeFromClinicChannel(ws, clinicId);
      ws.send(JSON.stringify({ type: "unsubscribed_clinic", clinicId }));
      break;
    }
    case "subscribe_driver": {
      const user = (ws as any)._user;
      if (!user) return;
      const driverId = parseInt(msg.driverId);
      if (isNaN(driverId)) return;
      if (user.role === "SUPER_ADMIN") {
        // Super admin can subscribe to any driver
      } else if (user.role === "DRIVER") {
        // Drivers can only subscribe to their own channel
        if (user.driverId && user.driverId !== driverId) {
          ws.send(JSON.stringify({ type: "error", message: "access_denied" }));
          return;
        }
      } else if (["ADMIN", "COMPANY_ADMIN", "DISPATCH"].includes(user.role)) {
        // Company users can subscribe to drivers in their company
        try {
          const { db } = require("../db");
          const { drivers } = require("@shared/schema");
          const { eq } = require("drizzle-orm");
          const [driver] = await db.select({ companyId: drivers.companyId }).from(drivers).where(eq(drivers.id, driverId));
          if (driver && user.companyId && driver.companyId !== user.companyId) {
            ws.send(JSON.stringify({ type: "error", message: "access_denied" }));
            return;
          }
        } catch (e) { console.warn("[WS] subscribe_driver ownership check failed:", e); }
      } else {
        ws.send(JSON.stringify({ type: "error", message: "access_denied" }));
        return;
      }
      subscribeToDriver(ws, driverId);
      ws.send(JSON.stringify({ type: "subscribed_driver", driverId }));
      break;
    }
    case "unsubscribe_driver": {
      const driverId = parseInt(msg.driverId);
      if (isNaN(driverId)) return;
      unsubscribeFromDriver(ws, driverId);
      ws.send(JSON.stringify({ type: "unsubscribed_driver", driverId }));
      break;
    }
    case "ping": {
      ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
      break;
    }
  }
}

function subscribeToDriver(ws: WebSocket, driverId: number): void {
  let subs = driverSubscriptions.get(driverId);
  if (!subs) {
    subs = new Set();
    driverSubscriptions.set(driverId, subs);
  }
  subs.add(ws);
  (ws as any)._subscribedDriverId = driverId;
}

function unsubscribeFromDriver(ws: WebSocket, driverId: number): void {
  const subs = driverSubscriptions.get(driverId);
  if (subs) {
    subs.delete(ws);
    if (subs.size === 0) driverSubscriptions.delete(driverId);
  }
  if ((ws as any)._subscribedDriverId === driverId) {
    (ws as any)._subscribedDriverId = null;
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

export function broadcastToDriver(driverId: number, event: any): void {
  const subs = driverSubscriptions.get(driverId);
  if (!subs || subs.size === 0) return;

  const payload = JSON.stringify({ ...event, driverId, ts: Date.now() });

  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      subs.delete(ws);
    }
  }

  if (subs.size === 0) {
    driverSubscriptions.delete(driverId);
  }
}

export function getWss(): WebSocketServer | null {
  return wss;
}
