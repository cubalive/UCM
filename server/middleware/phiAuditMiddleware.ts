/**
 * HIPAA PHI Access Audit Middleware — Database-Persisted
 *
 * Extends PHI audit logging by persisting access records to the audit_log table.
 * HIPAA §164.312(b) requires audit controls that record and examine access to PHI.
 *
 * Unlike phiAudit.ts (console/SIEM logging), this middleware writes durable
 * records to PostgreSQL for long-term retention and compliance reporting.
 */

import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { db } from "../db";
import { auditLog } from "@shared/schema";

/** Routes containing Protected Health Information */
const PHI_ROUTES: Array<{ pattern: RegExp; resourceType: string }> = [
  { pattern: /^\/api\/patients\/?/, resourceType: "patient" },
  { pattern: /^\/api\/trips\/\d+/, resourceType: "trip" },
  { pattern: /^\/api\/trips\/?$/, resourceType: "trip_list" },
  { pattern: /^\/api\/driver-portal\/trips/, resourceType: "driver_trip" },
  { pattern: /^\/api\/clinic-portal\/trips/, resourceType: "clinic_trip" },
  { pattern: /^\/api\/clinic-portal\/patients/, resourceType: "clinic_patient" },
  { pattern: /^\/api\/pharmacy\/orders/, resourceType: "pharmacy_order" },
  { pattern: /^\/api\/pharmacy\/active-deliveries/, resourceType: "pharmacy_delivery" },
];

function getClientIp(req: AuthRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

function extractResourceId(path: string): number | null {
  const match = path.match(/\/(\d+)(?:\/|$)/);
  return match ? parseInt(match[1], 10) : null;
}

function matchPhiRoute(path: string): { resourceType: string } | null {
  for (const entry of PHI_ROUTES) {
    if (entry.pattern.test(path)) {
      return { resourceType: entry.resourceType };
    }
  }
  return null;
}

/**
 * Express middleware that persists PHI access audit records to the database.
 * Place AFTER auth middleware so req.user is populated.
 *
 * Can be applied globally (like the console-based phiAudit middleware) or
 * selectively on specific route groups for targeted coverage.
 */
export function phiAuditDbMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const phiMatch = matchPhiRoute(req.path);
  if (!phiMatch) return next();

  const startTime = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    const statusCode = res.statusCode;

    let outcome: "success" | "denied" | "error" = "success";
    if (statusCode === 401 || statusCode === 403) {
      outcome = "denied";
    } else if (statusCode >= 500) {
      outcome = "error";
    }

    const ip = getClientIp(req);
    const resourceId = extractResourceId(req.path);

    // Fire-and-forget insert — do not block the response
    db.insert(auditLog)
      .values({
        userId: req.user?.userId ?? null,
        action: `phi_${req.method.toLowerCase()}`,
        entity: phiMatch.resourceType,
        entityId: resourceId,
        actorRole: req.user?.role ?? null,
        companyId: req.user?.companyId ?? null,
        details: `PHI access: ${req.method} ${req.path}`,
        metadataJson: {
          ip,
          userAgent: (req.headers["user-agent"] || "").slice(0, 200),
          statusCode,
          durationMs,
          outcome,
          requestId: req.requestId,
        },
      })
      .then(() => {
        // Successfully persisted
      })
      .catch((err) => {
        console.error("[PHI-AUDIT-DB] Failed to persist audit record:", err.message);
      });
  });

  next();
}

/**
 * Route-level middleware factory for targeted PHI audit on specific resource types.
 * Use when you want to override the auto-detected resource type.
 *
 * Example: router.get("/api/patients", authMiddleware, phiAuditFor("patient"), handler)
 */
export function phiAuditFor(resourceType: string) {
  return function (req: AuthRequest, res: Response, next: NextFunction) {
    const startTime = Date.now();

    res.on("finish", () => {
      const durationMs = Date.now() - startTime;
      const statusCode = res.statusCode;

      let outcome: "success" | "denied" | "error" = "success";
      if (statusCode === 401 || statusCode === 403) {
        outcome = "denied";
      } else if (statusCode >= 500) {
        outcome = "error";
      }

      const ip = getClientIp(req);
      const resourceId = extractResourceId(req.path);

      db.insert(auditLog)
        .values({
          userId: req.user?.userId ?? null,
          action: `phi_${req.method.toLowerCase()}`,
          entity: resourceType,
          entityId: resourceId,
          actorRole: req.user?.role ?? null,
          companyId: req.user?.companyId ?? null,
          details: `PHI access: ${req.method} ${req.path}`,
          metadataJson: {
            ip,
            userAgent: (req.headers["user-agent"] || "").slice(0, 200),
            statusCode,
            durationMs,
            outcome,
            requestId: req.requestId,
          },
        })
        .then(() => {})
        .catch((err) => {
          console.error("[PHI-AUDIT-DB] Failed to persist audit record:", err.message);
        });
    });

    next();
  };
}
