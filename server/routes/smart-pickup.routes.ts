import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import type { Response } from "express";
import { requireClinicScope } from "../middleware/requireClinicScope";
import { suggestPickupTime, suggestPickupsForClinicDay } from "../lib/smartPickupEngine";
import { db } from "../db";
import { smartPickupSuggestions } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { storage } from "../storage";

export function registerSmartPickupRoutes(app: Express) {
  // Get pickup suggestion for a specific appointment
  app.post("/api/smart-pickup/suggest", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { clinicId, patientId, appointmentDate, appointmentTime, clinicTimezone } = req.body;
      if (!clinicId || !patientId || !appointmentDate || !appointmentTime) {
        return res.status(400).json({ message: "clinicId, patientId, appointmentDate, appointmentTime required" });
      }

      const suggestion = await suggestPickupTime(
        clinicId,
        patientId,
        appointmentDate,
        appointmentTime,
        clinicTimezone || "America/Los_Angeles"
      );

      res.json({ ok: true, suggestion });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get batch suggestions for a clinic day
  app.get("/api/smart-pickup/clinic/:clinicId/day", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const clinicId = parseInt(req.params.clinicId as string);
      const date = req.query.date as string;
      const tz = (req.query.timezone as string) || "America/Los_Angeles";
      if (!date) return res.status(400).json({ message: "date query parameter required" });

      const suggestions = await suggestPickupsForClinicDay(clinicId, date, tz);
      res.json({ ok: true, suggestions });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Clinic portal endpoint for suggestions
  app.post("/api/clinic/smart-pickup", authMiddleware, requireClinicScope as any, async (req: AuthRequest, res: Response) => {
    try {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.clinicId) return res.status(403).json({ message: "No clinic linked" });

      const { patientId, appointmentDate, appointmentTime } = req.body;
      if (!patientId || !appointmentDate || !appointmentTime) {
        return res.status(400).json({ message: "patientId, appointmentDate, appointmentTime required" });
      }

      const suggestion = await suggestPickupTime(
        user.clinicId,
        patientId,
        appointmentDate,
        appointmentTime
      );

      res.json({ ok: true, suggestion });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Accept/reject a suggestion
  app.patch("/api/smart-pickup/:id/accept", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      const { accepted, actualPickupTime } = req.body;

      await db.update(smartPickupSuggestions).set({
        accepted,
        actualPickupTime: actualPickupTime || null,
      }).where(eq(smartPickupSuggestions.id, id));

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get suggestion history for a clinic
  app.get("/api/smart-pickup/history/:clinicId", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const clinicId = parseInt(req.params.clinicId as string);
      const limit = parseInt(req.query.limit as string) || 50;

      const history = await db.select().from(smartPickupSuggestions)
        .where(eq(smartPickupSuggestions.clinicId, clinicId))
        .orderBy(desc(smartPickupSuggestions.createdAt))
        .limit(limit);

      res.json(history);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
