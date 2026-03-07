import { WebSocketServer, WebSocket } from "ws";
import { Server } from "http";
import jwt from "jsonwebtoken";
import logger from "../lib/logger.js";
import type { AuthUser } from "../middleware/auth.js";

interface ConnectedClient {
  ws: WebSocket;
  userId: string;
  tenantId: string;
  role: string;
  connectedAt: Date;
}

// Connection registries
const tenantClients = new Map<string, Set<ConnectedClient>>();
const userClients = new Map<string, Set<ConnectedClient>>();

let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const token = url.searchParams.get("token");

    if (!token) {
      ws.close(4001, "Missing authentication token");
      return;
    }

    let user: AuthUser;
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new Error("JWT_SECRET not set");
      user = jwt.verify(token, secret) as AuthUser;
    } catch {
      ws.close(4002, "Invalid authentication token");
      return;
    }

    const client: ConnectedClient = {
      ws,
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      connectedAt: new Date(),
    };

    // Register client
    if (!tenantClients.has(user.tenantId)) {
      tenantClients.set(user.tenantId, new Set());
    }
    tenantClients.get(user.tenantId)!.add(client);

    if (!userClients.has(user.id)) {
      userClients.set(user.id, new Set());
    }
    userClients.get(user.id)!.add(client);

    logger.info("WebSocket client connected", {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });

    // Send connection confirmation
    sendToClient(ws, "connected", {
      userId: user.id,
      role: user.role,
      timestamp: new Date().toISOString(),
    });

    // Handle incoming messages (driver location updates, etc.)
    ws.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleClientMessage(client, message);
      } catch {
        // Ignore malformed messages
      }
    });

    // Cleanup on disconnect
    ws.on("close", () => {
      tenantClients.get(user.tenantId)?.delete(client);
      userClients.get(user.id)?.delete(client);

      if (tenantClients.get(user.tenantId)?.size === 0) {
        tenantClients.delete(user.tenantId);
      }
      if (userClients.get(user.id)?.size === 0) {
        userClients.delete(user.id);
      }

      logger.info("WebSocket client disconnected", { userId: user.id });
    });

    ws.on("error", (err) => {
      logger.error("WebSocket error", { userId: user.id, error: err.message });
    });
  });

  logger.info("WebSocket server initialized on /ws");
}

function handleClientMessage(client: ConnectedClient, message: { type: string; data?: any }) {
  switch (message.type) {
    case "driver:location_update":
      if (client.role === "driver" && message.data) {
        // Location updates are handled via REST for reliability,
        // but can also come through WS for lower latency
        broadcastToTenant(client.tenantId, "driver:location", {
          driverId: client.userId,
          ...message.data,
          timestamp: new Date().toISOString(),
        });
      }
      break;

    case "ping":
      sendToClient(client.ws, "pong", { timestamp: new Date().toISOString() });
      break;
  }
}

function sendToClient(ws: WebSocket, type: string, data: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data, timestamp: new Date().toISOString() }));
  }
}

export function broadcastToTenant(tenantId: string, type: string, data: any) {
  const clients = tenantClients.get(tenantId);
  if (!clients) return;

  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  }
}

export function broadcastToUser(userId: string, type: string, data: any) {
  const clients = userClients.get(userId);
  if (!clients) return;

  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });

  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  }
}

export function broadcastToRole(tenantId: string, role: string, type: string, data: any) {
  const clients = tenantClients.get(tenantId);
  if (!clients) return;

  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });

  for (const client of clients) {
    if (client.role === role && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  }
}

export function getConnectedStats() {
  let totalConnections = 0;
  const byTenant: Record<string, number> = {};

  for (const [tenantId, clients] of tenantClients) {
    byTenant[tenantId] = clients.size;
    totalConnections += clients.size;
  }

  return { totalConnections, byTenant };
}
