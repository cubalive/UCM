import express, { type Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import {
  compareCities,
  getCityRankings,
  getCityTrends,
  getBenchmarks,
  generateComparativeReport,
} from "../lib/cityComparisonEngine";

const router = express.Router();

// ─── GET /api/city-comparison/compare — Compare metrics across cities ─────────
router.get(
  "/api/city-comparison/compare",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const cityIdsParam = req.query.cityIds as string;
      if (!cityIdsParam) {
        return res.status(400).json({ message: "cityIds query param is required (comma-separated)" });
      }

      const cityIds = cityIdsParam.split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
      if (cityIds.length === 0) {
        return res.status(400).json({ message: "At least one valid cityId is required" });
      }

      const from = (req.query.from as string) || defaultFrom();
      const to = (req.query.to as string) || defaultTo();

      const metrics = await compareCities(cityIds, { from, to });
      res.json({ ok: true, dateRange: { from, to }, cities: metrics });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── GET /api/city-comparison/rankings — Rank cities by metric ────────────────
router.get(
  "/api/city-comparison/rankings",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = (req as any).user;
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : user?.companyId;

      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }

      const metric = req.query.metric as string;
      if (!metric) {
        return res.status(400).json({ message: "metric query param is required" });
      }

      const from = (req.query.from as string) || defaultFrom();
      const to = (req.query.to as string) || defaultTo();

      const rankings = await getCityRankings(companyId, metric, { from, to });
      res.json({ ok: true, metric, dateRange: { from, to }, rankings });
    } catch (err: any) {
      const status = err.message?.includes("Invalid metric") ? 400 : 500;
      res.status(status).json({ message: err.message });
    }
  }
);

// ─── GET /api/city-comparison/trends/:cityId — Trend data for a city ──────────
router.get(
  "/api/city-comparison/trends/:cityId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const cityId = parseInt(String(req.params.cityId));
      if (isNaN(cityId)) {
        return res.status(400).json({ message: "Invalid cityId" });
      }

      const from = (req.query.from as string) || defaultFrom();
      const to = (req.query.to as string) || defaultTo();

      const trends = await getCityTrends(cityId, { from, to });
      res.json({ ok: true, dateRange: { from, to }, ...trends });
    } catch (err: any) {
      const status = err.message?.includes("not found") ? 404 : 500;
      res.status(status).json({ message: err.message });
    }
  }
);

// ─── GET /api/city-comparison/benchmarks — Company-wide benchmarks ────────────
router.get(
  "/api/city-comparison/benchmarks",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = (req as any).user;
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : user?.companyId;

      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }

      const result = await getBenchmarks(companyId);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── GET /api/city-comparison/report — Full comparative report ────────────────
router.get(
  "/api/city-comparison/report",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const cityIdsParam = req.query.cityIds as string;
      if (!cityIdsParam) {
        return res.status(400).json({ message: "cityIds query param is required (comma-separated)" });
      }

      const cityIds = cityIdsParam.split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
      if (cityIds.length === 0) {
        return res.status(400).json({ message: "At least one valid cityId is required" });
      }

      const from = (req.query.from as string) || defaultFrom();
      const to = (req.query.to as string) || defaultTo();

      const report = await generateComparativeReport(cityIds, { from, to });
      res.json({ ok: true, ...report });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0];
}

function defaultTo(): string {
  return new Date().toISOString().split("T")[0];
}

export function registerCityComparisonRoutes(app: express.Express) {
  app.use(router);
}
