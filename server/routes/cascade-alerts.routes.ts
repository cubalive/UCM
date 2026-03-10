import express, { type Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { db } from "../db";
import { cascadeDelayAlerts, trips, drivers } from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  getCascadeDelayStatus,
  getActiveCascadeAlertsForCompany,
  acknowledgeCascadeAlert,
  getCascadeAlertsDashboard,
} from "../lib/cascadeDelayEngine";

const router = express.Router();

// ─── GET /api/cascade-alerts — Get cascade alerts for a driver on a date ─────
router.get(
  "/api/cascade-alerts",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const driverId = req.query.driverId ? parseInt(req.query.driverId as string) : undefined;
      const date = req.query.date as string;

      if (!driverId || !date) {
        return res.status(400).json({ message: "driverId and date query parameters are required" });
      }

      const alerts = await getCascadeDelayStatus(driverId, date);
      res.json({ ok: true, alerts });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── GET /api/cascade-alerts/active — Get all active cascade alerts for company ─
router.get(
  "/api/cascade-alerts/active",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : (req as any).user?.companyId;

      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }

      const alerts = await getActiveCascadeAlertsForCompany(companyId);

      // Enrich with trip and driver info
      const enriched = [];
      for (const alert of alerts) {
        const [triggerTrip] = await db
          .select({
            publicId: trips.publicId,
            pickupTime: trips.pickupTime,
            pickupAddress: trips.pickupAddress,
            dropoffAddress: trips.dropoffAddress,
            status: trips.status,
          })
          .from(trips)
          .where(eq(trips.id, alert.triggerTripId))
          .limit(1);

        const [affectedTrip] = await db
          .select({
            publicId: trips.publicId,
            pickupTime: trips.pickupTime,
            pickupAddress: trips.pickupAddress,
            dropoffAddress: trips.dropoffAddress,
            status: trips.status,
          })
          .from(trips)
          .where(eq(trips.id, alert.affectedTripId))
          .limit(1);

        const [driver] = await db
          .select({
            firstName: drivers.firstName,
            lastName: drivers.lastName,
            publicId: drivers.publicId,
          })
          .from(drivers)
          .where(eq(drivers.id, alert.driverId))
          .limit(1);

        enriched.push({
          ...alert,
          triggerTrip: triggerTrip || null,
          affectedTrip: affectedTrip || null,
          driver: driver || null,
        });
      }

      res.json({ ok: true, alerts: enriched, count: enriched.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── POST /api/cascade-alerts/:id/acknowledge — Acknowledge an alert ─────────
router.post(
  "/api/cascade-alerts/:id/acknowledge",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const alertId = parseInt(req.params.id as string);
      if (isNaN(alertId)) {
        return res.status(400).json({ message: "Invalid alert ID" });
      }

      const updated = await acknowledgeCascadeAlert(alertId);
      if (!updated) {
        return res.status(404).json({ message: "Alert not found" });
      }

      res.json({ ok: true, alert: updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── GET /api/cascade-alerts/dashboard — Summary stats ───────────────────────
router.get(
  "/api/cascade-alerts/dashboard",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : (req as any).user?.companyId;

      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }

      const dashboard = await getCascadeAlertsDashboard(companyId);
      res.json({ ok: true, ...dashboard });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

export function registerCascadeAlertRoutes(app: express.Express) {
  app.use(router);
}
