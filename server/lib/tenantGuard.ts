import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { logSystemEvent } from "./systemEvents";

const SUPER_ADMIN_BYPASS_ROLES = ["SUPER_ADMIN"];
/** Roles that are system-level and don't require companyId */
const SYSTEM_EXEMPT_ROLES = ["SUPER_ADMIN"];

const TENANT_EXEMPT_PATHS = new Set([
  "/api/health",
  "/api/health/live",
  "/api/health/ready",
  "/api/pwa/health",
  "/api/auth/login",
  "/api/auth/login-jwt",
  "/api/auth/me",
  "/api/auth/token-login",
  "/api/auth/magic-link",
  "/api/auth/magic-link/verify",
  "/api/auth/change-password",
  "/api/auth/refresh",
  "/api/auth/logout",
  "/api/cities",
  "/api/vehicle-makes",
  "/api/vehicle-models",
]);

function isTenantExempt(path: string): boolean {
  if (TENANT_EXEMPT_PATHS.has(path)) return true;
  if (path.startsWith("/api/public")) return true;
  if (path.startsWith("/api/verify/")) return true;
  if (path.startsWith("/api/tracking/")) return true;
  if (path.startsWith("/api/auth/")) return true;
  return false;
}

/**
 * Core tenant isolation middleware.
 * Ensures non-exempt users have a valid companyId and blocks cross-tenant access.
 */
export function tenantGuard(req: AuthRequest, res: Response, next: NextFunction) {
  if (isTenantExempt(req.path)) return next();
  if (!req.user) return next();

  // SUPER_ADMIN can impersonate companies via header
  if (SUPER_ADMIN_BYPASS_ROLES.includes(req.user.role)) {
    const headerVal = req.headers["x-ucm-company-id"];
    if (headerVal) {
      const parsed = parseInt(String(headerVal), 10);
      if (!isNaN(parsed) && parsed > 0) {
        (req as any).companyId = parsed;
        (req as any).tenantId = parsed;
      }
    }
    return next();
  }

  const companyId = req.user.companyId;

  // S2 FIX: Non-exempt users without companyId MUST be blocked (403)
  if (!companyId) {
    const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
    logSystemEvent({
      companyId: null,
      actorUserId: req.user.userId,
      eventType: "tenant_guard_blocked",
      entityType: "request",
      entityId: req.path,
      payload: {
        reason: "missing_company_id",
        method: req.method,
        role: req.user.role,
        ip: clientIp,
      },
    }).catch((err: any) => { if (err) console.error("[CATCH]", err.message || err); });

    return res.status(403).json({
      message: "Company context required",
      code: "COMPANY_REQUIRED",
    });
  }

  // Validate URL params match the token's companyId
  const urlCompanyId = req.params.companyId || req.params.tenantId;
  if (urlCompanyId) {
    const parsedUrlCompanyId = parseInt(String(urlCompanyId), 10);
    if (!isNaN(parsedUrlCompanyId) && parsedUrlCompanyId !== companyId) {
      const clientIp = req.ip || req.socket?.remoteAddress || "unknown";
      logSystemEvent({
        companyId,
        actorUserId: req.user.userId,
        eventType: "cross_tenant_blocked",
        entityType: "request",
        entityId: req.path,
        payload: {
          reason: "url_param_mismatch",
          method: req.method,
          role: req.user.role,
          tokenCompanyId: companyId,
          urlCompanyId: parsedUrlCompanyId,
          ip: clientIp,
        },
      }).catch((err: any) => { if (err) console.error("[CATCH]", err.message || err); });

      return res.status(403).json({
        message: "Access denied: cross-tenant request blocked",
        code: "CROSS_TENANT_DENIED",
      });
    }
  }

  (req as any).companyId = companyId;
  (req as any).tenantId = companyId;
  next();
}

export function getEffectiveCompanyId(req: AuthRequest): number | null {
  if (!req.user) return null;
  if (SUPER_ADMIN_BYPASS_ROLES.includes(req.user.role)) {
    const headerVal = req.headers["x-ucm-company-id"];
    if (headerVal) {
      const parsed = parseInt(String(headerVal), 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return null;
  }
  return req.user.companyId || null;
}

export function requireCompanyId(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });

  if (SUPER_ADMIN_BYPASS_ROLES.includes(req.user.role)) {
    const headerVal = req.headers["x-ucm-company-id"];
    if (headerVal) {
      const parsed = parseInt(String(headerVal), 10);
      if (!isNaN(parsed) && parsed > 0) {
        (req as any).companyId = parsed;
        (req as any).tenantId = parsed;
      }
    }
    return next();
  }

  const companyId = req.user.companyId;
  if (!companyId) {
    logSystemEvent({
      companyId: null,
      actorUserId: req.user.userId,
      eventType: "company_id_missing",
      entityType: "request",
      entityId: req.path,
      payload: { method: req.method, role: req.user.role },
    }).catch((err: any) => { if (err) console.error("[CATCH]", err.message || err); });
    return res.status(403).json({
      message: "Company context required",
      code: "COMPANY_REQUIRED",
    });
  }

  (req as any).companyId = companyId;
  (req as any).tenantId = companyId;
  next();
}

export function checkCrossCompanyAccess(
  entity: { companyId?: number | null } | undefined,
  requestCompanyId: number | null,
  req: AuthRequest,
  entityType: string,
  entityId: string | number
): boolean {
  if (!requestCompanyId) return true;
  if (!entity) return false;
  if (entity.companyId === null || entity.companyId === undefined) return true;

  if (entity.companyId !== requestCompanyId) {
    logSystemEvent({
      companyId: requestCompanyId,
      actorUserId: req.user?.userId || null,
      eventType: "cross_company_denied",
      entityType,
      entityId: String(entityId),
      payload: {
        requestedCompany: entity.companyId,
        userCompany: requestCompanyId,
        method: req.method,
        path: req.path,
      },
    }).catch((err: any) => { if (err) console.error("[CATCH]", err.message || err); });
    return false;
  }
  return true;
}

export function tenantRedisKey(companyId: number | null | undefined, ...parts: string[]): string {
  if (companyId) {
    return `company:${companyId}:${parts.join(":")}`;
  }
  return `global:${parts.join(":")}`;
}
