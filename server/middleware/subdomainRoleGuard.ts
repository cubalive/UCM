import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { getAppKeyForHostname, type AppKey } from "../config/apps";

/**
 * Maps subdomain app keys to the roles allowed to access them.
 * If a subdomain is not listed here, no restriction is applied.
 */
const SUBDOMAIN_ALLOWED_ROLES: Partial<Record<AppKey, string[]>> = {
  dispatch: ["SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"],
  driver: ["SUPER_ADMIN", "DRIVER"],
  clinic: ["SUPER_ADMIN", "CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"],
  pharmacy: ["SUPER_ADMIN", "PHARMACY_ADMIN", "PHARMACY_USER"],
  broker: ["SUPER_ADMIN", "BROKER_ADMIN", "BROKER_USER"],
};

/**
 * Server-side subdomain role enforcement.
 * Blocks authenticated users from accessing portal subdomains
 * they don't have the correct role for.
 *
 * Unauthenticated requests pass through (auth routes need to work).
 * Only applies to /api routes (static assets are unaffected).
 */
export function subdomainRoleGuard(req: AuthRequest, res: Response, next: NextFunction) {
  // Only enforce on API routes
  if (!req.path.startsWith("/api")) return next();

  // Allow auth endpoints so users can log in / check session
  if (req.path.startsWith("/api/auth/")) return next();
  // Allow health checks
  if (req.path.startsWith("/api/health")) return next();
  // Allow public endpoints
  if (req.path.startsWith("/api/public")) return next();

  // No user yet — let downstream auth middleware handle it
  if (!req.user) return next();

  const hostname = req.hostname || "";
  const appKey = getAppKeyForHostname(hostname);
  const allowedRoles = SUBDOMAIN_ALLOWED_ROLES[appKey];

  // No restriction for this subdomain (e.g. admin/app)
  if (!allowedRoles) return next();

  if (!allowedRoles.includes(req.user.role)) {
    console.log(JSON.stringify({
      level: "warn",
      event: "subdomain_role_denied",
      hostname,
      appKey,
      userId: req.user.userId,
      role: req.user.role,
      path: req.path,
      requestId: req.requestId,
      ts: new Date().toISOString(),
    }));
    return res.status(403).json({
      message: "Access denied for this portal",
      code: "SUBDOMAIN_ROLE_MISMATCH",
    });
  }

  next();
}
