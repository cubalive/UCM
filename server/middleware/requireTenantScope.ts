import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";

const SUPER_ADMIN_ROLE = "SUPER_ADMIN";

const TENANT_EXEMPT_ROLES = new Set(["DRIVER", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER", "VIEWER"]);

export function requireTenantScope(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }

  if (req.user.role === SUPER_ADMIN_ROLE) {
    const headerVal = req.headers["x-ucm-company-id"];
    if (headerVal) {
      const parsed = parseInt(String(headerVal), 10);
      if (!isNaN(parsed) && parsed > 0) {
        (req as any).tenantId = parsed;
      }
    }
    return next();
  }

  const companyId = req.user.companyId;

  if (!companyId) {
    if (TENANT_EXEMPT_ROLES.has(req.user.role)) {
      return next();
    }

    logTenantDenial(req, "missing_company_id");
    return res.status(403).json({
      message: "Company context required",
      code: "TENANT_SCOPE_REQUIRED",
    });
  }

  (req as any).tenantId = companyId;
  next();
}

export function getTenantId(req: AuthRequest): number | null {
  return (req as any).tenantId ?? null;
}

export function requireStrictTenant(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }

  if (req.user.role === SUPER_ADMIN_ROLE) {
    const headerVal = req.headers["x-ucm-company-id"];
    if (headerVal) {
      const parsed = parseInt(String(headerVal), 10);
      if (!isNaN(parsed) && parsed > 0) {
        (req as any).tenantId = parsed;
      }
    }
    return next();
  }

  const companyId = req.user.companyId;
  if (!companyId) {
    logTenantDenial(req, "strict_missing_company_id");
    return res.status(403).json({
      message: "Company context required",
      code: "TENANT_SCOPE_REQUIRED",
    });
  }

  (req as any).tenantId = companyId;
  next();
}

export function checkEntityTenantAccess(
  entity: { companyId?: number | null } | undefined | null,
  tenantId: number | null,
  req: AuthRequest,
  entityType: string,
  entityId: string | number
): boolean {
  if (!tenantId) return true;
  if (!entity) return false;
  if (entity.companyId === null || entity.companyId === undefined) return true;

  if (entity.companyId !== tenantId) {
    logTenantDenial(req, "cross_tenant_access", {
      entityType,
      entityId: String(entityId),
      entityCompanyId: entity.companyId,
      requestTenantId: tenantId,
    });
    return false;
  }
  return true;
}

function logTenantDenial(req: AuthRequest, reason: string, extra?: Record<string, any>) {
  const payload = {
    reason,
    role: req.user?.role,
    userId: req.user?.userId,
    method: req.method,
    path: req.path,
    userCompanyId: req.user?.companyId,
    ...extra,
  };

  console.warn(`[TENANT_DENIED] ${reason} | user=${req.user?.userId} role=${req.user?.role} path=${req.method} ${req.path}`, JSON.stringify(payload));

  try {
    import("../lib/systemEvents").then(({ logSystemEvent }) => {
      logSystemEvent({
        companyId: req.user?.companyId ?? null,
        actorUserId: req.user?.userId ?? null,
        eventType: "tenant_access_denied",
        entityType: "request",
        entityId: req.path,
        payload,
      }).catch(() => {});
    });
  } catch {}
}
