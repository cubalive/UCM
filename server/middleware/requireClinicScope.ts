import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { CLINIC_SCOPED_ROLES } from "../auth";
import { db } from "../db";
import { clinics } from "@shared/schema";
import { eq } from "drizzle-orm";

export function requireClinicScope(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }

  if (req.user.role === "SUPER_ADMIN") {
    return next();
  }

  if (CLINIC_SCOPED_ROLES.includes(req.user.role)) {
    if (!req.user.clinicId) {
      return res.status(403).json({
        message: "Clinic context required",
        code: "CLINIC_SCOPE_REQUIRED",
      });
    }
    (req as any).clinicScopeId = req.user.clinicId;
    (req as any).clinicCompanyId = req.user.companyId;
    return next();
  }

  if (["ADMIN", "COMPANY_ADMIN", "DISPATCH"].includes(req.user.role)) {
    if (!req.user.clinicId && req.user.companyId) {
      db.select({ id: clinics.id })
        .from(clinics)
        .where(eq(clinics.companyId, req.user.companyId))
        .limit(1)
        .then((rows) => {
          if (rows.length > 0) {
            (req as any).clinicScopeId = rows[0].id;
            (req as any).clinicCompanyId = req.user!.companyId;
          }
          next();
        })
        .catch((err) => {
          console.error(`[requireClinicScope] DB error resolving clinic for companyId=${req.user!.companyId}: ${err.message}`);
          next();
        });
      return;
    }
    if (req.user.clinicId) {
      (req as any).clinicScopeId = req.user.clinicId;
      (req as any).clinicCompanyId = req.user.companyId;
    }
    return next();
  }

  return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
}

export function getClinicScopeId(req: AuthRequest): number | null {
  return (req as any).clinicScopeId ?? req.user?.clinicId ?? null;
}

export function requireClinicAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized", code: "UNAUTHORIZED" });
  }

  if (req.user.role === "SUPER_ADMIN" || req.user.role === "ADMIN" || req.user.role === "COMPANY_ADMIN") {
    return next();
  }

  if (req.user.role === "CLINIC_ADMIN" && req.user.clinicId) {
    (req as any).clinicScopeId = req.user.clinicId;
    return next();
  }

  return res.status(403).json({ message: "Forbidden: CLINIC_ADMIN role required", code: "FORBIDDEN" });
}
