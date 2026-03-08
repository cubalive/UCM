import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import jwt from "jsonwebtoken";
import logger from "../lib/logger.js";
import { getRedis, isRedisAvailable } from "../lib/redis.js";
import type { AuthUser } from "../middleware/auth.js";

// --- Structured event types ---
export const WS_EVENTS = {
  TRIP_CREATED: "trip:created",
  TRIP_ASSIGNED: "trip:assigned",
  TRIP_ACCEPTED: "trip:accepted",
  TRIP_UPDATED: "trip:updated",
  TRIP_CANCELLED: "trip:cancelled",
  DRIVER_LOCATION_UPDATE: "driver:location",
  DRIVER_STATUS_UPDATE: "driver:status_changed",
  URGENT_TRIP_REQUEST: "trip:urgent",
  CONNECTED: "connected",
  PONG: "pong",
} as const;

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  tenantId: string;
  role: string;
  connectedAt: Date;
  lastPingAt: Date;
}

// Connection registries
const tenantClients = new Map<string, Set<ConnectedClient>>();
const userClients = new Map<string, Set<ConnectedClient>>();
// Driver presence tracking
const driverPresence = new Map<string, { tenantId: string; connectedAt: Date; lastPingAt: Date }>();

let wss: WebSocketServer | null = null;
const REDIS_CHANNEL = "ucm:realtime";
let redisSub: ReturnType<typeof getRedis> = null;
let redisPub: ReturnType<typeof getRedis> = null;

export function initWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: "/ws" });
  initRedisPubSub();

  wss.on("connection", (ws, req) => {
    // Support both URL token (backward compat) and auth-handshake
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const urlToken = url.searchParams.get("token");

    if (urlToken) {
      try {
        const user = verifyToken(urlToken);
        registerClient(ws, user);
      } catch {
        ws.close(4002, "Invalid authentication token");
      }
      return;
    }

    // Wait for auth handshake message within 5s
    const authTimeout = setTimeout(() => {
      ws.close(4001, "Authentication timeout");
    }, 5000);

    ws.once("message", (data) => {
      clearTimeout(authTimeout);
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type !== "auth" || !msg.token) {
          ws.close(4001, "First message must be { type: 'auth', token: '...' }");
          return;
        }
        const user = verifyToken(msg.token);
        registerClient(ws, user);
      } catch {
        ws.close(4002, "Invalid authentication token");
      }
    });
  });

  // Heartbeat sweep: terminate stale connections every 45s
  setInterval(() => {
    const now = Date.now();
    for (const [, clients] of tenantClients) {
      for (const client of clients) {
        if (now - client.lastPingAt.getTime() > 90000) {
          logger.info("Closing stale WebSocket", { userId: client.userId });
          client.ws.terminate();
        }
      }
    }
  }, 45000);

  logger.info("WebSocket server initialized on /ws");
}

function verifyToken(token: string): AuthUser {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return jwt.verify(token, secret) as AuthUser;
}

function registerClient(ws: WebSocket, user: AuthUser) {
  const client: ConnectedClient = {
    ws,
    userId: user.id,
    tenantId: user.tenantId,
    role: user.role,
    connectedAt: new Date(),
    lastPingAt: new Date(),
  };

  if (!tenantClients.has(user.tenantId)) tenantClients.set(user.tenantId, new Set());
  tenantClients.get(user.tenantId)!.add(client);

  if (!userClients.has(user.id)) userClients.set(user.id, new Set());
  userClients.get(user.id)!.add(client);

  // Driver presence
  if (user.role === "driver") {
    driverPresence.set(user.id, { tenantId: user.tenantId, connectedAt: new Date(), lastPingAt: new Date() });
  }

  logger.info("WebSocket client connected", { userId: user.id, tenantId: user.tenantId, role: user.role });
  sendToClient(ws, WS_EVENTS.CONNECTED, { userId: user.id, role: user.role, timestamp: new Date().toISOString() });

  // Rate limit: max 60 messages per 10 seconds per client
  let messageCount = 0;
  let messageWindowStart = Date.now();

  ws.on("message", (data) => {
    try {
      const now = Date.now();
      if (now - messageWindowStart > 10000) {
        messageCount = 0;
        messageWindowStart = now;
      }
      messageCount++;
      if (messageCount > 60) {
        logger.warn("WebSocket message rate limit exceeded", { userId: user.id });
        return;
      }

      const message = JSON.parse(data.toString());
      client.lastPingAt = new Date();
      if (user.role === "driver" && driverPresence.has(user.id)) {
        driverPresence.get(user.id)!.lastPingAt = new Date();
      }
      handleClientMessage(client, message);
    } catch { /* ignore malformed */ }
  });

  ws.on("close", () => {
    tenantClients.get(user.tenantId)?.delete(client);
    userClients.get(user.id)?.delete(client);
    if (tenantClients.get(user.tenantId)?.size === 0) tenantClients.delete(user.tenantId);
    if (userClients.get(user.id)?.size === 0) {
      userClients.delete(user.id);
      if (user.role === "driver") driverPresence.delete(user.id);
    }
    logger.info("WebSocket client disconnected", { userId: user.id });
  });

  ws.on("error", (err) => {
    logger.error("WebSocket error", { userId: user.id, error: err.message });
  });
}

