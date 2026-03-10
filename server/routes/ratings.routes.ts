import express, { type Express, type Request, type Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { requireTenantScope, getTenantId } from "../middleware";
import { db } from "../db";
import { patientRatings, trips, patients, drivers } from "@shared/schema";
import { eq, and, gte, lte, desc, sql, count } from "drizzle-orm";
import {
  submitRating,
  submitRatingAuthenticated,
  getDriverRatingSummary,
  getCompanyRatingSummary,
  getCityRatingSummary,
} from "../lib/patientRatingEngine";

const router = express.Router();

// ─── PUBLIC: Submit rating via token (no auth) ──────────────────────────────

router.post("/api/ratings/submit/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    if (!token || token.length < 10) {
      return res.status(400).json({ message: "Invalid token" });
    }

    const {
      overallRating,
      punctualityRating,
      driverRating,
      vehicleRating,
      safetyRating,
      comment,
      tags,
      anonymous,
    } = req.body;

    if (!overallRating || typeof overallRating !== "number") {
      return res.status(400).json({ message: "overallRating is required and must be a number (1-5)" });
    }

    const result = await submitRating(String(token), {
      overallRating,
      punctualityRating,
      driverRating,
      vehicleRating,
      safetyRating,
      comment,
      tags,
      anonymous,
    });

    return res.json(result);
  } catch (err: any) {
    console.error(`[RATING-ROUTE] POST /api/ratings/submit/:token error: ${err.message}`);
    const status = err.message.includes("expired") || err.message.includes("Invalid")
      ? 400
      : err.message.includes("already")
        ? 409
        : 500;
    return res.status(status).json({ message: err.message });
  }
});

// ─── AUTHENTICATED: Submit rating for a trip ────────────────────────────────

router.post(
  "/api/ratings/trip/:tripId",
  authMiddleware,
  requireRole("ADMIN", "DISPATCH", "VIEWER", "SUPER_ADMIN", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tripId = parseInt(String(req.params.tripId), 10);
      if (isNaN(tripId)) {
        return res.status(400).json({ message: "Invalid tripId" });
      }

      const {
        overallRating,
        punctualityRating,
        driverRating,
        vehicleRating,
        safetyRating,
        comment,
        tags,
        anonymous,
        patientId,
        source,
      } = req.body;

      if (!overallRating || typeof overallRating !== "number") {
        return res.status(400).json({ message: "overallRating is required and must be a number (1-5)" });
      }

      // Resolve patientId: from body or from the trip itself
      let resolvedPatientId = patientId;
      if (!resolvedPatientId) {
        const trip = await db.select({ patientId: trips.patientId }).from(trips).where(eq(trips.id, tripId)).limit(1);
        if (!trip.length) {
          return res.status(404).json({ message: "Trip not found" });
        }
        resolvedPatientId = trip[0].patientId;
      }

      const result = await submitRatingAuthenticated(
        tripId,
        resolvedPatientId,
        { overallRating, punctualityRating, driverRating, vehicleRating, safetyRating, comment, tags, anonymous },
        source || "portal",
      );

      return res.json(result);
    } catch (err: any) {
      console.error(`[RATING-ROUTE] POST /api/ratings/trip/:tripId error: ${err.message}`);
      const status = err.message.includes("not found") ? 404
        : err.message.includes("already") ? 409
          : err.message.includes("not completed") || err.message.includes("does not match") ? 400
            : 500;
      return res.status(status).json({ message: err.message });
    }
  },
);

// ─── LIST: Get ratings with filters ─────────────────────────────────────────

router.get(
  "/api/ratings",
  authMiddleware,
  requireRole("ADMIN", "DISPATCH", "VIEWER", "SUPER_ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { driverId, from, to, limit: limitStr, offset: offsetStr } = req.query;

      const conditions: any[] = [sql`${patientRatings.overallRating} > 0`];

      if (tenantId) {
        conditions.push(eq(patientRatings.companyId, tenantId));
      }

      if (driverId) {
        const dId = parseInt(String(driverId), 10);
        if (!isNaN(dId)) {
          conditions.push(eq(patientRatings.driverId, dId));
        }
      }

      if (from) {
        conditions.push(gte(patientRatings.createdAt, new Date(String(from))));
      }

      if (to) {
        conditions.push(lte(patientRatings.createdAt, new Date(String(to))));
      }

      const limit = Math.min(parseInt(String(limitStr) || "50", 10), 200);
      const offset = parseInt(String(offsetStr) || "0", 10);

      const rows = await db
        .select({
          id: patientRatings.id,
          tripId: patientRatings.tripId,
          patientId: patientRatings.patientId,
          driverId: patientRatings.driverId,
          companyId: patientRatings.companyId,
          cityId: patientRatings.cityId,
          overallRating: patientRatings.overallRating,
          punctualityRating: patientRatings.punctualityRating,
          driverRating: patientRatings.driverRating,
          vehicleRating: patientRatings.vehicleRating,
          safetyRating: patientRatings.safetyRating,
          comment: patientRatings.comment,
          tags: patientRatings.tags,
          anonymous: patientRatings.anonymous,
          source: patientRatings.source,
          createdAt: patientRatings.createdAt,
          driverFirstName: drivers.firstName,
          driverLastName: drivers.lastName,
          patientFirstName: patients.firstName,
          patientLastName: patients.lastName,
        })
        .from(patientRatings)
        .leftJoin(drivers, eq(patientRatings.driverId, drivers.id))
        .leftJoin(patients, eq(patientRatings.patientId, patients.id))
        .where(and(...conditions))
        .orderBy(desc(patientRatings.createdAt))
        .limit(limit)
        .offset(offset);

      // Mask patient info if anonymous
      const results = rows.map((r) => ({
        ...r,
        patientFirstName: r.anonymous ? null : r.patientFirstName,
        patientLastName: r.anonymous ? null : r.patientLastName,
        patientId: r.anonymous ? null : r.patientId,
      }));

      return res.json({ ratings: results, count: results.length, limit, offset });
    } catch (err: any) {
      console.error(`[RATING-ROUTE] GET /api/ratings error: ${err.message}`);
      return res.status(500).json({ message: "Failed to fetch ratings" });
    }
  },
);

