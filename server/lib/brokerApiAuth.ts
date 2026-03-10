/**
 * Broker External API Authentication Middleware
 *
 * Validates API keys (Bearer br_xxxxx), checks permissions, enforces rate limits
 * and IP whitelisting for the external broker API (v1).
 */
import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { db } from "../db";
import { brokerApiKeys, brokerApiLogs, brokers } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { incr } from "./redis";

// Extend Request for broker API context
export interface BrokerApiRequest extends Request {
  broker: {
    id: number;
    brokerId: number;
    apiKeyId: number;
    permissions: string[];
    brokerName: string;
    brokerStatus: string;
  };
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Core authentication middleware for broker external API.
 * Validates Bearer token, checks broker status, rate limits, IP whitelist.
 */
export function authenticateBrokerApi(requiredPermission?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer br_")) {
      return res.status(401).json({
        error: "unauthorized",
        message: "Missing or invalid API key. Use Authorization: Bearer br_xxxxx",
      });
    }

    const rawKey = authHeader.slice(7); // Remove "Bearer "
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.slice(0, 8);

    try {
      // Look up the API key
      const [apiKey] = await db
        .select()
        .from(brokerApiKeys)
        .where(and(eq(brokerApiKeys.keyHash, keyHash), eq(brokerApiKeys.isActive, true)))
        .limit(1);

      if (!apiKey) {
        await logApiCallDirect(null, null, req, 401, startTime);
        return res.status(401).json({
          error: "unauthorized",
          message: "Invalid or inactive API key",
        });
      }

      // Check expiration
      if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
        await logApiCallDirect(apiKey.brokerId, apiKey.id, req, 401, startTime);
        return res.status(401).json({
          error: "unauthorized",
          message: "API key has expired",
        });
      }

      // Verify broker is active
      const [broker] = await db
        .select()
        .from(brokers)
        .where(eq(brokers.id, apiKey.brokerId))
        .limit(1);

      if (!broker || broker.status !== "ACTIVE") {
        await logApiCallDirect(apiKey.brokerId, apiKey.id, req, 403, startTime);
        return res.status(403).json({
          error: "forbidden",
          message: "Broker account is not active",
        });
      }

      // Check IP whitelist
      if (apiKey.ipWhitelist && apiKey.ipWhitelist.length > 0) {
        const clientIp = req.ip || req.socket.remoteAddress || "unknown";
        const normalizedIp = clientIp.replace("::ffff:", "");
        if (!apiKey.ipWhitelist.includes(normalizedIp) && !apiKey.ipWhitelist.includes(clientIp)) {
          await logApiCallDirect(apiKey.brokerId, apiKey.id, req, 403, startTime);
          return res.status(403).json({
            error: "forbidden",
            message: "Request IP not in whitelist",
          });
        }
      }

      // Rate limiting (per minute per API key)
      const rateLimitKey = `broker_api_rl:${apiKey.id}`;
      const currentCount = await incr(rateLimitKey, 60);
      const limit = apiKey.rateLimit || 100;

      res.setHeader("X-RateLimit-Limit", limit.toString());
      res.setHeader("X-RateLimit-Remaining", Math.max(0, limit - currentCount).toString());

      if (currentCount > limit) {
        await logApiCallDirect(apiKey.brokerId, apiKey.id, req, 429, startTime);
        return res.status(429).json({
          error: "rate_limited",
          message: `Rate limit exceeded. Maximum ${limit} requests per minute.`,
          retryAfterSeconds: 60,
        });
      }

      // Check permission
      if (requiredPermission && !apiKey.permissions.includes(requiredPermission)) {
        await logApiCallDirect(apiKey.brokerId, apiKey.id, req, 403, startTime);
        return res.status(403).json({
          error: "forbidden",
          message: `API key lacks required permission: ${requiredPermission}`,
          requiredPermission,
          currentPermissions: apiKey.permissions,
        });
      }

      // Update last used timestamp (fire and forget)
      db.update(brokerApiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(brokerApiKeys.id, apiKey.id))
        .catch(() => {});

      // Attach broker context to request
      (req as BrokerApiRequest).broker = {
        id: broker.id,
        brokerId: broker.id,
        apiKeyId: apiKey.id,
        permissions: apiKey.permissions,
        brokerName: broker.name,
        brokerStatus: broker.status,
      };

      // Intercept response to log the call
      const originalJson = res.json.bind(res);
      res.json = function (body: any) {
        logApiCallDirect(apiKey.brokerId, apiKey.id, req, res.statusCode, startTime, body).catch(
          () => {},
        );
        return originalJson(body);
      };

      next();
    } catch (err: any) {
      console.error("[BrokerAPI] Auth error:", err.message);
      return res.status(500).json({
        error: "internal_error",
        message: "Authentication service unavailable",
      });
    }
  };
}

/**
 * Log an API call to the broker_api_logs table.
 */
async function logApiCallDirect(
  brokerId: number | null,
  apiKeyId: number | null,
  req: Request,
  statusCode: number,
  startTime: number,
  responseBody?: any,
): Promise<void> {
  try {
    const latencyMs = Date.now() - startTime;
    const ipAddress = req.ip || req.socket.remoteAddress || "unknown";

    // Sanitize request body (remove sensitive fields)
    let requestBody = null;
    if (req.body && typeof req.body === "object") {
      const sanitized = { ...req.body };
      delete sanitized.password;
      delete sanitized.secret;
      delete sanitized.apiKey;
      requestBody = sanitized;
    }

    // Truncate response body if too large
    let respBody = responseBody;
    if (respBody) {
      const str = JSON.stringify(respBody);
      if (str.length > 10000) {
        respBody = { _truncated: true, size: str.length };
      }
    }

    await db.insert(brokerApiLogs).values({
      brokerId: brokerId!,
      apiKeyId,
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode,
      requestBody,
      responseBody: respBody,
      ipAddress,
      latencyMs,
    });
  } catch (err: any) {
    console.warn("[BrokerAPI] Failed to log API call:", err.message);
  }
}
