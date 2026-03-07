import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { db } from "../db";
import { companySettings, drivers, trips } from "@shared/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { incr } from "./redis";
import { cache } from "./cache";

interface QuotaLimits {
  maxDrivers: number;
  maxActiveTrips: number;
  rpmLimit: number;
  pdfRpmLimit: number;
  mapsRpmLimit: number;
}

const DEFAULT_LIMITS: QuotaLimits = {
  maxDrivers: 100,
  maxActiveTrips: 500,
  rpmLimit: 300,
  pdfRpmLimit: 30,
  mapsRpmLimit: 60,
};

async function getCompanyLimits(companyId: number): Promise<QuotaLimits> {
  const cacheKey = `company_limits:${companyId}`;
  const cached = cache.get<QuotaLimits>(cacheKey);
  if (cached) return cached;

  const rows = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  const limits = rows.length > 0
    ? {
        maxDrivers: rows[0].maxDrivers,
        maxActiveTrips: rows[0].maxActiveTrips,
        rpmLimit: rows[0].rpmLimit,
        pdfRpmLimit: rows[0].pdfRpmLimit,
        mapsRpmLimit: rows[0].mapsRpmLimit,
      }
    : DEFAULT_LIMITS;

  cache.set(cacheKey, limits, 60000);
  return limits;
}

export function companyRpmLimiter(limitType: "api" | "pdf" | "maps" = "api") {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return next();
    if (req.user.role === "SUPER_ADMIN") return next();

    const companyId = req.user.companyId;
    if (!companyId) return next();

    const limits = await getCompanyLimits(companyId);
    let maxRpm: number;
    switch (limitType) {
      case "pdf":
        maxRpm = limits.pdfRpmLimit;
        break;
      case "maps":
        maxRpm = limits.mapsRpmLimit;
        break;
      default:
        maxRpm = limits.rpmLimit;
    }

    const redisKey = `company:${companyId}:rpm:${limitType}`;
    const current = await incr(redisKey, 60);

    if (current > maxRpm) {
      return res.status(429).json({
        message: "Rate limit exceeded",
        code: "RATE_LIMIT_EXCEEDED",
        limit: maxRpm,
        limitType,
        retryAfterSeconds: 60,
      });
    }

    next();
  };
}

export async function checkDriverQuota(companyId: number): Promise<{ allowed: boolean; current: number; max: number }> {
  const limits = await getCompanyLimits(companyId);
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(drivers)
    .where(
      and(
        eq(drivers.companyId, companyId),
        eq(drivers.active, true),
        sql`${drivers.deletedAt} IS NULL`
      )
    );
  const current = result[0]?.count || 0;
  return { allowed: current < limits.maxDrivers, current, max: limits.maxDrivers };
}

export async function checkActiveTripQuota(companyId: number): Promise<{ allowed: boolean; current: number; max: number }> {
  const limits = await getCompanyLimits(companyId);
  const activeStatuses = ["SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trips)
    .where(
      and(
        eq(trips.companyId, companyId),
        inArray(trips.status, activeStatuses as any),
        sql`${trips.deletedAt} IS NULL`
      )
    );
  const current = result[0]?.count || 0;
  return { allowed: current < limits.maxActiveTrips, current, max: limits.maxActiveTrips };
}
