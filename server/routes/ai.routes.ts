import express, { type Express, type Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import {
  predictDemand,
  getDemandHeatmap,
  getOptimalDriverPositioning,
  computeSeasonalPattern,
  predictCityDemand,
  predictDriverNeed,
  getDailyForecasts,
} from "../lib/demandPredictionEngine";
import { optimizeMultiStopRoute, batchOptimizeRoutes } from "../lib/multiStopOptimizer";
import { scanForFraud, getFraudScore } from "../lib/fraudDetectionEngine";
import { db } from "../db";
import { fraudAlerts } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

const router = express.Router();

// ─── Demand Prediction ───────────────────────────────────────────────────────

router.get(
  "/api/ai/demand-prediction",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.user?.companyId;
      const cityId = parseInt(req.query.cityId as string);
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const hour = req.query.hour ? parseInt(req.query.hour as string) : undefined;

      if (!companyId || !cityId) {
        return res.status(400).json({ error: "companyId and cityId are required" });
      }

      const predictions = await predictDemand(companyId, cityId, date, hour);
      res.json({ date, hour: hour ?? "all", zones: predictions });
    } catch (err: any) {
      console.error("[AI-ROUTES] demand-prediction error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Demand Heatmap ──────────────────────────────────────────────────────────

router.get(
  "/api/ai/demand-heatmap",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.user?.companyId;
      const cityId = parseInt(req.query.cityId as string);
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);

      if (!companyId || !cityId) {
        return res.status(400).json({ error: "companyId and cityId are required" });
      }

      const heatmap = await getDemandHeatmap(companyId, cityId, date);
      res.json({ date, points: heatmap });
    } catch (err: any) {
      console.error("[AI-ROUTES] demand-heatmap error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Driver Positioning ──────────────────────────────────────────────────────

router.get(
  "/api/ai/driver-positioning",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.user?.companyId;
      const cityId = parseInt(req.query.cityId as string);
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const hour = parseInt(req.query.hour as string) || new Date().getHours();

      if (!companyId || !cityId) {
        return res.status(400).json({ error: "companyId and cityId are required" });
      }

      const positions = await getOptimalDriverPositioning(companyId, cityId, date, hour);
      res.json({ date, hour, positions });
    } catch (err: any) {
      console.error("[AI-ROUTES] driver-positioning error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Seasonal Pattern Analysis ───────────────────────────────────────────────

router.get(
  "/api/ai/seasonal-pattern",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const cityId = parseInt(req.query.cityId as string);
      const lookbackDays = req.query.lookbackDays ? parseInt(req.query.lookbackDays as string) : 90;

      if (!cityId) {
        return res.status(400).json({ error: "cityId is required" });
      }

      const pattern = await computeSeasonalPattern(cityId, lookbackDays);
      res.json({
        cityId,
        lookbackDays,
        pattern: {
          dayOfWeek: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name, i) => ({
            day: name,
            factor: pattern.dayOfWeekFactors[i],
          })),
          hourOfDay: pattern.hourOfDayFactors.map((factor, hour) => ({ hour, factor })),
          weekOfMonth: pattern.weekOfMonthFactors.map((factor, week) => ({ week: week + 1, factor })),
          specialDates: pattern.specialDates,
          baseDailyAverage: pattern.baseDailyAvg,
          totalDataPoints: pattern.dataPoints,
        },
      });
    } catch (err: any) {
      console.error("[AI-ROUTES] seasonal-pattern error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── City-Level Demand Forecast ─────────────────────────────────────────────

router.get(
  "/api/ai/demand-forecast",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const cityId = parseInt(req.query.cityId as string);
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const hour = req.query.hour ? parseInt(req.query.hour as string) : undefined;

      if (!cityId) {
        return res.status(400).json({ error: "cityId is required" });
      }

      const prediction = await predictCityDemand(cityId, date, hour);
      res.json({ date, hour: hour ?? "all", cityId, ...prediction });
    } catch (err: any) {
      console.error("[AI-ROUTES] demand-forecast error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Driver Need Prediction ─────────────────────────────────────────────────

router.get(
  "/api/ai/driver-need",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const cityId = parseInt(req.query.cityId as string);
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);

      if (!cityId) {
        return res.status(400).json({ error: "cityId is required" });
      }

      const forecast = await predictDriverNeed(cityId, date);
      res.json(forecast);
    } catch (err: any) {
      console.error("[AI-ROUTES] driver-need error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Multi-Day Forecast (dispatch planning view) ────────────────────────────

router.get(
  "/api/ai/demand-forecast/range",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const cityId = parseInt(req.query.cityId as string);
      const startDate = (req.query.startDate as string) || new Date().toISOString().slice(0, 10);
      const days = Math.min(parseInt(req.query.days as string) || 7, 14);

      if (!cityId) {
        return res.status(400).json({ error: "cityId is required" });
      }

      const endDateObj = new Date(startDate + "T12:00:00Z");
      endDateObj.setDate(endDateObj.getDate() + days - 1);
      const endDate = endDateObj.toISOString().slice(0, 10);

      const forecasts = await getDailyForecasts(cityId, startDate, endDate);
      res.json({ cityId, startDate, endDate, days, forecasts });
    } catch (err: any) {
      console.error("[AI-ROUTES] demand-forecast-range error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Fraud Alerts ────────────────────────────────────────────────────────────

router.get(
  "/api/ai/fraud-alerts",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.user?.companyId;
      const status = req.query.status as string | undefined;
      const severity = req.query.severity as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }

      const conditions: any[] = [eq(fraudAlerts.companyId, companyId)];
      if (status) {
        conditions.push(eq(fraudAlerts.status, status as any));
      }
      if (severity) {
        conditions.push(eq(fraudAlerts.severity, severity as any));
      }

      const alerts = await db
        .select()
        .from(fraudAlerts)
        .where(and(...conditions))
        .orderBy(desc(fraudAlerts.createdAt))
        .limit(limit);

      // Summary counts
      const summary = await db
        .select({
          status: fraudAlerts.status,
          severity: fraudAlerts.severity,
          count: sql<number>`count(*)::int`,
        })
        .from(fraudAlerts)
        .where(eq(fraudAlerts.companyId, companyId))
        .groupBy(fraudAlerts.status, fraudAlerts.severity);

      res.json({ alerts, summary });
    } catch (err: any) {
      console.error("[AI-ROUTES] fraud-alerts error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Fraud Score ─────────────────────────────────────────────────────────────

router.get(
  "/api/ai/fraud-score/:tripId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const tripId = parseInt(req.params.tripId as string);
      if (!tripId) {
        return res.status(400).json({ error: "Valid tripId is required" });
      }

      const score = await getFraudScore(tripId);
      res.json(score);
    } catch (err: any) {
      console.error("[AI-ROUTES] fraud-score error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Fraud Alert Status Update ───────────────────────────────────────────────

router.patch(
  "/api/ai/fraud-alerts/:id",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const alertId = parseInt(req.params.id as string);
      const { status, resolvedNotes } = req.body;

      if (!alertId || !status) {
        return res.status(400).json({ error: "alertId and status are required" });
      }

      const updateData: any = { status };
      if (status === "RESOLVED" || status === "DISMISSED") {
        updateData.resolvedBy = req.user?.userId;
        updateData.resolvedAt = new Date();
        updateData.resolvedNotes = resolvedNotes || null;
      }

      const [updated] = await db
        .update(fraudAlerts)
        .set(updateData)
        .where(eq(fraudAlerts.id, alertId))
        .returning();

      if (!updated) {
        return res.status(404).json({ error: "Alert not found" });
      }

      res.json(updated);
    } catch (err: any) {
      console.error("[AI-ROUTES] fraud-alert update error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Run Fraud Scan (on-demand) ──────────────────────────────────────────────

router.post(
  "/api/ai/fraud-scan",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.body.companyId || req.user?.companyId;
      const from = req.body.from || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d.toISOString().slice(0, 10);
      })();
      const to = req.body.to || new Date().toISOString().slice(0, 10);

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }

      const alerts = await scanForFraud(companyId, { from, to });

      // Persist new alerts
      const { persistFraudAlerts } = await import("../lib/fraudDetectionEngine");
      const inserted = await persistFraudAlerts(alerts);

      res.json({ totalFound: alerts.length, newInserted: inserted, alerts });
    } catch (err: any) {
      console.error("[AI-ROUTES] fraud-scan error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Multi-Stop Route Optimization ──────────────────────────────────────────

router.post(
  "/api/ai/optimize-route",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { stops, driverId, trips: tripList } = req.body;

      if (tripList && driverId) {
        // Batch optimization for driver
        const result = batchOptimizeRoutes(driverId, tripList);
        return res.json(result);
      }

      if (!stops || !Array.isArray(stops) || stops.length === 0) {
        return res.status(400).json({ error: "stops array is required" });
      }

      const result = optimizeMultiStopRoute(stops);
      res.json(result);
    } catch (err: any) {
      console.error("[AI-ROUTES] optimize-route error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

export function registerAiRoutes(app: Express) {
  app.use(router);
}
