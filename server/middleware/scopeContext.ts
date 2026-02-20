import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { getUserCityIds } from "../auth";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface ScopeContext {
  role: string;
  userId: number;
  companyId: number | null;
  clinicId: number | null;
  driverId: number | null;
  cityId: number | null;
  allowedCityIds: number[];
  isSuperAdmin: boolean;
}

export async function getScope(req: AuthRequest): Promise<ScopeContext | null> {
  if (!req.user) return null;
  const { userId, role, companyId } = req.user;

  const userRow = await db
    .select({ clinicId: users.clinicId, driverId: users.driverId })
    .from(users)
    .where(eq(users.id, userId))
    .then(r => r[0]);

  let effectiveCompanyId = companyId || null;
  if (role === "SUPER_ADMIN") {
    const headerVal = req.headers["x-ucm-company-id"];
    if (headerVal) {
      const parsed = parseInt(String(headerVal), 10);
      if (!isNaN(parsed) && parsed > 0) effectiveCompanyId = parsed;
    }
  }

  const allowedCityIds = await getUserCityIds(userId, role, effectiveCompanyId);

  const requestedCityId = req.query.cityId ? parseInt(req.query.cityId as string) : null;
  const headerCityId = req.headers["x-city-id"] ? parseInt(req.headers["x-city-id"] as string) : null;
  const cityId = requestedCityId || headerCityId || null;

  return {
    role,
    userId,
    companyId: effectiveCompanyId,
    clinicId: userRow?.clinicId || null,
    driverId: userRow?.driverId || null,
    cityId,
    allowedCityIds,
    isSuperAdmin: role === "SUPER_ADMIN",
  };
}

export function requireScope(scope: ScopeContext, res: Response): boolean {
  if (scope.isSuperAdmin) return true;

  if (!scope.companyId) {
    res.status(403).json({ message: "No company assigned to your account" });
    return false;
  }

  if (scope.role === "DISPATCH" && scope.allowedCityIds.length === 0) {
    res.status(403).json({
      message: "DISPATCHER_NO_PERMISSIONS",
      error: "No cities assigned. Ask your Company Admin to grant access.",
    });
    return false;
  }

  if (scope.role === "DISPATCH" && scope.cityId && !scope.allowedCityIds.includes(scope.cityId)) {
    res.status(403).json({ message: "Access denied to this city" });
    return false;
  }

  const needsCity = ["ADMIN", "DISPATCH", "COMPANY_ADMIN"].includes(scope.role);
  if (needsCity && !scope.cityId) {
    res.status(400).json({ message: "CITY_REQUIRED", error: "You must select a working city before accessing data." });
    return false;
  }

  if (scope.cityId && scope.allowedCityIds.length > 0 && !scope.allowedCityIds.includes(scope.cityId)) {
    res.status(403).json({ message: "Access denied to this city" });
    return false;
  }

  return true;
}

export interface ScopeFilters {
  companyId: number | null;
  cityId: number | null;
  clinicId: number | null;
  allowedCityIds: number[];
}

export function buildScopeFilters(scope: ScopeContext): ScopeFilters {
  let clinicId: number | null = null;
  if (["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER", "VIEWER"].includes(scope.role) && scope.clinicId) {
    clinicId = scope.clinicId;
  }

  return {
    companyId: scope.isSuperAdmin ? scope.companyId : scope.companyId,
    cityId: scope.cityId,
    clinicId,
    allowedCityIds: scope.allowedCityIds,
  };
}

export function forceCompanyOnCreate(scope: ScopeContext, body: any): void {
  if (!scope.isSuperAdmin) {
    body.companyId = scope.companyId;
  } else if (!body.companyId) {
    if (scope.companyId) body.companyId = scope.companyId;
  }
}
