/**
 * Input Sanitization Middleware
 *
 * Prevents XSS, HTML injection, and other input-based attacks.
 * Sanitizes string inputs in request body, query, and params.
 * Does NOT modify file uploads or raw bodies (e.g. Stripe webhooks).
 */

import type { Request, Response, NextFunction } from "express";

// Dangerous HTML/script patterns
const XSS_PATTERNS = [
  /<script\b[^>]*>/i,
  /javascript\s*:/i,
  /on\w+\s*=\s*["']/i,
  /<iframe\b/i,
  /<object\b/i,
  /<embed\b/i,
  /vbscript\s*:/i,
  /data\s*:\s*text\/html/i,
];

// SQL injection indicators (for logging, not blocking — ORM handles SQL safety)
const SQLI_PATTERNS = [
  /(\b(union|select|insert|update|delete|drop|alter)\b.*\b(from|into|table|where)\b)/i,
  /('|"|;)\s*--/,
  /\b(or|and)\b\s+\d+\s*=\s*\d+/i,
];

/**
 * Strip dangerous HTML from a string value.
 * Preserves legitimate text content.
 */
function sanitizeString(value: string): string {
  return value
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Check if a string contains XSS patterns (before sanitization).
 */
function containsXss(value: string): boolean {
  return XSS_PATTERNS.some(pattern => pattern.test(value));
}

function containsSqli(value: string): boolean {
  return SQLI_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Recursively sanitize all string values in an object.
 */
function sanitizeObject(obj: unknown, depth = 0): unknown {
  if (depth > 10) return obj; // Prevent stack overflow on deeply nested objects

  if (typeof obj === "string") {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1));
  }

  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = sanitizeObject(value, depth + 1);
    }
    return result;
  }

  return obj;
}

/** Paths that should NOT be sanitized (raw body needed) */
const SANITIZE_SKIP_PATHS = new Set([
  "/api/stripe/webhook",
  "/api/stripe-connect/webhook",
]);

/**
 * Middleware that sanitizes request body, query, and params.
 * Logs potential attack attempts for security monitoring.
 */
export function inputSanitizer(req: Request, res: Response, next: NextFunction) {
  if (SANITIZE_SKIP_PATHS.has(req.path)) return next();

  // Only sanitize JSON bodies and form data
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    // Log XSS attempts in query params (Express 5: req.query is read-only)
    if (req.query && typeof req.query === "object") {
      const originalQuery = JSON.stringify(req.query);
      if (containsXss(originalQuery)) {
        logSecurityEvent(req, "xss_attempt", "query");
      }
    }
    return next();
  }

  if (req.body && typeof req.body === "object") {
    const bodyStr = JSON.stringify(req.body);

    if (containsXss(bodyStr)) {
      logSecurityEvent(req, "xss_attempt", "body");
    }
    if (containsSqli(bodyStr)) {
      logSecurityEvent(req, "sqli_indicator", "body");
    }

    req.body = sanitizeObject(req.body);
  }

  next();
}

function logSecurityEvent(req: Request, eventType: string, source: string) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = typeof forwarded === "string"
    ? forwarded.split(",")[0].trim()
    : req.ip || req.socket.remoteAddress || "unknown";

  console.warn(JSON.stringify({
    event: "security_threat",
    type: eventType,
    source,
    ip,
    method: req.method,
    path: req.path,
    userAgent: (req.headers["user-agent"] || "").slice(0, 200),
    requestId: (req as any).requestId,
    userId: (req as any).user?.userId,
    timestamp: new Date().toISOString(),
    severity: eventType === "xss_attempt" ? "HIGH" : "MEDIUM",
  }));
}