function handleClientMessage(client: ConnectedClient, message: { type: string; data?: any }) {
  switch (message.type) {
    case "driver:location_update":
      if (client.role === "driver" && message.data) {
        const { latitude, longitude, heading, speed } = message.data;
        // Validate location data before broadcasting
        if (typeof latitude !== "number" || typeof longitude !== "number" ||
            latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
          break;
        }
        broadcastToTenant(client.tenantId, WS_EVENTS.DRIVER_LOCATION_UPDATE, {
          driverId: client.userId,
          latitude,
          longitude,
          heading: typeof heading === "number" ? heading : undefined,
          speed: typeof speed === "number" ? speed : undefined,
          timestamp: new Date().toISOString(),
        });
      }
      break;
    case "ping":
      sendToClient(client.ws, WS_EVENTS.PONG, { timestamp: new Date().toISOString() });
      break;
  }
}

function sendToClient(ws: WebSocket, type: string, data: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data, timestamp: new Date().toISOString() }));
  }
}

// --- Redis Pub/Sub for multi-instance ---
async function initRedisPubSub() {
  if (!isRedisAvailable()) {
    logger.info("Redis not available — WebSocket in single-instance mode");
    return;
  }
  try {
    const mainRedis = getRedis();
    if (!mainRedis) return;
    redisSub = mainRedis.duplicate();
    redisPub = mainRedis;

    await redisSub.subscribe(REDIS_CHANNEL);
    redisSub.on("message", (channel: string, message: string) => {
      if (channel !== REDIS_CHANNEL) return;
      try {
        const { tenantId, userId, role, type, data, targetType } = JSON.parse(message);
        switch (targetType) {
          case "tenant": localBroadcastToTenant(tenantId, type, data); break;
          case "user": localBroadcastToUser(userId, type, data); break;
          case "role": localBroadcastToRole(tenantId, role, type, data); break;
        }
      } catch { /* ignore */ }
    });
    logger.info("Redis Pub/Sub initialized for WebSocket broadcast");
  } catch (err: any) {
    logger.warn("Failed to init Redis Pub/Sub", { error: err.message });
  }
}

function localBroadcastToTenant(tenantId: string, type: string, data: any) {
  const clients = tenantClients.get(tenantId);
  if (!clients) return;
  const msg = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(msg);
  }
}

function localBroadcastToUser(userId: string, type: string, data: any) {
  const clients = userClients.get(userId);
  if (!clients) return;
  const msg = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) client.ws.send(msg);
  }
}

function localBroadcastToRole(tenantId: string, role: string, type: string, data: any) {
  const clients = tenantClients.get(tenantId);
  if (!clients) return;
  const msg = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.role === role && client.ws.readyState === WebSocket.OPEN) client.ws.send(msg);
  }
}

// --- Public broadcast (local + Redis) ---
export function broadcastToTenant(tenantId: string, type: string, data: any) {
  localBroadcastToTenant(tenantId, type, data);
  publishToRedis({ targetType: "tenant", tenantId, type, data });
}

export function broadcastToUser(userId: string, type: string, data: any) {
  localBroadcastToUser(userId, type, data);
  publishToRedis({ targetType: "user", userId, type, data });
}

export function broadcastToRole(tenantId: string, role: string, type: string, data: any) {
  localBroadcastToRole(tenantId, role, type, data);
  publishToRedis({ targetType: "role", tenantId, role, type, data });
}

function publishToRedis(payload: Record<string, any>) {
  if (redisPub && isRedisAvailable()) {
    redisPub.publish(REDIS_CHANNEL, JSON.stringify(payload)).catch((err: any) => {
      logger.warn("Redis publish failed", { error: err.message });
    });
  }
}

// --- Driver Presence ---
export function getOnlineDrivers(tenantId?: string) {
  const result: Array<{ driverId: string; tenantId: string; connectedAt: Date; lastPingAt: Date }> = [];
  for (const [driverId, presence] of driverPresence) {
    if (!tenantId || presence.tenantId === tenantId) {
      result.push({ driverId, ...presence });
    }
  }
  return result;
}

export function isDriverOnline(driverId: string): boolean {
  return driverPresence.has(driverId);
}

// --- Stats ---
export function getConnectedStats() {
  let totalConnections = 0;
  const byTenant: Record<string, number> = {};
  const byRole: Record<string, number> = {};

  for (const [tenantId, clients] of tenantClients) {
    byTenant[tenantId] = clients.size;
    totalConnections += clients.size;
    for (const client of clients) {
      byRole[client.role] = (byRole[client.role] || 0) + 1;
    }
  }

  return { totalConnections, byTenant, byRole, onlineDrivers: driverPresence.size };
}

// --- Graceful shutdown ---
export async function shutdownWebSocket(): Promise<void> {
  if (!wss) return;

  // Notify all clients of shutdown
  const msg = JSON.stringify({ type: "server:shutdown", data: { message: "Server is restarting" }, timestamp: new Date().toISOString() });
  for (const [, clients] of tenantClients) {
    for (const client of clients) {
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(msg);
          client.ws.close(1001, "Server shutting down");
        }
      } catch { /* ignore errors during shutdown */ }
    }
  }

  // Clean up Redis pub/sub
  if (redisSub) {
    try {
      await redisSub.unsubscribe(REDIS_CHANNEL);
    } catch { /* non-fatal */ }
  }

  // Close the WebSocket server
  return new Promise((resolve) => {
    wss!.close(() => {
      logger.info("WebSocket server closed");
      resolve();
    });
    // Force-close after 3s
    setTimeout(resolve, 3000);
  });
}
