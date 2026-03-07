import type { Express } from "express";
import { storage } from "../storage";
import { authMiddleware, requireRole, requirePermission, type AuthRequest } from "../auth";
import { runRouteBatchingForCity } from "./routeEngine";
import { checkPatientNoShowStrikes } from "./noShowEngine";
import { computeDriverScoresForCity, computeAllCityScores } from "./driverScoreEngine";
import { z } from "zod";

export function registerAutomationRoutes(app: Express) {

  app.get("/api/route-batches", authMiddleware, requirePermission("dispatch", "read"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.query.cityId as string || req.query.city_id as string);
      const date = req.query.date as string;
      if (!cityId || !date) return res.status(400).json({ error: "cityId and date required" });

      const batches = await storage.getRouteBatchesByDate(cityId, date);
      res.json(batches);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/route-batches/run", authMiddleware, requirePermission("dispatch", "write"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.body.cityId as string);
      if (!cityId) return res.status(400).json({ error: "cityId required" });

      const city = await storage.getCity(cityId);
      if (!city) return res.status(404).json({ error: "City not found" });

      const result = await runRouteBatchingForCity(city);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/route-batches/:id/assign-driver", authMiddleware, requirePermission("dispatch", "write"), async (req: AuthRequest, res) => {
    try {
      const batchId = parseInt(req.params.id as string);
      const { driverId } = req.body;
      if (!driverId) return res.status(400).json({ error: "driverId required" });

      const batch = await storage.updateRouteBatch(batchId, {
        driverAssigned: parseInt(driverId),
        status: "assigned",
      });
      if (!batch) return res.status(404).json({ error: "Batch not found" });

      for (const tripId of batch.tripIds) {
        await storage.updateTrip(tripId, {
          driverId: parseInt(driverId),
          status: "ASSIGNED",
        } as any);
      }

      res.json(batch);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/trips/:id/reassign", authMiddleware, requirePermission("dispatch", "write"), async (req: AuthRequest, res) => {
    try {
      const tripId = parseInt(String(req.params.id));
      const { driverId, vehicleId } = req.body;

      const trip = await storage.getTrip(tripId);
      if (!trip) return res.status(404).json({ error: "Trip not found" });

      const updates: any = {};
      if (driverId !== undefined) updates.driverId = driverId ? parseInt(driverId) : null;
      if (vehicleId !== undefined) updates.vehicleId = vehicleId ? parseInt(vehicleId) : null;
      if (driverId) updates.status = "ASSIGNED";

      const updated = await storage.updateTrip(tripId, updates);

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "REASSIGN_TRIP",
        entity: "trips",
        entityId: tripId,
        details: `Reassigned trip ${trip.publicId} to driver ${driverId || "none"}`,
        cityId: trip.cityId,
      });

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/trips/:id/confirm", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const tripId = parseInt(String(req.params.id));
      const trip = await storage.getTrip(tripId);
      if (!trip) return res.status(404).json({ error: "Trip not found" });

      const updated = await storage.updateTripConfirmation(tripId, "confirmed", new Date());
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/trips/:id/patient-ready", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "DRIVER", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const tripId = parseInt(String(req.params.id));
      const { ready } = req.body;

      const trip = await storage.getTrip(tripId);
      if (!trip) return res.status(404).json({ error: "Trip not found" });

      if (ready) {
        const updated = await storage.updateTripConfirmation(tripId, "confirmed", new Date());
        res.json(updated);
      } else {
        await storage.updateTripConfirmation(tripId, "risk_no_show");

        if (trip.patientId) {
          const result = await checkPatientNoShowStrikes(trip.patientId, trip.clinicId);
          if (result.alertSent) {
            return res.json({ ...trip, noShowRisk: true, patientNoShowCount: result.count, clinicAlerted: true });
          }
        }
        const updated = await storage.getTrip(tripId);
        res.json(updated);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/patients/:id/no-show-count", authMiddleware, requirePermission("patients", "read"), async (req: AuthRequest, res) => {
    try {
      const patientId = parseInt(String(req.params.id));
      const count = await storage.getPatientNoShowCount(patientId);
      res.json({ patientId, noShowCount: count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/driver-scores", authMiddleware, requirePermission("drivers", "read"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.query.cityId as string || req.query.city_id as string);
      const weekStart = req.query.weekStart as string || req.query.week_start as string;
      if (!cityId) return res.status(400).json({ error: "cityId required" });

      const scores = await storage.getDriverScores(cityId, weekStart);
      res.json(scores);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/driver-scores/:driverId/history", authMiddleware, requirePermission("drivers", "read"), async (req: AuthRequest, res) => {
    try {
      const driverId = parseInt(String(req.params.driverId));
      const scores = await storage.getDriverScoreHistory(driverId);
      res.json(scores);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/driver-scores/compute", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        cityId: z.number().int().positive().optional(),
        weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "weekStart required (YYYY-MM-DD)" });

      if (parsed.data.cityId) {
        const city = await storage.getCity(parsed.data.cityId);
        if (!city) return res.status(404).json({ error: "City not found" });
        const result = await computeDriverScoresForCity(city, parsed.data.weekStart);
        res.json(result);
      } else {
        const result = await computeAllCityScores(parsed.data.weekStart);
        res.json(result);
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/financial/daily", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.query.cityId as string || req.query.city_id as string);
      const date = req.query.date as string;
      if (!cityId || !date) return res.status(400).json({ error: "cityId and date required" });

      const stats = await storage.getDailyFinancialStats(cityId, date);
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/financial/range", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.query.cityId as string || req.query.city_id as string);
      const startDate = req.query.startDate as string || req.query.start_date as string;
      const endDate = req.query.endDate as string || req.query.end_date as string;
      if (!cityId || !startDate || !endDate) return res.status(400).json({ error: "cityId, startDate, endDate required" });

      const days: any[] = [];
      const start = new Date(startDate);
      const end = new Date(endDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        const stats = await storage.getDailyFinancialStats(cityId, dateStr);
        days.push(stats);
      }

      const totals = {
        totalTrips: days.reduce((s, d) => s + d.totalTrips, 0),
        completed: days.reduce((s, d) => s + d.completed, 0),
        cancelled: days.reduce((s, d) => s + d.cancelled, 0),
        noShow: days.reduce((s, d) => s + d.noShow, 0),
        estimatedRevenue: Math.round(days.reduce((s, d) => s + d.estimatedRevenue, 0) * 100) / 100,
        totalMiles: Math.round(days.reduce((s, d) => s + d.totalMiles, 0) * 10) / 10,
      };

      res.json({ cityId, startDate, endDate, days, totals });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
