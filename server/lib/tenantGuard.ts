import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { logSystemEvent } from "./systemEvents";

const SUPER_ADMIN_BYPASS_ROLES = ["SUPER_ADMIN"];

const TENANT_EXEMPT_PATHS = new Set([
  "/api/health",
  "/api/pwa/health",
  "/api/auth/login",
  "/api/auth/login-jwt",
  "/api/auth/me",
  "/api/auth/token-login",
  "/api/auth/magic-link",
  "/api/auth/magic-link/verify",
  "/api/auth/change-password",
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

export function tenantGuard(req: AuthRequest, res: Response, next: NextFunction) {
  if (isTenantExempt(req.path)) return next();
  if (!req.user) return next();

  if (SUPER_ADMIN_BYPASS_ROLES.includes(req.user.role)) {
    const headerVal = req.headers["x-ucm-company-id"];
    if (headerVal) {
      const parsed = parseInt(String(headerVal), 10);
      if (!isNaN(parsed) && parsed > 0) {
        (req as any).companyId = parsed;
        console.info(`[TENANT] SUPER_ADMIN userId=${req.user.userId} override companyId=${parsed} path=${req.path}`);
      }
    }
    return next();
  }

  const companyId = req.user.companyId;
  if (!companyId) {
    return next();
  }

  (req as any).companyId = companyId;
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
        console.info(`[TENANT] SUPER_ADMIN userId=${req.user.userId} override companyId=${parsed} path=${req.path}`);
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
    }).catch(() => {});
    return res.status(403).json({
      message: "Company context required",
      code: "COMPANY_REQUIRED",
    });
  }

  (req as any).companyId = companyId;
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
    }).catch(() => {});
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
