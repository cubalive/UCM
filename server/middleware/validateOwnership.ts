/**
 * Cross-Tenant Ownership Validation Middleware
 *
 * Ensures that entity IDs (clinicId, pharmacyId, brokerId) in URL params
 * belong to the authenticated user's company. Prevents tenant A from
 * querying tenant B's data by guessing IDs.
 */

import type { Request, Response, NextFunction } from "express";
import { db } from "../db";
import { clinics, drivers, patients } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { AuthRequest } from "../auth";
import { getCompanyIdFromAuth } from "../auth";

type EntityType = "clinic" | "driver" | "patient";

const entityTableMap: Record<EntityType, { table: any; idCol: any; companyCol: any }> = {
  clinic: { table: clinics, idCol: clinics.id, companyCol: clinics.companyId },
  driver: { table: drivers, idCol: drivers.id, companyCol: drivers.companyId },
  patient: { table: patients, idCol: patients.id, companyCol: patients.companyId },
};

/**
 * Validate that a URL param entity belongs to the user's company.
 * Usage: router.get("/api/clinics/:clinicId", authMiddleware, validateOwnership("clinic", "clinicId"), handler)
 */
export function validateOwnership(entityType: EntityType, paramName: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // SUPER_ADMIN can access any entity
    if (authReq.user.role === "SUPER_ADMIN") {
      return next();
    }

    const entityId = parseInt(String(req.params[paramName]), 10);
    if (isNaN(entityId) || entityId <= 0) {
      return res.status(400).json({ message: "Invalid entity ID" });
    }

    const companyId = getCompanyIdFromAuth(authReq);
    if (!companyId) {
      // User has no company context — deny access to specific entities
      return res.status(403).json({ message: "Access denied — no company context" });
    }

    const config = entityTableMap[entityType];
    if (!config) {
      return res.status(500).json({ message: "Invalid entity type" });
    }

    try {
      const [entity] = await db
        .select({ id: config.idCol })
        .from(config.table)
        .where(and(eq(config.idCol, entityId), eq(config.companyCol, companyId)))
        .limit(1);

      if (!entity) {
        console.warn(JSON.stringify({
          event: "cross_tenant_access_denied",
          severity: "HIGH",
          userId: authReq.user.userId,
          role: authReq.user.role,
          companyId,
          entityType,
          entityId,
          path: req.path,
          method: req.method,
          ts: new Date().toISOString(),
        }));
        return res.status(403).json({ message: "Access denied" });
      }

      next();
    } catch (err: any) {
      console.error(`[OWNERSHIP] Validation error for ${entityType}:${entityId}:`, err.message);
      return res.status(500).json({ message: "An unexpected error occurred" });
    }
  };
}

/**
 * Validate that the companyId in a request body matches the user's company.
 * Used for create operations where companyId is in the body.
 */
export function validateBodyCompanyId(bodyField: string = "companyId") {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (authReq.user.role === "SUPER_ADMIN") {
      return next();
    }

    const companyId = getCompanyIdFromAuth(authReq);
    const bodyCompanyId = req.body?.[bodyField];

    if (bodyCompanyId && companyId && Number(bodyCompanyId) !== companyId) {
      console.warn(JSON.stringify({
        event: "cross_tenant_write_denied",
        severity: "HIGH",
        userId: authReq.user.userId,
        role: authReq.user.role,
        userCompanyId: companyId,
        bodyCompanyId,
        path: req.path,
        ts: new Date().toISOString(),
      }));
      return res.status(403).json({ message: "Access denied — company mismatch" });
    }

    next();
  };
}
