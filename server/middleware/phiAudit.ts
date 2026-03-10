/**
 * HIPAA-Grade PHI Access Audit Middleware
 *
 * Logs all access to Protected Health Information (PHI) endpoints.
 * HIPAA §164.312(b) requires audit controls for systems handling PHI.
 *
 * Captures: who accessed what, when, from where, and the outcome.
 */

import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";

interface PhiAuditEntry {
  event: "phi_access";
  timestamp: string;
  requestId: string | undefined;
  userId: number | undefined;
  userRole: string | undefined;
  companyId: number | null | undefined;
  method: string;
  path: string;
  resourceType: string;
  resourceId: string | null;
  ip: string;
  userAgent: string;
  statusCode: number;
  durationMs: number;
  outcome: "success" | "denied" | "error";
}

/** Routes that access PHI data */
const PHI_PATTERNS: Array<{ pattern: RegExp; resourceType: string }> = [
  { pattern: /^\/api\/patients\/?/, resourceType: "patient" },
  { pattern: /^\/api\/trips\/\d+/, resourceType: "trip" },
  { pattern: /^\/api\/trips\/?$/, resourceType: "trip_list" },
  { pattern: /^\/api\/driver-portal\/trips/, resourceType: "driver_trip" },
  { pattern: /^\/api\/clinic-portal\/trips/, resourceType: "clinic_trip" },
  { pattern: /^\/api\/clinic-portal\/patients/, resourceType: "clinic_patient" },
  { pattern: /^\/api\/invoices/, resourceType: "invoice" },
  { pattern: /^\/api\/billing/, resourceType: "billing" },
  { pattern: /^\/api\/drivers\/\d+/, resourceType: "driver" },
  { pattern: /^\/api\/import/, resourceType: "data_import" },
  { pattern: /^\/api\/reports/, resourceType: "report" },
  { pattern: /^\/api\/tracking/, resourceType: "tracking" },
];

function getClientIp(req: AuthRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

function extractResourceId(path: string): string | null {
  const match = path.match(/\/(\d+)(?:\/|$)/);
  return match ? match[1] : null;
}

function matchPhiRoute(path: string): { resourceType: string } | null {
  for (const entry of PHI_PATTERNS) {
    if (entry.pattern.test(path)) {
      return { resourceType: entry.resourceType };
    }
  }
  return null;
}

/**
 * Middleware that logs HIPAA-compliant audit entries for PHI access.
 * Place AFTER auth middleware so req.user is populated.
 */
export function phiAuditMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const phiMatch = matchPhiRoute(req.path);
  if (!phiMatch) return next();

  const startTime = Date.now();

  // Capture response finish to log with status code
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    let outcome: PhiAuditEntry["outcome"] = "success";
    if (statusCode === 401 || statusCode === 403) {
      outcome = "denied";
    } else if (statusCode >= 500) {
      outcome = "error";
    }

    const entry: PhiAuditEntry = {
      event: "phi_access",
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
      userId: req.user?.userId,
      userRole: req.user?.role,
      companyId: req.user?.companyId,
      method: req.method,
      path: req.path,
      resourceType: phiMatch.resourceType,
      resourceId: extractResourceId(req.path),
      ip: getClientIp(req),
      userAgent: (req.headers["user-agent"] || "").slice(0, 200),
      statusCode,
      durationMs: duration,
      outcome,
    };

    // Structured JSON log — can be ingested by SIEM/CloudWatch/Datadog
    console.log(JSON.stringify(entry));

    // Log denied access at warn level for alerting
    if (outcome === "denied") {
      console.warn(JSON.stringify({
        ...entry,
        alert: "phi_access_denied",
        severity: "HIGH",
      }));
    }
  });

  next();
}

/**
 * Log a specific PHI data export event (CSV, PDF, etc.)
 * Call this explicitly when generating exports containing PHI.
 */
export function logPhiExport(
  req: AuthRequest,
  resourceType: string,
  exportFormat: string,
  recordCount: number,
): void {
  console.log(JSON.stringify({
    event: "phi_export",
    timestamp: new Date().toISOString(),
    requestId: req.requestId,
    userId: req.user?.userId,
    userRole: req.user?.role,
    companyId: req.user?.companyId,
    resourceType,
    exportFormat,
    recordCount,
    ip: getClientIp(req),
    userAgent: (req.headers["user-agent"] || "").slice(0, 200),
    severity: "MEDIUM",
  }));
}
