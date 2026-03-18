/**
 * Broker External API Authentication Middleware
 *
 * Validates API keys (Bearer br_xxxxx), checks permissions, enforces rate limits
 * and IP whitelisting for the external broker API (v1).
 */
import type { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "crypto";
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
 * Constant-time comparison for API key hashes to prevent timing attacks.
 */
function safeCompareHashes(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
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

    try {
      // Look up active API keys and compare with timing-safe comparison
      const activeKeys = await db
        .select()
        .from(brokerApiKeys)
        .where(eq(brokerApiKeys.isActive, true))
        .limit(100);

      const apiKey = activeKeys.find((k) => safeCompareHashes(k.keyHash, keyHash));

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

      // S3 FIX: Check permission — NEVER leak currentPermissions in response
      if (requiredPermission && !apiKey.permissions.includes(requiredPermission)) {
        // Log the details internally for debugging
        console.warn(JSON.stringify({
          event: "broker_api_insufficient_permission",
          brokerId: apiKey.brokerId,
          apiKeyId: apiKey.id,
          requiredPermission,
          path: req.path,
          method: req.method,
          ip: req.ip || req.socket.remoteAddress || "unknown",
          ts: new Date().toISOString(),
        }));
        await logApiCallDirect(apiKey.brokerId, apiKey.id, req, 403, startTime);
        // Return ONLY the error — no permission details
        return res.status(403).json({
          error: "Insufficient permissions",
        });
      }

      // Update last used timestamp (fire and forget with error logging)
      db.update(brokerApiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(brokerApiKeys.id, apiKey.id))
        .catch((err: any) => {
          console.error("[BrokerAPI] Failed to update lastUsedAt:", err.message);
        });

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
          (err: any) => {
            console.error("[BrokerAPI] Failed to log API call:", err.message);
          },
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
      delete sanitized.token;
      delete sanitized.ssn;
      delete sanitized.dateOfBirth;
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
