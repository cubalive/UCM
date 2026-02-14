import type { Express } from "express";
import { storage } from "../storage";
import { authMiddleware, requireRole, getUserCityIds, type AuthRequest } from "../auth";
import { z } from "zod";
import { db } from "../db";
import { trips, tripEvents, drivers } from "@shared/schema";
import { eq, and, sql, isNull } from "drizzle-orm";
import { tripLockedGuard } from "./tripLockGuard";

export function registerReportRoutes(app: Express) {

  app.get("/api/trips/:tripId/events",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(req.params.tripId as string);
        const trip = await storage.getTrip(tripId);
        if (!trip) return res.status(404).json({ message: "Trip not found" });

        const userCityIds = await getUserCityIds(req.user!.userId, req.user!.role);
        if (userCityIds.length > 0 && !userCityIds.includes(trip.cityId)) {
          return res.status(403).json({ message: "Access denied" });
        }

        const events = await storage.getTripEvents(tripId);
        res.json(events);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/trips/:tripId/events",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const tripId = parseInt(req.params.tripId as string);
        const trip = await storage.getTrip(tripId);
        if (!trip) return res.status(404).json({ message: "Trip not found" });

        const userCityIds = await getUserCityIds(req.user!.userId, req.user!.role);
        if (userCityIds.length > 0 && !userCityIds.includes(trip.cityId)) {
          return res.status(403).json({ message: "Access denied" });
        }

        if (tripLockedGuard(trip, req, res)) return;

        const schema = z.object({
          eventType: z.enum(["late_driver", "late_patient", "no_show_driver", "no_show_patient", "complaint", "incident"]),
          minutesLate: z.number().int().min(1).max(999).nullable().optional(),
          notes: z.string().max(1000).nullable().optional(),
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
        }

        const { eventType } = parsed.data;
        const isTerminalEvent = eventType === "no_show_driver" || eventType === "no_show_patient";

        const existingEvents = await db.select().from(tripEvents).where(
          and(
            eq(tripEvents.tripId, tripId),
            eq(tripEvents.eventType, eventType),
            ...(isTerminalEvent
              ? []
              : [sql`${tripEvents.createdAt} >= NOW() - INTERVAL '5 minutes'`]
            )
          )
        );

        if (existingEvents.length > 0) {
          return res.status(200).json({ ok: true, deduped: true, existingEventId: existingEvents[0].id, ...existingEvents[0] });
        }

        const event = await storage.createTripEvent({
          tripId,
          eventType,
          minutesLate: parsed.data.minutesLate ?? null,
          notes: parsed.data.notes ?? null,
          createdBy: req.user!.userId,
        });

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "CREATE_TRIP_EVENT",
          entity: "trip_events",
          entityId: event.id,
          details: `${eventType} on trip ${trip.publicId}${parsed.data.minutesLate ? ` (${parsed.data.minutesLate} min)` : ""}`,
          cityId: trip.cityId,
        });

        res.json({ ok: true, deduped: false, ...event });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/reports/drivers/weekly",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const cityId = parseInt((req.query.cityId || req.query.city_id) as string);
        const weekStart = (req.query.weekStart || req.query.week_start) as string;

        if (!cityId || !weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
          return res.status(400).json({ message: "cityId and weekStart (YYYY-MM-DD) required" });
        }

        const userCityIds = await getUserCityIds(req.user!.userId, req.user!.role);
        if (userCityIds.length > 0 && !userCityIds.includes(cityId)) {
          return res.status(403).json({ message: "Access denied" });
        }

        const ws = new Date(weekStart);
        const we = new Date(ws);
        we.setDate(we.getDate() + 6);
        const weekEnd = we.toISOString().split("T")[0];

        const cityDrivers = (await storage.getDrivers(cityId)).filter(d => d.status === "ACTIVE");

        const weekTrips = await db.select().from(trips)
          .where(
            and(
              eq(trips.cityId, cityId),
              sql`${trips.scheduledDate} >= ${weekStart}`,
              sql`${trips.scheduledDate} <= ${weekEnd}`,
              isNull(trips.deletedAt),
            )
          );

        const weekEvents = await storage.getTripEventsByDateRange(cityId, weekStart, weekEnd);

        const metrics = cityDrivers.map(driver => {
          const driverTrips = weekTrips.filter(t => t.driverId === driver.id);
          const assigned = driverTrips.length;
          const completed = driverTrips.filter(t => t.status === "COMPLETED").length;
          const cancelled = driverTrips.filter(t => t.status === "CANCELLED").length;

          const driverTripIds = new Set(driverTrips.map(t => t.id));
          const driverEvents = weekEvents.filter(e => driverTripIds.has(e.tripId));

          const noShowDriver = driverEvents.filter(e => e.eventType === "no_show_driver");
          const noShowPatient = driverEvents.filter(e => e.eventType === "no_show_patient");
          const lateDriver = driverEvents.filter(e => e.eventType === "late_driver");
          const latePatient = driverEvents.filter(e => e.eventType === "late_patient");

          const avgLateDriverMin = lateDriver.length > 0
            ? Math.round(lateDriver.reduce((s, e) => s + (e.minutesLate || 0), 0) / lateDriver.length)
            : 0;
          const avgLatePatientMin = latePatient.length > 0
            ? Math.round(latePatient.reduce((s, e) => s + (e.minutesLate || 0), 0) / latePatient.length)
            : 0;

          return {
            driverId: driver.id,
            driverName: `${driver.firstName} ${driver.lastName}`,
            driverPublicId: driver.publicId,
            tripsAssigned: assigned,
            tripsCompleted: completed,
            cancellations: cancelled,
            completionRate: assigned > 0 ? Math.round((completed / assigned) * 100) / 100 : 0,
            noShowDriverCount: noShowDriver.length,
            noShowPatientCount: noShowPatient.length,
            lateDriverCount: lateDriver.length,
            lateDriverAvgMinutes: avgLateDriverMin,
            latePatientCount: latePatient.length,
            latePatientAvgMinutes: avgLatePatientMin,
          };
        });

        res.json({
          cityId,
          weekStart,
          weekEnd,
          drivers: metrics,
        });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/bonus-rules",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (_req: AuthRequest, res) => {
      try {
        const rules = await storage.getAllDriverBonusRules();
        res.json(rules);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/bonus-rules/:cityId",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (req: AuthRequest, res) => {
      try {
        const cityId = parseInt(req.params.cityId as string);
        const rule = await storage.getDriverBonusRule(cityId);
        res.json(rule || { cityId, isEnabled: false, weeklyAmountCents: 0, criteriaJson: null });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.put("/api/bonus-rules/:cityId",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (req: AuthRequest, res) => {
      try {
        const cityId = parseInt(req.params.cityId as string);
        const schema = z.object({
          isEnabled: z.boolean(),
          weeklyAmountCents: z.number().int().min(0).max(100000),
          criteriaJson: z.object({
            maxNoShowDriver: z.number().int().min(0).optional(),
            maxLateDriver: z.number().int().min(0).optional(),
            minCompletionRate: z.number().min(0).max(1).optional(),
          }).nullable().optional(),
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
        }

        const rule = await storage.upsertDriverBonusRule({
          cityId,
          isEnabled: parsed.data.isEnabled,
          weeklyAmountCents: parsed.data.weeklyAmountCents,
          criteriaJson: parsed.data.criteriaJson ?? null,
          updatedBy: req.user!.userId,
        });

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "UPDATE_BONUS_RULES",
          entity: "driver_bonus_rules",
          entityId: rule.id,
          details: `Updated bonus rules for city ${cityId}: enabled=${parsed.data.isEnabled}, amount=$${(parsed.data.weeklyAmountCents / 100).toFixed(2)}`,
          cityId,
        });

        res.json(rule);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/bonuses/compute-week",
    authMiddleware,
    requireRole("SUPER_ADMIN"),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          cityId: z.number().int().positive(),
          weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "cityId and weekStart required" });
        }

        const { cityId, weekStart } = parsed.data;
        const rule = await storage.getDriverBonusRule(cityId);

        if (!rule || !rule.isEnabled) {
          return res.json({ cityId, weekStart, bonusEnabled: false, eligible: [], ineligible: [] });
        }

        const ws = new Date(weekStart);
        const we = new Date(ws);
        we.setDate(we.getDate() + 6);
        const weekEnd = we.toISOString().split("T")[0];

        const cityDrivers = (await storage.getDrivers(cityId)).filter(d => d.status === "ACTIVE");
        const weekTrips = await db.select().from(trips)
          .where(
            and(
              eq(trips.cityId, cityId),
              sql`${trips.scheduledDate} >= ${weekStart}`,
              sql`${trips.scheduledDate} <= ${weekEnd}`,
              isNull(trips.deletedAt),
            )
          );
        const weekEvents = await storage.getTripEventsByDateRange(cityId, weekStart, weekEnd);

        const criteria = (rule.criteriaJson || {}) as {
          maxNoShowDriver?: number;
          maxLateDriver?: number;
          minCompletionRate?: number;
        };

        const eligible: any[] = [];
        const ineligible: any[] = [];

        for (const driver of cityDrivers) {
          const driverTrips = weekTrips.filter(t => t.driverId === driver.id);
          const assigned = driverTrips.length;
          const completed = driverTrips.filter(t => t.status === "COMPLETED").length;
          const completionRate = assigned > 0 ? completed / assigned : 0;

          const driverTripIds = new Set(driverTrips.map(t => t.id));
          const driverEvents = weekEvents.filter(e => driverTripIds.has(e.tripId));
          const noShowDriverCount = driverEvents.filter(e => e.eventType === "no_show_driver").length;
          const lateDriverCount = driverEvents.filter(e => e.eventType === "late_driver").length;

          const reasons: string[] = [];
          if (criteria.maxNoShowDriver !== undefined && noShowDriverCount > criteria.maxNoShowDriver) {
            reasons.push(`no_shows=${noShowDriverCount} > max ${criteria.maxNoShowDriver}`);
          }
          if (criteria.maxLateDriver !== undefined && lateDriverCount > criteria.maxLateDriver) {
            reasons.push(`late=${lateDriverCount} > max ${criteria.maxLateDriver}`);
          }
          if (criteria.minCompletionRate !== undefined && completionRate < criteria.minCompletionRate) {
            reasons.push(`completion=${(completionRate * 100).toFixed(0)}% < min ${(criteria.minCompletionRate * 100).toFixed(0)}%`);
          }

          const entry = {
            driverId: driver.id,
            driverName: `${driver.firstName} ${driver.lastName}`,
            driverPublicId: driver.publicId,
            tripsAssigned: assigned,
            tripsCompleted: completed,
            completionRate: Math.round(completionRate * 100) / 100,
            noShowDriverCount,
            lateDriverCount,
            bonusAmountCents: rule.weeklyAmountCents,
          };

          if (reasons.length === 0 && assigned > 0) {
            eligible.push(entry);
          } else {
            ineligible.push({ ...entry, reasons: reasons.length > 0 ? reasons : ["no trips assigned"] });
          }
        }

        res.json({
          cityId,
          weekStart,
          weekEnd,
          bonusEnabled: true,
          weeklyAmountCents: rule.weeklyAmountCents,
          criteria,
          eligible,
          ineligible,
        });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );
}
