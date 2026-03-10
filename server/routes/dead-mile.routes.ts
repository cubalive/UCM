import express, { type Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import {
  calculateDeadMilesForDriver,
  calculateDailySummary,
  batchCalculateDeadMiles,
  getDeadMileReport,
  getFleetEfficiency,
} from "../lib/deadMileEngine";
import {
  suggestOptimalOrder,
  applyReorder,
  batchOptimize,
  getSavingsReport,
} from "../lib/routeOptimizationEngine";
import { db } from "../db";
import { deadMileSegments, deadMileDailySummary } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

const router = express.Router();

// ─── Dead-Mile Routes ─────────────────────────────────────────────────────────

/**
 * GET /api/dead-mile/driver/:driverId?date=YYYY-MM-DD
 * Get dead-mile details (segments) for a driver on a given date.
 */
router.get(
  "/api/dead-mile/driver/:driverId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const driverId = parseInt(String(req.params.driverId));
      const date = req.query.date as string;

      if (!driverId || !date) {
        return res.status(400).json({ error: "driverId and date are required" });
      }

      const segments = await db
        .select()
        .from(deadMileSegments)
        .where(
          and(
            eq(deadMileSegments.driverId, driverId),
            eq(deadMileSegments.segmentDate, date),
          )
        )
        .orderBy(deadMileSegments.createdAt);

      const summary = await db
        .select()
        .from(deadMileDailySummary)
        .where(
          and(
            eq(deadMileDailySummary.driverId, driverId),
            eq(deadMileDailySummary.summaryDate, date),
          )
        );

      res.json({
        driverId,
        date,
        segments,
        summary: summary[0] || null,
      });
    } catch (err: any) {
      console.error("[DEAD-MILE] Error fetching driver details:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /api/dead-mile/summary?companyId=&from=&to=
 * Get company-wide dead-mile summary report.
 */
router.get(
  "/api/dead-mile/summary",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(req.query.companyId as string);
      const from = req.query.from as string;
      const to = req.query.to as string;

      if (!companyId || !from || !to) {
        return res.status(400).json({ error: "companyId, from, and to are required" });
      }

      const report = await getDeadMileReport(companyId, from, to);
      res.json(report);
    } catch (err: any) {
      console.error("[DEAD-MILE] Error fetching summary:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /api/dead-mile/fleet-efficiency?companyId=&from=&to=
 * Fleet efficiency dashboard data.
 */
router.get(
  "/api/dead-mile/fleet-efficiency",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(req.query.companyId as string);
      const from = req.query.from as string;
      const to = req.query.to as string;

      if (!companyId || !from || !to) {
        return res.status(400).json({ error: "companyId, from, and to are required" });
      }

      const efficiency = await getFleetEfficiency(companyId, from, to);
      res.json(efficiency);
    } catch (err: any) {
      console.error("[DEAD-MILE] Error fetching fleet efficiency:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * POST /api/dead-mile/calculate?companyId=&date=YYYY-MM-DD
 * Trigger dead-mile calculation for all drivers in a company on a date.
 */
router.post(
  "/api/dead-mile/calculate",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(req.query.companyId as string || req.body.companyId);
      const date = (req.query.date as string) || req.body.date;

      if (!companyId || !date) {
        return res.status(400).json({ error: "companyId and date are required" });
      }

      const result = await batchCalculateDeadMiles(companyId, date);
      res.json({
        success: true,
        companyId,
        date,
        ...result,
      });
    } catch (err: any) {
      console.error("[DEAD-MILE] Error calculating:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Route Optimization Routes ────────────────────────────────────────────────

/**
 * GET /api/route-optimize/suggestions?driverId=&date=YYYY-MM-DD
 * Get reorder suggestions for a specific driver.
 */
router.get(
  "/api/route-optimize/suggestions",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const driverId = parseInt(req.query.driverId as string);
      const date = req.query.date as string;

      if (!driverId || !date) {
        return res.status(400).json({ error: "driverId and date are required" });
      }

      const suggestion = await suggestOptimalOrder(driverId, date);
      if (!suggestion) {
        return res.json({
          driverId,
          date,
          suggestion: null,
          message: "Not enough trips to optimize (need at least 2)",
        });
      }

      res.json({ driverId, date, suggestion });
    } catch (err: any) {
      console.error("[ROUTE-OPT] Error fetching suggestions:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * POST /api/route-optimize/apply
 * Apply a reorder suggestion.
 * Body: { driverId, date, newOrder: [{ tripId, position }] }
 */
router.post(
  "/api/route-optimize/apply",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { driverId, date, newOrder } = req.body;

      if (!driverId || !date || !Array.isArray(newOrder) || newOrder.length === 0) {
        return res.status(400).json({ error: "driverId, date, and newOrder array are required" });
      }

      const updated = await applyReorder(driverId, date, newOrder);
      res.json({
        success: true,
        driverId,
        date,
        tripsReordered: updated,
      });
    } catch (err: any) {
      console.error("[ROUTE-OPT] Error applying reorder:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

/**
 * GET /api/route-optimize/savings-report?companyId=&date=YYYY-MM-DD
 * Report on potential savings from route optimization.
 */
router.get(
  "/api/route-optimize/savings-report",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(req.query.companyId as string);
      const date = req.query.date as string;

      if (!companyId || !date) {
        return res.status(400).json({ error: "companyId and date are required" });
      }

      const report = await getSavingsReport(companyId, date);
      res.json(report);
    } catch (err: any) {
      console.error("[ROUTE-OPT] Error generating savings report:", err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

export function registerDeadMileRoutes(app: express.Express) {
  app.use(router);
}
