import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import {
  getEscalatedTrips,
  muteEtaAlert,
  markEtaResolved,
} from "./etaVarianceEngine";

export function registerEtaVarianceRoutes(app: Express) {
  app.get(
    "/api/eta-escalations",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const { level, companyId, cityId, limit } = req.query;
        const escalated = await getEscalatedTrips({
          level: level as string | undefined,
          companyId: companyId ? parseInt(companyId as string) : undefined,
          cityId: cityId ? parseInt(cityId as string) : undefined,
          limit: limit ? parseInt(limit as string) : 50,
        });
        res.json(escalated);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/eta-escalations/:tripId/mute",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(req.params.tripId as string);
        const durationMs = req.body.durationMs || 30 * 60 * 1000;
        const result = await muteEtaAlert(tripId, durationMs, req.user?.userId);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/eta-escalations/:tripId/resolve",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(req.params.tripId as string);
        await markEtaResolved(tripId, req.user?.userId);
        res.json({ message: "Alert resolved" });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );
}
