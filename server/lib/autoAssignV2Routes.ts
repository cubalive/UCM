import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { db } from "../db";
import { trips, companies, autoAssignRuns, autoAssignRunCandidates, automationEvents } from "@shared/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import {
  runAutoAssignForTrip,
  getAutoAssignRunDetails,
  getAutoAssignHistory,
  getAutomationEventsForTrip,
  scoreDriversForTrip,
} from "./autoAssignV2Engine";

export function registerAutoAssignV2Routes(app: Express) {
  app.post(
    "/api/auto-assign-v2/run/:tripId",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(req.params.tripId as string);
        if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });

        const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
        if (!trip) return res.status(404).json({ message: "Trip not found" });

        const [company] = await db.select().from(companies).where(eq(companies.id, trip.companyId));
        if (!company?.autoAssignV2Enabled) {
          return res.status(400).json({ message: "Auto-assign v2 is not enabled for this company" });
        }

        const result = await runAutoAssignForTrip(tripId, req.user?.userId);
        res.json(result);
      } catch (err: any) {
        console.error("[AUTO-ASSIGN-V2] Run error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/auto-assign-v2/run/:runId/details",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const runId = parseInt(String(req.params.runId));
        if (isNaN(runId)) return res.status(400).json({ message: "Invalid run ID" });

        const details = await getAutoAssignRunDetails(runId);
        if (!details) return res.status(404).json({ message: "Run not found" });

        res.json(details);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/auto-assign-v2/trip/:tripId/history",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(String(req.params.tripId));
        if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });

        const runs = await getAutoAssignHistory(tripId);
        res.json(runs);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/auto-assign-v2/trip/:tripId/events",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(String(req.params.tripId));
        if (isNaN(tripId)) return res.status(400).json({ message: "Invalid trip ID" });

        const events = await getAutomationEventsForTrip(tripId);
        res.json(events);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/auto-assign-v2/company/:companyId/config",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
    async (req: AuthRequest, res) => {
      try {
        const companyId = parseInt(String(req.params.companyId));
        const [company] = await db.select({
          autoAssignV2Enabled: companies.autoAssignV2Enabled,
          autoAssignOfferTimeoutSeconds: companies.autoAssignOfferTimeoutSeconds,
          autoAssignMaxRounds: companies.autoAssignMaxRounds,
          autoAssignMaxDistanceMeters: companies.autoAssignMaxDistanceMeters,
          autoAssignWeightDistance: companies.autoAssignWeightDistance,
          autoAssignWeightReliability: companies.autoAssignWeightReliability,
          autoAssignWeightLoad: companies.autoAssignWeightLoad,
          autoAssignWeightFatigue: companies.autoAssignWeightFatigue,
          zeroTouchDialysisEnabled: companies.zeroTouchDialysisEnabled,
        }).from(companies).where(eq(companies.id, companyId));

        if (!company) return res.status(404).json({ message: "Company not found" });
        res.json(company);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.patch(
    "/api/auto-assign-v2/company/:companyId/config",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
    async (req: AuthRequest, res) => {
      try {
        const companyId = parseInt(String(req.params.companyId));
        const updates: any = {};
        const allowed = [
          "autoAssignV2Enabled", "autoAssignOfferTimeoutSeconds", "autoAssignMaxRounds",
          "autoAssignMaxDistanceMeters", "autoAssignWeightDistance", "autoAssignWeightReliability",
          "autoAssignWeightLoad", "autoAssignWeightFatigue", "zeroTouchDialysisEnabled",
        ];

        for (const key of allowed) {
          if (req.body[key] !== undefined) updates[key] = req.body[key];
        }

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ message: "No valid fields to update" });
        }

        const [updated] = await db.update(companies).set(updates).where(eq(companies.id, companyId)).returning();
        if (!updated) return res.status(404).json({ message: "Company not found" });

        await db.insert(automationEvents).values({
          eventType: "AUTO_ASSIGN_CONFIG_UPDATE",
          companyId,
          actorUserId: req.user?.userId || null,
          payload: { updates },
        });

        res.json({ message: "Config updated", config: updates });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/auto-assign-v2/runs",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const { companyId, result: resultFilter, limit: limitStr } = req.query;
        const limit = Math.min(parseInt(limitStr as string) || 50, 200);

        const conditions = [];
        if (companyId) conditions.push(eq(autoAssignRuns.companyId, parseInt(companyId as string)));
        if (resultFilter) conditions.push(eq(autoAssignRuns.result, resultFilter as string));

        const runs = await db.select().from(autoAssignRuns)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(autoAssignRuns.createdAt))
          .limit(limit);

        res.json(runs);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/automation-events",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const { eventType, companyId, tripId, limit: limitStr } = req.query;
        const limit = Math.min(parseInt(limitStr as string) || 50, 200);

        const conditions = [];
        if (eventType) conditions.push(eq(automationEvents.eventType, eventType as string));
        if (companyId) conditions.push(eq(automationEvents.companyId, parseInt(companyId as string)));
        if (tripId) conditions.push(eq(automationEvents.tripId, parseInt(tripId as string)));

        const events = await db.select().from(automationEvents)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(automationEvents.createdAt))
          .limit(limit);

        res.json(events);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/auto-assign-v2/trip/:tripId/override",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(String(req.params.tripId));
        const { driverId } = req.body;
        if (!driverId) return res.status(400).json({ message: "driverId required" });

        const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
        if (!trip) return res.status(404).json({ message: "Trip not found" });

        // Only allow override if trip is in an assignable status
        const overridableStatuses = ["SCHEDULED", "PENDING", "ASSIGNED"];
        if (!overridableStatuses.includes(trip.status)) {
          return res.status(409).json({ message: `Trip status is ${trip.status}, cannot override assignment` });
        }

        // Optimistic locking: check current status in WHERE to prevent concurrent overwrites
        const previousStatus = trip.status;
        const updated = await db.update(trips).set({
          driverId,
          status: "ASSIGNED",
          assignedAt: new Date(),
          assignmentSource: "manual_override",
          assignmentReason: `Manual override by user ${req.user?.userId}`,
          autoAssignStatus: "PAUSED",
          autoAssignSelectedDriverId: driverId,
        } as any).where(and(eq(trips.id, tripId), eq(trips.status, previousStatus))).returning();

        if (!updated.length) {
          return res.status(409).json({ message: "Concurrent update detected — trip was modified by another process" });
        }

        await db.insert(automationEvents).values({
          eventType: "AUTO_ASSIGN_OVERRIDE",
          tripId,
          driverId,
          companyId: trip.companyId,
          actorUserId: req.user?.userId || null,
          payload: { reason: "Manual override", previousStatus },
        });

        res.json({ message: "Trip assigned manually", tripId, driverId });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );
}
