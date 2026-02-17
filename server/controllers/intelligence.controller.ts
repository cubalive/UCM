import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { getActorContext } from "../auth";
import { db } from "../db";
import {
  dailyMetricsRollup,
  weeklyScoreSnapshots,
  triScores,
  costLeakAlerts,
  ucmCertifications,
  drivers,
  clinics,
} from "@shared/schema";
import { eq, and, gte, lte, desc, asc, sql, isNull, isNotNull, or, inArray } from "drizzle-orm";
import { computeIndexes, type IndexParams } from "../lib/indexEngine";
import { generateIndexesPdf } from "../lib/indexesPdfGenerator";

function cityFilter(actor: NonNullable<Awaited<ReturnType<typeof getActorContext>>>, cityIdParam?: string) {
  const parsedCityId = cityIdParam ? parseInt(String(cityIdParam)) : null;
  if (actor.role === "SUPER_ADMIN") {
    return parsedCityId ? parsedCityId : null;
  }
  if (parsedCityId && actor.allowedCityIds.includes(parsedCityId)) {
    return parsedCityId;
  }
  return actor.allowedCityIds.length === 1 ? actor.allowedCityIds[0] : null;
}

export async function getDailyRollupsHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor) return res.status(401).json({ message: "Unauthorized" });

    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    const cityId = cityFilter(actor, req.query.city_id as string);
    const groupBy = String(req.query.group_by || "day");

    if (!from || !to) {
      return res.status(400).json({ message: "from and to query params required (YYYY-MM-DD)" });
    }

    const conditions: any[] = [
      gte(dailyMetricsRollup.metricDate, from),
      lte(dailyMetricsRollup.metricDate, to),
    ];
    if (cityId) conditions.push(eq(dailyMetricsRollup.cityId, cityId));
    if (actor.clinicId) conditions.push(eq(dailyMetricsRollup.clinicId, actor.clinicId));
    if (actor.driverId) conditions.push(eq(dailyMetricsRollup.driverId, actor.driverId));
    if (actor.allowedCityIds.length > 0 && !cityId) {
      conditions.push(inArray(dailyMetricsRollup.cityId, actor.allowedCityIds));
    }

    if (groupBy === "day") {
      const rows = await db
        .select()
        .from(dailyMetricsRollup)
        .where(and(...conditions))
        .orderBy(asc(dailyMetricsRollup.metricDate))
        .limit(90);
      return res.json({ rollups: rows });
    }

    const rows = await db
      .select({
        metricDate: sql<string>`MIN(${dailyMetricsRollup.metricDate})`,
        cityId: dailyMetricsRollup.cityId,
        tripsTotal: sql<number>`SUM(${dailyMetricsRollup.tripsTotal})::int`,
        tripsCompleted: sql<number>`SUM(${dailyMetricsRollup.tripsCompleted})::int`,
        tripsCancelled: sql<number>`SUM(${dailyMetricsRollup.tripsCancelled})::int`,
        tripsNoShow: sql<number>`SUM(${dailyMetricsRollup.tripsNoShow})::int`,
        onTimePickupCount: sql<number>`SUM(${dailyMetricsRollup.onTimePickupCount})::int`,
        latePickupCount: sql<number>`SUM(${dailyMetricsRollup.latePickupCount})::int`,
        gpsVerifiedCount: sql<number>`SUM(${dailyMetricsRollup.gpsVerifiedCount})::int`,
        revenueCents: sql<number>`SUM(${dailyMetricsRollup.revenueCents})::int`,
        estCostCents: sql<number>`SUM(${dailyMetricsRollup.estCostCents})::int`,
        marginCents: sql<number>`SUM(${dailyMetricsRollup.marginCents})::int`,
      })
      .from(dailyMetricsRollup)
      .where(and(...conditions))
      .groupBy(dailyMetricsRollup.cityId)
      .limit(50);
    return res.json({ rollups: rows });
  } catch (err: any) {
    console.error("getDailyRollups error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getWeeklySnapshotsHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor) return res.status(401).json({ message: "Unauthorized" });

    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    const cityId = cityFilter(actor, req.query.city_id as string);
    const entityType = String(req.query.entity_type || "driver");

    if (!from || !to) {
      return res.status(400).json({ message: "from and to query params required (YYYY-MM-DD)" });
    }

    const conditions: any[] = [
      gte(weeklyScoreSnapshots.weekStart, from),
      lte(weeklyScoreSnapshots.weekStart, to),
    ];
    if (cityId) conditions.push(eq(weeklyScoreSnapshots.cityId, cityId));
    if (actor.allowedCityIds.length > 0 && !cityId) {
      conditions.push(inArray(weeklyScoreSnapshots.cityId, actor.allowedCityIds));
    }

    if (entityType === "driver") {
      conditions.push(isNotNull(weeklyScoreSnapshots.driverId));
      if (actor.driverId) conditions.push(eq(weeklyScoreSnapshots.driverId, actor.driverId));
    } else if (entityType === "clinic") {
      conditions.push(isNotNull(weeklyScoreSnapshots.clinicId));
      conditions.push(isNull(weeklyScoreSnapshots.driverId));
      if (actor.clinicId) conditions.push(eq(weeklyScoreSnapshots.clinicId, actor.clinicId));
    }

    const rows = await db
      .select()
      .from(weeklyScoreSnapshots)
      .where(and(...conditions))
      .orderBy(desc(weeklyScoreSnapshots.weekStart))
      .limit(200);

    return res.json({ snapshots: rows });
  } catch (err: any) {
    console.error("getWeeklySnapshots error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getRankingsHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor) return res.status(401).json({ message: "Unauthorized" });

    const entityType = String(req.params.entityType || "drivers");
    const weekStart = String(req.query.week_start || "");
    const cityId = cityFilter(actor, req.query.city_id as string);
    const sortBy = String(req.query.sort_by || "dpiScore");
    const limit = Math.min(parseInt(String(req.query.limit || "25")), 100);

    if (!weekStart) {
      return res.status(400).json({ message: "week_start query param required" });
    }

    const conditions: any[] = [eq(weeklyScoreSnapshots.weekStart, weekStart)];
    if (cityId) conditions.push(eq(weeklyScoreSnapshots.cityId, cityId));
    if (actor.allowedCityIds.length > 0 && !cityId) {
      conditions.push(inArray(weeklyScoreSnapshots.cityId, actor.allowedCityIds));
    }

    if (entityType === "drivers") {
      conditions.push(isNotNull(weeklyScoreSnapshots.driverId));
    } else {
      conditions.push(isNotNull(weeklyScoreSnapshots.clinicId));
      conditions.push(isNull(weeklyScoreSnapshots.driverId));
    }

    const sortCol =
      sortBy === "criScore" ? weeklyScoreSnapshots.criScore :
      sortBy === "triScore" ? weeklyScoreSnapshots.triScore :
      sortBy === "costBleedScore" ? weeklyScoreSnapshots.costBleedScore :
      weeklyScoreSnapshots.dpiScore;

    const rows = await db
      .select()
      .from(weeklyScoreSnapshots)
      .where(and(...conditions))
      .orderBy(desc(sortCol))
      .limit(limit);

    const enriched = await Promise.all(
      rows.map(async (row) => {
        let entityName = "";
        if (row.driverId) {
          const d = await db.select({ firstName: drivers.firstName, lastName: drivers.lastName })
            .from(drivers).where(eq(drivers.id, row.driverId)).then(r => r[0]);
          entityName = d ? `${d.firstName} ${d.lastName}` : `Driver #${row.driverId}`;
        } else if (row.clinicId) {
          const c = await db.select({ name: clinics.name })
            .from(clinics).where(eq(clinics.id, row.clinicId)).then(r => r[0]);
          entityName = c?.name || `Clinic #${row.clinicId}`;
        }
        return { ...row, entityName };
      })
    );

    return res.json({ rankings: enriched, weekStart, entityType });
  } catch (err: any) {
    console.error("getRankings error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getMyPerformanceHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor) return res.status(401).json({ message: "Unauthorized" });

    const entityType = String(req.params.entityType || "driver");
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");

    const conditions: any[] = [];
    if (from) conditions.push(gte(weeklyScoreSnapshots.weekStart, from));
    if (to) conditions.push(lte(weeklyScoreSnapshots.weekStart, to));

    if (entityType === "driver" && actor.driverId) {
      conditions.push(eq(weeklyScoreSnapshots.driverId, actor.driverId));
    } else if (entityType === "clinic" && actor.clinicId) {
      conditions.push(eq(weeklyScoreSnapshots.clinicId, actor.clinicId));
      conditions.push(isNull(weeklyScoreSnapshots.driverId));
    } else {
      return res.status(403).json({ message: "No associated entity for your account" });
    }

    const snapshots = await db
      .select()
      .from(weeklyScoreSnapshots)
      .where(and(...conditions))
      .orderBy(desc(weeklyScoreSnapshots.weekStart))
      .limit(12);

    return res.json({ snapshots, entityType });
  } catch (err: any) {
    console.error("getMyPerformance error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getCostLeakAlertsHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor) return res.status(401).json({ message: "Unauthorized" });

    const status = String(req.query.status || "OPEN");
    const cityId = cityFilter(actor, req.query.city_id as string);
    const limit = Math.min(parseInt(String(req.query.limit || "50")), 200);

    const conditions: any[] = [];
    if (status !== "ALL") conditions.push(eq(costLeakAlerts.status, status as any));
    if (cityId) conditions.push(eq(costLeakAlerts.cityId, cityId));
    if (actor.allowedCityIds.length > 0 && !cityId) {
      conditions.push(inArray(costLeakAlerts.cityId, actor.allowedCityIds));
    }

    const rows = await db
      .select()
      .from(costLeakAlerts)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(costLeakAlerts.createdAt))
      .limit(limit);

    return res.json({ alerts: rows });
  } catch (err: any) {
    console.error("getCostLeakAlerts error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function acknowledgeCostLeakAlertHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor) return res.status(401).json({ message: "Unauthorized" });

    const alertId = parseInt(String(req.params.id));
    if (!alertId || isNaN(alertId)) return res.status(400).json({ message: "Invalid alert ID" });

    const [updated] = await db
      .update(costLeakAlerts)
      .set({
        status: "ACKNOWLEDGED",
        acknowledgedBy: actor.userId,
        acknowledgedAt: new Date(),
      })
      .where(and(eq(costLeakAlerts.id, alertId), eq(costLeakAlerts.status, "OPEN")))
      .returning();

    if (!updated) return res.status(404).json({ message: "Alert not found or already acknowledged" });
    return res.json({ alert: updated });
  } catch (err: any) {
    console.error("acknowledgeCostLeakAlert error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function resolveCostLeakAlertHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor) return res.status(401).json({ message: "Unauthorized" });

    const alertId = parseInt(String(req.params.id));
    if (!alertId || isNaN(alertId)) return res.status(400).json({ message: "Invalid alert ID" });

    const [updated] = await db
      .update(costLeakAlerts)
      .set({
        status: "RESOLVED",
        resolvedBy: actor.userId,
        resolvedAt: new Date(),
      })
      .where(and(eq(costLeakAlerts.id, alertId), or(eq(costLeakAlerts.status, "OPEN"), eq(costLeakAlerts.status, "ACKNOWLEDGED"))))
      .returning();

    if (!updated) return res.status(404).json({ message: "Alert not found or already resolved" });
    return res.json({ alert: updated });
  } catch (err: any) {
    console.error("resolveCostLeakAlert error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getCertificationsHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor) return res.status(401).json({ message: "Unauthorized" });

    const cityId = cityFilter(actor, req.query.city_id as string);

    const conditions: any[] = [];
    if (cityId) conditions.push(eq(ucmCertifications.cityId, cityId));
    if (actor.clinicId) conditions.push(eq(ucmCertifications.clinicId, actor.clinicId));
    if (actor.allowedCityIds.length > 0 && !cityId) {
      conditions.push(inArray(ucmCertifications.cityId, actor.allowedCityIds));
    }

    const rows = await db
      .select()
      .from(ucmCertifications)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(ucmCertifications.certifiedAt))
      .limit(100);

    const enriched = await Promise.all(
      rows.map(async (row) => {
        const c = await db.select({ name: clinics.name })
          .from(clinics).where(eq(clinics.id, row.clinicId)).then(r => r[0]);
        return { ...row, clinicName: c?.name || `Clinic #${row.clinicId}` };
      })
    );

    return res.json({ certifications: enriched });
  } catch (err: any) {
    console.error("getCertifications error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getTriScoresHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor) return res.status(401).json({ message: "Unauthorized" });

    const cityId = cityFilter(actor, req.query.city_id as string);
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");

    const conditions: any[] = [];
    if (from) conditions.push(gte(triScores.periodStart, from));
    if (to) conditions.push(lte(triScores.periodEnd, to));
    if (cityId) conditions.push(eq(triScores.cityId, cityId));
    if (actor.clinicId) conditions.push(eq(triScores.clinicId, actor.clinicId));
    if (actor.allowedCityIds.length > 0 && !cityId) {
      conditions.push(inArray(triScores.cityId, actor.allowedCityIds));
    }

    const rows = await db
      .select()
      .from(triScores)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(triScores.periodStart))
      .limit(50);

    return res.json({ triScores: rows });
  } catch (err: any) {
    console.error("getTriScores error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getIndexesSummaryHandler(req: AuthRequest, res: Response) {
  try {
    const { dateFrom, dateTo, scope, state, city } = req.query as Record<string, string>;

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ message: "dateFrom and dateTo query params required (YYYY-MM-DD)" });
    }

    const validScopes = ["general", "state", "city"];
    const resolvedScope = validScopes.includes(scope) ? scope : "general";

    if (resolvedScope === "state" && !state) {
      return res.status(400).json({ message: "state param required for state scope" });
    }
    if (resolvedScope === "city" && !city) {
      return res.status(400).json({ message: "city param required for city scope" });
    }

    const params: IndexParams = {
      dateFrom,
      dateTo,
      scope: resolvedScope as IndexParams["scope"],
      state: state || undefined,
      city: city || undefined,
    };

    const result = await computeIndexes(params);
    return res.json(result);
  } catch (err: any) {
    console.error("getIndexesSummary error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getIndexesPdfHandler(req: AuthRequest, res: Response) {
  try {
    const { dateFrom, dateTo, scope, state, city } = req.query as Record<string, string>;

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ message: "dateFrom and dateTo required" });
    }

    const validScopes = ["general", "state", "city"];
    const resolvedScope = validScopes.includes(scope) ? scope : "general";

    const params: IndexParams = {
      dateFrom,
      dateTo,
      scope: resolvedScope as IndexParams["scope"],
      state: state || undefined,
      city: city || undefined,
    };

    const result = await computeIndexes(params);
    const pdfBuffer = await generateIndexesPdf(result);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="UCM_Indexes_${resolvedScope}_${dateFrom}_${dateTo}.pdf"`);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error("getIndexesPdf error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}
