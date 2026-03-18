import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// ── PHI Field Names to Redact ─────────────────────────────────────────────
// Auto-redact these field names in any logged object
const PHI_FIELD_NAMES = new Set([
  "firstname", "lastname", "fullname", "patientname", "name",
  "ssn", "socialsecuritynumber",
  "dob", "dateofbirth", "birthdate",
  "phone", "phonenumber", "cellphone", "mobilephone", "homephone",
  "email", "emailaddress",
  "address", "streetaddress", "homeaddress", "mailingaddress",
  "mrn", "medicalrecordnumber",
  "memberid", "subscriberid", "policyid",
  "notes", "comments", "originalmessage",
  "patientfirstname", "patientlastname",
  "driverfirstname", "driverlastname",
  "contactname", "emergencycontact",
  "insuranceid", "medicaidid",
]);

// ── PII Regex Patterns ─────────────────────────────────────────────────────

const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // SSN: 123-45-6789 or 123456789
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN-REDACTED]" },
  { pattern: /\b\d{9}\b/g, replacement: "[SSN-REDACTED]" },
  // Phone: various US formats
  { pattern: /\b(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: "[PHONE-REDACTED]" },
  // DOB-like dates: YYYY-MM-DD or MM/DD/YYYY
  { pattern: /\b(19|20)\d{2}[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/g, replacement: "[DATE-REDACTED]" },
  { pattern: /\b(0[1-9]|1[0-2])[/](0[1-9]|[12]\d|3[01])[/](19|20)\d{2}\b/g, replacement: "[DATE-REDACTED]" },
  // Email
  { pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, replacement: "[EMAIL-REDACTED]" },
];

/**
 * Redact PHI field names from an object (deep).
 */
function redactPhiFields(obj: unknown, depth: number = 0): unknown {
  if (depth > 10) return "[DEEP-REDACTED]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return maskPiiPatterns(obj);
  if (typeof obj === "number" || typeof obj === "boolean") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactPhiFields(item, depth + 1));
  }

  if (typeof obj === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
      if (PHI_FIELD_NAMES.has(normalizedKey)) {
        redacted[key] = "[PHI-REDACTED]";
      } else {
        redacted[key] = redactPhiFields(value, depth + 1);
      }
    }
    return redacted;
  }

  return obj;
}

function maskPiiPatterns(value: string): string {
  let masked = value;
  for (const { pattern, replacement } of PII_PATTERNS) {
    // Reset regex lastIndex since we're using /g
    pattern.lastIndex = 0;
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

/**
 * Sanitize error message — never log originalMessage, truncate to 200 chars.
 */
function sanitizeErrorMessage(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") {
    return maskPiiPatterns(err.slice(0, 200));
  }
  if (typeof err === "object" && err !== null) {
    // Never log originalMessage — only use message
    const msg = (err as any).message || String(err);
    return maskPiiPatterns(String(msg).slice(0, 200));
  }
  return String(err).slice(0, 200);
}

// ── Paths to skip logging (healthchecks, static assets) ─────────────────────

const SKIP_PATHS = new Set([
  "/api/health/live",
  "/api/health/ready",
  "/favicon.ico",
]);

function shouldSkip(path: string): boolean {
  if (SKIP_PATHS.has(path)) return true;
  // Skip static assets
  if (
    path.startsWith("/assets/") ||
    path.startsWith("/node_modules/") ||
    path.endsWith(".js") ||
    path.endsWith(".css") ||
    path.endsWith(".map") ||
    path.endsWith(".ico") ||
    path.endsWith(".png") ||
    path.endsWith(".svg") ||
    path.endsWith(".woff") ||
    path.endsWith(".woff2")
  ) {
    return true;
  }
  return false;
}

// ── Middleware ───────────────────────────────────────────────────────────────

export function structuredLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const path = req.path;

  // Skip noisy endpoints
  if (shouldSkip(path)) {
    next();
    return;
  }

  // Only log API requests
  if (!path.startsWith("/api")) {
    next();
    return;
  }

  const startTime = Date.now();

  // Log on response finish (not start)
  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    const user = (req as any).user as
      | { userId?: number; role?: string; companyId?: number | null }
      | undefined;

    const entry: Record<string, unknown> = {
      event: "http_request",
      method: req.method,
      path: maskPiiPatterns(path),
      statusCode: res.statusCode,
      durationMs,
      userId: user?.userId ?? null,
      role: user?.role ?? null,
      companyId: user?.companyId ?? null,
      requestId: req.requestId ?? null,
      userAgent: req.headers["user-agent"]
        ? maskPiiPatterns(req.headers["user-agent"])
        : null,
      ip: hashClientIp(req),
      contentLength: res.getHeader("content-length") ?? null,
      error: res.statusCode >= 400 ? getErrorHint(res.statusCode) : null,
      ts: new Date().toISOString(),
    };

    // Log at appropriate level
    if (res.statusCode >= 500) {
      console.error(JSON.stringify(entry));
    } else if (res.statusCode >= 400) {
      console.warn(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  });

  next();
}

// ── Exported Utilities ──────────────────────────────────────────────────────

/** Redact PHI from any object before logging. */
export { redactPhiFields, maskPiiPatterns, sanitizeErrorMessage };

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Hash IP for HIPAA compliance — never log raw IPs */
function hashClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  let ip: string;
  if (typeof forwarded === "string") {
    ip = forwarded.split(",")[0].trim();
  } else {
    ip = req.socket?.remoteAddress ?? "unknown";
  }
  if (ip === "unknown") return ip;
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

function getErrorHint(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 422:
      return "validation_error";
    case 429:
      return "rate_limited";
    case 500:
      return "internal_error";
    case 502:
      return "bad_gateway";
    case 503:
      return "service_unavailable";
    default:
      return `http_${statusCode}`;
  }
}
