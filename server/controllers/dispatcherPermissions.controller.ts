import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { db } from "../db";
import { dispatcherCityPermissions, users, companyCities, cities } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";

export async function getDispatcherPermissionsHandler(req: AuthRequest, res: Response) {
  try {
    const dispatcherUserId = parseInt(String(req.params.dispatcherUserId));
    if (isNaN(dispatcherUserId)) return res.status(400).json({ message: "Invalid dispatcher user ID" });

    const dispatcher = await db.select().from(users).where(eq(users.id, dispatcherUserId)).then(r => r[0]);
    if (!dispatcher) return res.status(404).json({ message: "Dispatcher not found" });
    if (dispatcher.role !== "DISPATCH") return res.status(400).json({ message: "User is not a dispatcher" });

    const callerCompanyId = req.user!.companyId;
    if (req.user!.role !== "SUPER_ADMIN") {
      if (!callerCompanyId || dispatcher.companyId !== callerCompanyId) {
        return res.status(403).json({ message: "Dispatcher does not belong to your company" });
      }
    }

    const effectiveCompanyId = dispatcher.companyId;
    if (!effectiveCompanyId) return res.status(400).json({ message: "Dispatcher has no company assigned" });

    const perms = await db
      .select({ cityId: dispatcherCityPermissions.cityId })
      .from(dispatcherCityPermissions)
      .where(
        and(
          eq(dispatcherCityPermissions.userId, dispatcherUserId),
          eq(dispatcherCityPermissions.companyId, effectiveCompanyId),
        ),
      );

    res.json({ allowedCityIds: perms.map(p => p.cityId), companyId: effectiveCompanyId });
  } catch (err: any) {
    console.error("[DISPATCHER_PERMS] GET error:", err.message);
    res.status(500).json({ message: "Failed to get permissions" });
  }
}

const updatePermsSchema = z.object({
  allowedCityIds: z.array(z.number()),
});

export async function updateDispatcherPermissionsHandler(req: AuthRequest, res: Response) {
  try {
    const dispatcherUserId = parseInt(String(req.params.dispatcherUserId));
    if (isNaN(dispatcherUserId)) return res.status(400).json({ message: "Invalid dispatcher user ID" });

    const parsed = updatePermsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid body: allowedCityIds must be an array of numbers" });

    const { allowedCityIds } = parsed.data;

    const dispatcher = await db.select().from(users).where(eq(users.id, dispatcherUserId)).then(r => r[0]);
    if (!dispatcher) return res.status(404).json({ message: "Dispatcher not found" });
    if (dispatcher.role !== "DISPATCH") return res.status(400).json({ message: "User is not a dispatcher" });

    const callerCompanyId = req.user!.companyId;
    if (req.user!.role !== "SUPER_ADMIN") {
      if (!callerCompanyId || dispatcher.companyId !== callerCompanyId) {
        return res.status(403).json({ message: "Dispatcher does not belong to your company" });
      }
    }

    const effectiveCompanyId = dispatcher.companyId;
    if (!effectiveCompanyId) return res.status(400).json({ message: "Dispatcher has no company assigned" });

    if (allowedCityIds.length > 0) {
      const validCities = await db
        .select({ cityId: companyCities.cityId })
        .from(companyCities)
        .where(
          and(
            eq(companyCities.companyId, effectiveCompanyId),
            eq(companyCities.isActive, true),
          ),
        );
      const validCitySet = new Set(validCities.map(c => c.cityId));
      const invalidCities = allowedCityIds.filter(cid => !validCitySet.has(cid));
      if (invalidCities.length > 0) {
        return res.status(400).json({
          message: `Cities ${invalidCities.join(", ")} do not belong to this company`,
          invalidCityIds: invalidCities,
        });
      }
    }

    await db.delete(dispatcherCityPermissions).where(
      and(
        eq(dispatcherCityPermissions.userId, dispatcherUserId),
        eq(dispatcherCityPermissions.companyId, effectiveCompanyId),
      ),
    );

    if (allowedCityIds.length > 0) {
      await db.insert(dispatcherCityPermissions).values(
        allowedCityIds.map(cityId => ({
          userId: dispatcherUserId,
          companyId: effectiveCompanyId,
          cityId,
        })),
      );
    }

    console.log(`[DISPATCHER_PERMS] Updated permissions for user ${dispatcherUserId}: cities=[${allowedCityIds.join(",")}]`);

    res.json({ allowedCityIds });
  } catch (err: any) {
    console.error("[DISPATCHER_PERMS] PUT error:", err.message);
    res.status(500).json({ message: "Failed to update permissions" });
  }
}

export async function getMyPermissionsHandler(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const companyId = req.user!.companyId;

    if (!companyId) {
      return res.json({ allowedCityIds: [], cities: [] });
    }

    const perms = await db
      .select({ cityId: dispatcherCityPermissions.cityId })
      .from(dispatcherCityPermissions)
      .where(
        and(
          eq(dispatcherCityPermissions.userId, userId),
          eq(dispatcherCityPermissions.companyId, companyId),
        ),
      );

    const allowedCityIds = perms.map(p => p.cityId);

    let cityDetails: Array<{ id: number; name: string }> = [];
    if (allowedCityIds.length > 0) {
      cityDetails = await db
        .select({ id: cities.id, name: cities.name })
        .from(cities)
        .where(inArray(cities.id, allowedCityIds));
    }

    res.json({ allowedCityIds, cities: cityDetails });
  } catch (err: any) {
    console.error("[DISPATCHER_PERMS] getMyPermissions error:", err.message);
    res.status(500).json({ message: "Failed to get permissions" });
  }
}

export async function getCompanyCitiesHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = req.user!.companyId;
    if (!companyId && req.user!.role !== "SUPER_ADMIN") {
      return res.status(400).json({ message: "No company assigned" });
    }

    const targetCompanyId = req.query.companyId
      ? parseInt(req.query.companyId as string)
      : companyId;

    if (!targetCompanyId) {
      return res.status(400).json({ message: "companyId is required" });
    }

    if (req.user!.role !== "SUPER_ADMIN" && targetCompanyId !== companyId) {
      return res.status(403).json({ message: "Cannot access other company's cities" });
    }

    const companyCityRows = await db
      .select({
        cityId: companyCities.cityId,
        cityName: cities.name,
      })
      .from(companyCities)
      .innerJoin(cities, eq(cities.id, companyCities.cityId))
      .where(
        and(
          eq(companyCities.companyId, targetCompanyId),
          eq(companyCities.isActive, true),
        ),
      );

    res.json(companyCityRows);
  } catch (err: any) {
    console.error("[DISPATCHER_PERMS] getCompanyCities error:", err.message);
    res.status(500).json({ message: "Failed to get company cities" });
  }
}
