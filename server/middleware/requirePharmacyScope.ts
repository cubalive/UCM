import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";

export const PHARMACY_SCOPED_ROLES = ["PHARMACY_ADMIN", "PHARMACY_USER"];

export function requirePharmacyScope(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }

  if (req.user.role === "SUPER_ADMIN") {
    return next();
  }

  if (PHARMACY_SCOPED_ROLES.includes(req.user.role)) {
    if (!req.user.pharmacyId) {
      return res.status(403).json({
        message: "Pharmacy context required",
        code: "PHARMACY_SCOPE_REQUIRED",
      });
    }
    (req as any).pharmacyScopeId = req.user.pharmacyId;
    (req as any).pharmacyCompanyId = req.user.companyId;
    return next();
  }

  if (["ADMIN", "COMPANY_ADMIN", "DISPATCH"].includes(req.user.role)) {
    if (req.user.pharmacyId) {
      (req as any).pharmacyScopeId = req.user.pharmacyId;
      (req as any).pharmacyCompanyId = req.user.companyId;
    }
    return next();
  }

  return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
}

export function getPharmacyScopeId(req: AuthRequest): number | null {
  return (req as any).pharmacyScopeId ?? req.user?.pharmacyId ?? null;
}

export function requirePharmacyAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }

  if (req.user.role === "SUPER_ADMIN" || req.user.role === "ADMIN" || req.user.role === "COMPANY_ADMIN") {
    return next();
  }

  if (req.user.role === "PHARMACY_ADMIN" && req.user.pharmacyId) {
    (req as any).pharmacyScopeId = req.user.pharmacyId;
    return next();
  }

  return res.status(403).json({ message: "Forbidden: PHARMACY_ADMIN role required", code: "FORBIDDEN" });
}
