import type { Request, Response, NextFunction } from "express";

// ── PII Masking ─────────────────────────────────────────────────────────────

const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // SSN: 123-45-6789 or 123456789
  { pattern: /\b\d{3}-?\d{2}-?\d{4}\b/g, replacement: "***-**-****" },
  // Phone: various US formats
  { pattern: /\b(\+?1?[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: "***-***-****" },
  // DOB-like dates: YYYY-MM-DD or MM/DD/YYYY
  { pattern: /\b(19|20)\d{2}[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/g, replacement: "****-**-**" },
  { pattern: /\b(0[1-9]|1[0-2])[/](0[1-9]|[12]\d|3[01])[/](19|20)\d{2}\b/g, replacement: "**/**/*****" },
  // Email (mask local part)
  { pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, replacement: "***@***.***" },
];

function maskPii(value: string): string {
  let masked = value;
  for (const { pattern, replacement } of PII_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  return masked;
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
      path: maskPii(path),
      statusCode: res.statusCode,
      durationMs,
      userId: user?.userId ?? null,
      role: user?.role ?? null,
      companyId: user?.companyId ?? null,
      requestId: req.requestId ?? null,
      userAgent: req.headers["user-agent"]
        ? maskPii(req.headers["user-agent"])
        : null,
      ip: getClientIp(req),
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? "unknown";
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
