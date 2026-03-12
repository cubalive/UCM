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

// ─── ETA Prediction (Learning Model) ─────────────────────────────────────────

router.get(
  "/api/ai/eta-prediction/:tripId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const tripId = parseInt(req.params.tripId as string);
      if (!tripId) {
        return res.status(400).json({ error: "Valid tripId is required" });
      }

      const { predictETA } = await import("../lib/etaLearningEngine");
      const prediction = await predictETA(tripId);
      res.json(prediction);
    } catch (err: any) {
      console.error("[AI-ROUTES] eta-prediction error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Anomaly Detection ───────────────────────────────────────────────────────

router.get(
  "/api/ai/anomaly-score/:tripId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const tripId = parseInt(req.params.tripId as string);
      if (!tripId) {
        return res.status(400).json({ error: "Valid tripId is required" });
      }

      const { detectTripAnomalies } = await import("../lib/anomalyDetectionEngine");
      const result = await detectTripAnomalies(tripId);
      res.json(result);
    } catch (err: any) {
      console.error("[AI-ROUTES] anomaly-score error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Smart Driver Matching ───────────────────────────────────────────────────

router.get(
  "/api/ai/driver-match/:tripId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const tripId = parseInt(req.params.tripId as string);
      const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);
      if (!tripId) {
        return res.status(400).json({ error: "Valid tripId is required" });
      }

      const { getTopDrivers } = await import("../lib/smartMatchingEngine");
      const result = await getTopDrivers(tripId, limit);
      res.json(result);
    } catch (err: any) {
      console.error("[AI-ROUTES] driver-match error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Enhanced Chatbot ────────────────────────────────────────────────────────

router.post(
  "/api/ai/chatbot/message",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { message, sessionId: providedSessionId } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }

      const { processDispatchMessage, getActiveSession, createChatSession } = await import("../lib/aiDispatchBot");
      const { storage } = await import("../storage");

      let sessionId = providedSessionId;
      if (!sessionId) {
        sessionId = await getActiveSession(userId);
      }
      if (!sessionId) {
        const user = await storage.getUser(userId);
        if (!user) return res.status(404).json({ error: "User not found" });
        sessionId = await createChatSession(
          user.companyId || 0,
          userId,
          (user as any).cityId || null,
          "web"
        );
      }

      const user = await storage.getUser(userId);
      const response = await processDispatchMessage(
        sessionId,
        message,
        user?.companyId || 0,
        userId,
        (user as any)?.cityId || null
      );

      res.json({ ok: true, sessionId, ...response });
    } catch (err: any) {
      console.error("[AI-ROUTES] chatbot error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Dispatch Suggestions ────────────────────────────────────────────────────

router.get(
  "/api/dispatch/suggestions",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.user?.companyId;
      const cityId = req.query.cityId ? parseInt(req.query.cityId as string) : undefined;

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }

      const { trips: tripsTable } = await import("@shared/schema");
      const unassignedTrips = await db
        .select({ id: tripsTable.id, patientId: tripsTable.patientId })
        .from(tripsTable)
        .where(
          and(
            eq(tripsTable.companyId, companyId),
            sql`${tripsTable.driverId} IS NULL`,
            eq(tripsTable.status, "SCHEDULED"),
            sql`${tripsTable.deletedAt} IS NULL`,
            ...(cityId ? [eq(tripsTable.cityId, cityId)] : [])
          )
        )
        .limit(20);

      const { getTopDrivers } = await import("../lib/smartMatchingEngine");
      const suggestions = [];

      for (const trip of unassignedTrips) {
        try {
          const match = await getTopDrivers(trip.id, 3);
          suggestions.push({
            tripId: trip.id,
            patientId: trip.patientId,
            topDrivers: match.topDrivers.map(d => ({
              driverId: d.driverId,
              driverName: d.driverName,
              score: d.score,
              reason: d.factors.filter(f => f.score > f.maxScore * 0.5).map(f => f.name).join(", ") || "Best available",
            })),
          });
        } catch {
          // Skip failed suggestions
        }
      }

      res.json({ suggestions, totalUnassigned: unassignedTrips.length });
    } catch (err: any) {
      console.error("[AI-ROUTES] dispatch-suggestions error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Dispatch Performance Analytics ──────────────────────────────────────────

router.get(
  "/api/dispatch/performance",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.user?.companyId;
      const days = Math.min(parseInt(req.query.days as string) || 30, 90);

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }

      const { trips: tripsTable } = await import("@shared/schema");
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      // Average assignment time (time from creation to assignment)
      const assignmentTimeStats = await db
        .select({
          avgSeconds: sql<number>`coalesce(avg(extract(epoch from (${tripsTable.assignedAt} - ${tripsTable.createdAt}))), 0)::float`,
          medianApprox: sql<number>`coalesce(percentile_cont(0.5) within group (order by extract(epoch from (${tripsTable.assignedAt} - ${tripsTable.createdAt}))), 0)::float`,
        })
        .from(tripsTable)
        .where(
          and(
            eq(tripsTable.companyId, companyId),
            sql`${tripsTable.assignedAt} IS NOT NULL`,
            sql`${tripsTable.scheduledDate} >= ${cutoffStr}`,
            sql`${tripsTable.deletedAt} IS NULL`
          )
        );

      // Reassignment rate
      const reassignStats = await db
        .select({
          totalAssigned: sql<number>`count(*) filter (where ${tripsTable.driverId} is not null)::int`,
          reassigned: sql<number>`count(*) filter (where ${tripsTable.assignmentSource} = 'chatbot_reassign' or ${tripsTable.assignmentSource} = 'manual_reassign' or ${tripsTable.assignmentReason} like '%reassign%')::int`,
        })
        .from(tripsTable)
        .where(
          and(
            eq(tripsTable.companyId, companyId),
            sql`${tripsTable.scheduledDate} >= ${cutoffStr}`,
            sql`${tripsTable.deletedAt} IS NULL`
          )
        );

      // On-time dispatch rate
      const onTimeStats = await db
        .select({
          total: sql<number>`count(*)::int`,
          onTime: sql<number>`count(*) filter (where ${tripsTable.startedAt} IS NOT NULL)::int`,
          completed: sql<number>`count(*) filter (where ${tripsTable.status} = 'COMPLETED')::int`,
          noShow: sql<number>`count(*) filter (where ${tripsTable.status} = 'NO_SHOW')::int`,
          cancelled: sql<number>`count(*) filter (where ${tripsTable.status} = 'CANCELLED')::int`,
        })
        .from(tripsTable)
        .where(
          and(
            eq(tripsTable.companyId, companyId),
            sql`${tripsTable.scheduledDate} >= ${cutoffStr}`,
            sql`${tripsTable.deletedAt} IS NULL`
          )
        );

      // Trips per day distribution
      const dailyStats = await db
        .select({
          date: tripsTable.scheduledDate,
          count: sql<number>`count(*)::int`,
        })
        .from(tripsTable)
        .where(
          and(
            eq(tripsTable.companyId, companyId),
            sql`${tripsTable.scheduledDate} >= ${cutoffStr}`,
            sql`${tripsTable.deletedAt} IS NULL`
          )
        )
        .groupBy(tripsTable.scheduledDate)
        .orderBy(tripsTable.scheduledDate);

      // Peak hour analysis
      const hourlyStats = await db
        .select({
          hour: sql<number>`extract(hour from ${tripsTable.pickupTime}::time)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(tripsTable)
        .where(
          and(
            eq(tripsTable.companyId, companyId),
            sql`${tripsTable.scheduledDate} >= ${cutoffStr}`,
            sql`${tripsTable.deletedAt} IS NULL`,
            sql`${tripsTable.pickupTime} IS NOT NULL`
          )
        )
        .groupBy(sql`extract(hour from ${tripsTable.pickupTime}::time)`)
        .orderBy(sql`extract(hour from ${tripsTable.pickupTime}::time)`);

      const stats = assignmentTimeStats[0] || { avgSeconds: 0, medianApprox: 0 };
      const reassign = reassignStats[0] || { totalAssigned: 0, reassigned: 0 };
      const onTime = onTimeStats[0] || { total: 0, onTime: 0, completed: 0, noShow: 0, cancelled: 0 };

      res.json({
        period: { days, from: cutoffStr, to: new Date().toISOString().slice(0, 10) },
        averageAssignmentTime: {
          averageSeconds: Math.round(stats.avgSeconds),
          averageMinutes: Math.round(stats.avgSeconds / 60 * 10) / 10,
          medianSeconds: Math.round(stats.medianApprox),
        },
        reassignmentRate: {
          totalAssigned: reassign.totalAssigned,
          reassigned: reassign.reassigned,
          rate: reassign.totalAssigned > 0 ? Math.round((reassign.reassigned / reassign.totalAssigned) * 10000) / 100 : 0,
        },
        tripOutcomes: {
          total: onTime.total,
          completed: onTime.completed,
          noShow: onTime.noShow,
          cancelled: onTime.cancelled,
          completionRate: onTime.total > 0 ? Math.round((onTime.completed / onTime.total) * 10000) / 100 : 0,
        },
        peakHours: hourlyStats.map(h => ({ hour: h.hour, trips: h.count })),
        dailyTrends: dailyStats.slice(-14), // last 14 days
      });
    } catch (err: any) {
      console.error("[AI-ROUTES] dispatch-performance error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── No-Show Prediction ─────────────────────────────────────────────────────

router.get(
  "/api/ai/predict/no-show/:tripId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const tripId = parseInt(req.params.tripId as string);
      if (!tripId) {
        return res.status(400).json({ error: "Valid tripId is required" });
      }

      const { predictNoShow } = await import("../lib/noShowPredictionEngine");
      const prediction = await predictNoShow(tripId);
      res.json(prediction);
    } catch (err: any) {
      console.error("[AI-ROUTES] no-show prediction error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  "/api/ai/predict/no-shows",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.user?.companyId;

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }

      const { batchPredictNoShows } = await import("../lib/noShowPredictionEngine");
      const predictions = await batchPredictNoShows(date, companyId);
      res.json({
        date,
        companyId,
        total: predictions.length,
        highRisk: predictions.filter(p => p.riskLevel === "critical" || p.riskLevel === "high").length,
        predictions,
      });
    } catch (err: any) {
      console.error("[AI-ROUTES] batch no-show prediction error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Lateness Prediction ────────────────────────────────────────────────────

// NOTE: /active must be registered before /:tripId to avoid Express matching "active" as a tripId param
router.get(
  "/api/ai/predict/lateness/active",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.user?.companyId;

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }

      const { batchPredictLateness } = await import("../lib/lateTripPredictionEngine");
      const predictions = await batchPredictLateness(companyId);
      res.json({
        companyId,
        total: predictions.length,
        critical: predictions.filter(p => p.riskLevel === "critical").length,
        likelyLate: predictions.filter(p => p.riskLevel === "likely_late").length,
        atRisk: predictions.filter(p => p.riskLevel === "at_risk").length,
        predictions,
      });
    } catch (err: any) {
      console.error("[AI-ROUTES] batch lateness prediction error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  "/api/ai/predict/lateness/:tripId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const tripId = parseInt(req.params.tripId as string);
      if (!tripId) {
        return res.status(400).json({ error: "Valid tripId is required" });
      }

      const { predictLateness } = await import("../lib/lateTripPredictionEngine");
      const prediction = await predictLateness(tripId);
      res.json(prediction);
    } catch (err: any) {
      console.error("[AI-ROUTES] lateness prediction error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Cancellation Prediction ────────────────────────────────────────────────

router.get(
  "/api/ai/predict/cancellation/:tripId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const tripId = parseInt(req.params.tripId as string);
      if (!tripId) {
        return res.status(400).json({ error: "Valid tripId is required" });
      }

      const { predictCancellation } = await import("../lib/cancellationPredictionEngine");
      const prediction = await predictCancellation(tripId);
      res.json(prediction);
    } catch (err: any) {
      console.error("[AI-ROUTES] cancellation prediction error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Driver Churn Prediction ────────────────────────────────────────────────

router.get(
  "/api/ai/predict/driver-churn/:driverId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const driverId = parseInt(req.params.driverId as string);
      if (!driverId) {
        return res.status(400).json({ error: "Valid driverId is required" });
      }

      const { predictDriverChurn } = await import("../lib/driverChurnEngine");
      const prediction = await predictDriverChurn(driverId);
      res.json(prediction);
    } catch (err: any) {
      console.error("[AI-ROUTES] driver churn prediction error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

router.get(
  "/api/ai/predict/driver-churn",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.user?.companyId;

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }

      const { batchPredictChurn } = await import("../lib/driverChurnEngine");
      const results = await batchPredictChurn(companyId);
      res.json({
        companyId,
        total: results.length,
        highRisk: results.filter(r => r.riskLevel === "high").length,
        mediumRisk: results.filter(r => r.riskLevel === "medium").length,
        drivers: results,
      });
    } catch (err: any) {
      console.error("[AI-ROUTES] batch driver churn prediction error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Patient Care Profile ───────────────────────────────────────────────────

router.get(
  "/api/ai/patient-profile/:patientId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const patientId = parseInt(req.params.patientId as string);
      if (!patientId) {
        return res.status(400).json({ error: "Valid patientId is required" });
      }

      const { buildPatientProfile } = await import("../lib/patientRiskEngine");
      const profile = await buildPatientProfile(patientId);
      res.json(profile);
    } catch (err: any) {
      console.error("[AI-ROUTES] patient profile error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Dispatch Hotspots ───────────────────────────────────────────────────────

router.get(
  "/api/dispatch/hotspots",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.user?.companyId;
      const cityId = parseInt(req.query.cityId as string);
      const date = req.query.date as string | undefined;

      if (!companyId || !cityId) {
        return res.status(400).json({ error: "companyId and cityId are required" });
      }

      const { analyzeHotspots } = await import("../lib/dispatchHotspotEngine");
      const result = await analyzeHotspots(cityId, companyId, date);
      res.json(result);
    } catch (err: any) {
      console.error("[AI-ROUTES] dispatch-hotspots error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Driver Fatigue Alerts ───────────────────────────────────────────────────

router.get(
  "/api/dispatch/fatigue-alerts",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.user?.companyId;
      const cityId = parseInt(req.query.cityId as string);

      if (!companyId || !cityId) {
        return res.status(400).json({ error: "companyId and cityId are required" });
      }

      const { getFatigueAlerts } = await import("../lib/driverFatigueEngine");
      const result = await getFatigueAlerts(companyId, cityId);
      res.json(result);
    } catch (err: any) {
      console.error("[AI-ROUTES] fatigue-alerts error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Single Driver Fatigue Check ─────────────────────────────────────────────

router.get(
  "/api/dispatch/fatigue/:driverId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const driverId = parseInt(req.params.driverId as string);
      if (!driverId) {
        return res.status(400).json({ error: "Valid driverId is required" });
      }

      const { getDriverFatigueStatus } = await import("../lib/driverFatigueEngine");
      const status = await getDriverFatigueStatus(driverId);
      res.json(status);
    } catch (err: any) {
      console.error("[AI-ROUTES] fatigue-driver error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Neural Dispatch v2: Confidence Scoring ──────────────────────────────────

router.get(
  "/api/dispatch/confidence/:tripId/:driverId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const tripId = parseInt(req.params.tripId as string);
      const driverId = parseInt(req.params.driverId as string);
      if (!tripId || !driverId) {
        return res.status(400).json({ error: "Valid tripId and driverId are required" });
      }

      const { scoreDispatchDecision } = await import("../lib/dispatchConfidenceEngine");
      const confidence = await scoreDispatchDecision(tripId, driverId);
      res.json(confidence);
    } catch (err: any) {
      console.error("[AI-ROUTES] dispatch-confidence error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Neural Dispatch v2: Explanation Engine ───────────────────────────────────

router.get(
  "/api/dispatch/explain/:tripId/:driverId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const tripId = parseInt(req.params.tripId as string);
      const driverId = parseInt(req.params.driverId as string);
      if (!tripId || !driverId) {
        return res.status(400).json({ error: "Valid tripId and driverId are required" });
      }

      const { scoreDispatchDecision } = await import("../lib/dispatchConfidenceEngine");
      const { explainDispatchDecision } = await import("../lib/dispatchExplanationEngine");

      const confidence = await scoreDispatchDecision(tripId, driverId);
      const explanation = await explainDispatchDecision(tripId, driverId, confidence);

      res.json({ tripId, driverId, confidence, explanation });
    } catch (err: any) {
      console.error("[AI-ROUTES] dispatch-explain error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Neural Dispatch v2: Override Recording ───────────────────────────────────

router.post(
  "/api/dispatch/override",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tripId, suggestedDriverId, overrideDriverId, reason } = req.body;

      if (!tripId || !suggestedDriverId || !overrideDriverId) {
        return res.status(400).json({ error: "tripId, suggestedDriverId, and overrideDriverId are required" });
      }
      if (!reason || typeof reason !== "string") {
        return res.status(400).json({ error: "reason is required" });
      }

      const { recordOverride } = await import("../lib/dispatchOverrideLearning");
      await recordOverride({
        tripId,
        suggestedDriverId,
        overrideDriverId,
        reason,
        timestamp: new Date(),
      });

      res.json({ ok: true, message: "Override recorded successfully" });
    } catch (err: any) {
      console.error("[AI-ROUTES] dispatch-override error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Neural Dispatch v2: Override Patterns ────────────────────────────────────

router.get(
  "/api/dispatch/override-patterns",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : req.user?.companyId;
      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }

      const { getOverridePatterns } = await import("../lib/dispatchOverrideLearning");
      const patterns = await getOverridePatterns(companyId);

      res.json({ companyId, patterns, totalPatterns: patterns.length });
    } catch (err: any) {
      console.error("[AI-ROUTES] override-patterns error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Neural Dispatch v2: Regret Minimization Simulation ──────────────────────

router.get(
  "/api/dispatch/simulate/:tripId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const tripId = parseInt(req.params.tripId as string);
      if (!tripId) {
        return res.status(400).json({ error: "Valid tripId is required" });
      }

      const candidateDrivers = req.query.drivers
        ? (req.query.drivers as string).split(",").map(Number).filter(Boolean)
        : [];
      const lookaheadMinutes = req.query.lookahead
        ? Math.min(parseInt(req.query.lookahead as string), 180)
        : 60;

      const { simulateAssignment } = await import("../lib/dispatchRegretEngine");
      const result = await simulateAssignment(tripId, candidateDrivers, lookaheadMinutes);

      res.json({ tripId, lookaheadMinutes, ...result });
    } catch (err: any) {
      console.error("[AI-ROUTES] dispatch-simulate error:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

export function registerAiRoutes(app: Express) {
  app.use(router);
}