// ─── Driver rating summary ──────────────────────────────────────────────────

router.get(
  "/api/ratings/driver/:driverId/summary",
  authMiddleware,
  requireRole("ADMIN", "DISPATCH", "VIEWER", "SUPER_ADMIN", "COMPANY_ADMIN", "DRIVER"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const driverId = parseInt(String(req.params.driverId), 10);
      if (isNaN(driverId)) {
        return res.status(400).json({ message: "Invalid driverId" });
      }

      const summary = await getDriverRatingSummary(driverId);
      return res.json(summary);
    } catch (err: any) {
      console.error(`[RATING-ROUTE] GET /api/ratings/driver/:driverId/summary error: ${err.message}`);
      return res.status(500).json({ message: "Failed to fetch driver rating summary" });
    }
  },
);

// ─── Company rating summary ─────────────────────────────────────────────────

router.get(
  "/api/ratings/company/summary",
  authMiddleware,
  requireRole("ADMIN", "SUPER_ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ message: "Company context required" });
      }

      const summary = await getCompanyRatingSummary(tenantId);
      return res.json(summary);
    } catch (err: any) {
      console.error(`[RATING-ROUTE] GET /api/ratings/company/summary error: ${err.message}`);
      return res.status(500).json({ message: "Failed to fetch company rating summary" });
    }
  },
);

// ─── City rating summary ────────────────────────────────────────────────────

router.get(
  "/api/ratings/city/:cityId/summary",
  authMiddleware,
  requireRole("ADMIN", "SUPER_ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const cityId = parseInt(String(req.params.cityId), 10);
      if (isNaN(cityId)) {
        return res.status(400).json({ message: "Invalid cityId" });
      }

      const summary = await getCityRatingSummary(cityId);
      return res.json(summary);
    } catch (err: any) {
      console.error(`[RATING-ROUTE] GET /api/ratings/city/:cityId/summary error: ${err.message}`);
      return res.status(500).json({ message: "Failed to fetch city rating summary" });
    }
  },
);

// ─── Rating trends over time ────────────────────────────────────────────────

router.get(
  "/api/ratings/trends",
  authMiddleware,
  requireRole("ADMIN", "SUPER_ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const { driverId, from, to, granularity } = req.query;

      const conditions: any[] = [sql`${patientRatings.overallRating} > 0`];

      if (tenantId) {
        conditions.push(eq(patientRatings.companyId, tenantId));
      }

      if (driverId) {
        const dId = parseInt(String(driverId), 10);
        if (!isNaN(dId)) {
          conditions.push(eq(patientRatings.driverId, dId));
        }
      }

      // Default: last 30 days
      const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const toDate = to ? new Date(String(to)) : new Date();

      conditions.push(gte(patientRatings.createdAt, fromDate));
      conditions.push(lte(patientRatings.createdAt, toDate));

      const grain = granularity === "week" ? "week" : granularity === "month" ? "month" : "day";

      const rows = await db
        .select({
          period: sql<string>`date_trunc(${grain}, ${patientRatings.createdAt})::date::text`,
          avgRating: sql<number>`round(avg(${patientRatings.overallRating})::numeric, 2)`,
          totalCount: count(),
        })
        .from(patientRatings)
        .where(and(...conditions))
        .groupBy(sql`date_trunc(${grain}, ${patientRatings.createdAt})`)
        .orderBy(sql`date_trunc(${grain}, ${patientRatings.createdAt})`);

      return res.json({
        trends: rows.map((r) => ({
          period: r.period,
          averageRating: Number(r.avgRating),
          count: Number(r.totalCount),
        })),
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        granularity: grain,
      });
    } catch (err: any) {
      console.error(`[RATING-ROUTE] GET /api/ratings/trends error: ${err.message}`);
      return res.status(500).json({ message: "Failed to fetch rating trends" });
    }
  },
);

export function registerRatingRoutes(app: Express) {
  app.use(router);
}
