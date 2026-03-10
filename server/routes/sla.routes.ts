import express, { type Response } from "express";
import { authMiddleware, requireRole, getCompanyIdFromAuth, type AuthRequest } from "../auth";
import { getSLADashboard, calculateSLAMetrics } from "../lib/slaMetricsEngine";
import { detectStuckTrips } from "../lib/stuckTripDetector";

const router = express.Router();

// ─── GET /api/sla/metrics — Current SLA metrics dashboard ────────────────
router.get(
  "/api/sla/metrics",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : getCompanyIdFromAuth(req);

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }

      const cityId = req.query.cityId
        ? parseInt(req.query.cityId as string)
        : undefined;

      // Optional custom date range
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      if (from && to) {
        const metrics = await calculateSLAMetrics(companyId, cityId, {
          from,
          to,
        });
        return res.json({ metrics, companyId, cityId: cityId || null });
      }

      const dashboard = await getSLADashboard(companyId, cityId);
      res.json({ ...dashboard, companyId, cityId: cityId || null });
    } catch (err: any) {
      console.error("[SLA] Error fetching metrics:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

// ─── GET /api/sla/stuck-trips — Currently stuck trips ────────────────────
router.get(
  "/api/sla/stuck-trips",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : getCompanyIdFromAuth(req);

      // SUPER_ADMIN can see all stuck trips across companies
      const filterCompanyId = req.user?.role === "SUPER_ADMIN" && !req.query.companyId
        ? undefined
        : companyId || undefined;

      const stuckTrips = await detectStuckTrips(filterCompanyId);

      res.json({
        count: stuckTrips.length,
        trips: stuckTrips,
        companyId: filterCompanyId || null,
        generatedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[SLA] Error detecting stuck trips:", err.message);
      res.status(500).json({ error: err.message });
    }
  },
);

export function registerSLARoutes(app: express.Express) {
  app.use(router);
}
