import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { db } from "../db";
import { driverWeeklySchedules, sundayRosters, sundayRosterDrivers, substitutePool, driverReplacements, drivers, trips } from "@shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { isDriverOnline } from "./driverClassification";
import { storage } from "../storage";

const NOT_STARTED_STATUSES: ("SCHEDULED" | "ASSIGNED")[] = ["SCHEDULED", "ASSIGNED"];

function getDayKey(date: string): string | null {
  const d = new Date(date + "T12:00:00Z");
  const day = d.getUTCDay();
  const map: Record<number, string> = { 1: "mon", 2: "tue", 3: "wed", 4: "thu", 5: "fri", 6: "sat", 0: "sun" };
  return map[day] || null;
}

export async function getScheduledDriverIdsForDay(cityId: number, date: string): Promise<Set<number>> {
  const dayKey = getDayKey(date);
  if (!dayKey) return new Set();

  const scheduledDriverIds = new Set<number>();

  if (dayKey === "sun") {
    const [roster] = await db.select().from(sundayRosters)
      .where(and(eq(sundayRosters.cityId, cityId), eq(sundayRosters.rosterDate, date)));

    if (roster && roster.enabled) {
      const rosterDrivers = await db.select().from(sundayRosterDrivers)
        .where(eq(sundayRosterDrivers.rosterId, roster.id));
      rosterDrivers.forEach(rd => scheduledDriverIds.add(rd.driverId));
    }
  } else {
    const schedules = await db.select().from(driverWeeklySchedules)
      .where(eq(driverWeeklySchedules.cityId, cityId));

    for (const sched of schedules) {
      const enabledKey = `${dayKey}Enabled` as keyof typeof sched;
      if (sched[enabledKey]) {
        scheduledDriverIds.add(sched.driverId);
      }
    }
  }

  const replacements = await db.select().from(driverReplacements)
    .where(and(eq(driverReplacements.cityId, cityId), eq(driverReplacements.replacementDate, date), eq(driverReplacements.status, "active")));

  for (const r of replacements) {
    scheduledDriverIds.delete(r.outDriverId);
    scheduledDriverIds.add(r.substituteDriverId);
  }

  return scheduledDriverIds;
}

export function registerScheduleRoutes(app: Express) {

  app.get("/api/schedules/weekly", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.query.cityId as string);
      if (isNaN(cityId)) return res.status(400).json({ message: "cityId required" });

      const schedules = await db.select().from(driverWeeklySchedules)
        .where(eq(driverWeeklySchedules.cityId, cityId));

      const cityDrivers = await db.select().from(drivers)
        .where(and(eq(drivers.cityId, cityId), eq(drivers.active, true)));

      res.json({ schedules, drivers: cityDrivers });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/schedules/weekly", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        cityId: z.number(),
        driverId: z.number(),
        monEnabled: z.boolean().optional(),
        monStart: z.string().optional(),
        monEnd: z.string().optional(),
        tueEnabled: z.boolean().optional(),
        tueStart: z.string().optional(),
        tueEnd: z.string().optional(),
        wedEnabled: z.boolean().optional(),
        wedStart: z.string().optional(),
        wedEnd: z.string().optional(),
        thuEnabled: z.boolean().optional(),
        thuStart: z.string().optional(),
        thuEnd: z.string().optional(),
        friEnabled: z.boolean().optional(),
        friStart: z.string().optional(),
        friEnd: z.string().optional(),
        satEnabled: z.boolean().optional(),
        satStart: z.string().optional(),
        satEnd: z.string().optional(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });

      const { cityId, driverId, ...days } = parsed.data;

      const [existing] = await db.select().from(driverWeeklySchedules)
        .where(and(eq(driverWeeklySchedules.driverId, driverId), eq(driverWeeklySchedules.cityId, cityId)));

      if (existing) {
        const [updated] = await db.update(driverWeeklySchedules)
          .set({ ...days, updatedBy: req.user!.userId, updatedAt: new Date() })
          .where(eq(driverWeeklySchedules.id, existing.id))
          .returning();
        res.json(updated);
      } else {
        const [created] = await db.insert(driverWeeklySchedules)
          .values({ driverId, cityId, ...days, updatedBy: req.user!.userId, updatedAt: new Date() })
          .returning();
        res.json(created);
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/schedules/weekly/bulk", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        cityId: z.number(),
        schedules: z.array(z.object({
          driverId: z.number(),
          monEnabled: z.boolean().optional().default(false),
          monStart: z.string().optional().default("06:00"),
          monEnd: z.string().optional().default("18:00"),
          tueEnabled: z.boolean().optional().default(false),
          tueStart: z.string().optional().default("06:00"),
          tueEnd: z.string().optional().default("18:00"),
          wedEnabled: z.boolean().optional().default(false),
          wedStart: z.string().optional().default("06:00"),
          wedEnd: z.string().optional().default("18:00"),
          thuEnabled: z.boolean().optional().default(false),
          thuStart: z.string().optional().default("06:00"),
          thuEnd: z.string().optional().default("18:00"),
          friEnabled: z.boolean().optional().default(false),
          friStart: z.string().optional().default("06:00"),
          friEnd: z.string().optional().default("18:00"),
          satEnabled: z.boolean().optional().default(false),
          satStart: z.string().optional().default("06:00"),
          satEnd: z.string().optional().default("18:00"),
        })),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });

      const results = [];
      for (const sched of parsed.data.schedules) {
        const { driverId, ...days } = sched;
        const [existing] = await db.select().from(driverWeeklySchedules)
          .where(and(eq(driverWeeklySchedules.driverId, driverId), eq(driverWeeklySchedules.cityId, parsed.data.cityId)));

        if (existing) {
          const [updated] = await db.update(driverWeeklySchedules)
            .set({ ...days, updatedBy: req.user!.userId, updatedAt: new Date() })
            .where(eq(driverWeeklySchedules.id, existing.id))
            .returning();
          results.push(updated);
        } else {
          const [created] = await db.insert(driverWeeklySchedules)
            .values({ driverId, cityId: parsed.data.cityId, ...days, updatedBy: req.user!.userId, updatedAt: new Date() })
            .returning();
          results.push(created);
        }
      }

      res.json(results);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/schedules/sunday-roster", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.query.cityId as string);
      const date = req.query.date as string;
      if (isNaN(cityId) || !date) return res.status(400).json({ message: "cityId and date required" });

      const [roster] = await db.select().from(sundayRosters)
        .where(and(eq(sundayRosters.cityId, cityId), eq(sundayRosters.rosterDate, date)));

      if (!roster) {
        return res.json({ roster: null, drivers: [] });
      }

      const rosterDrivers = await db.select().from(sundayRosterDrivers)
        .where(eq(sundayRosterDrivers.rosterId, roster.id));

      const driverIds = rosterDrivers.map(rd => rd.driverId);
      let driverDetails: any[] = [];
      if (driverIds.length > 0) {
        driverDetails = await db.select().from(drivers).where(inArray(drivers.id, driverIds));
      }

      const driverEntries = rosterDrivers.map(rd => {
        const detail = driverDetails.find((d: any) => d.id === rd.driverId);
        return { ...rd, driver: detail || null };
      });

      res.json({ roster, drivers: driverDetails, rosterDriverEntries: driverEntries });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/schedules/sunday-roster", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        cityId: z.number(),
        date: z.string(),
        enabled: z.boolean(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });

      const [existing] = await db.select().from(sundayRosters)
        .where(and(eq(sundayRosters.cityId, parsed.data.cityId), eq(sundayRosters.rosterDate, parsed.data.date)));

      if (existing) {
        const [updated] = await db.update(sundayRosters)
          .set({ enabled: parsed.data.enabled, updatedBy: req.user!.userId, updatedAt: new Date() })
          .where(eq(sundayRosters.id, existing.id))
          .returning();
        res.json(updated);
      } else {
        const [created] = await db.insert(sundayRosters)
          .values({ cityId: parsed.data.cityId, rosterDate: parsed.data.date, enabled: parsed.data.enabled, updatedBy: req.user!.userId, updatedAt: new Date() })
          .returning();
        res.json(created);
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/schedules/sunday-roster/drivers", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        cityId: z.number(),
        date: z.string(),
        driverId: z.number(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });

      let [roster] = await db.select().from(sundayRosters)
        .where(and(eq(sundayRosters.cityId, parsed.data.cityId), eq(sundayRosters.rosterDate, parsed.data.date)));

      if (!roster) {
        [roster] = await db.insert(sundayRosters)
          .values({ cityId: parsed.data.cityId, rosterDate: parsed.data.date, enabled: true, updatedBy: req.user!.userId })
          .returning();
      }

      const [existingDriver] = await db.select().from(sundayRosterDrivers)
        .where(and(eq(sundayRosterDrivers.rosterId, roster.id), eq(sundayRosterDrivers.driverId, parsed.data.driverId)));

      if (existingDriver) return res.json(existingDriver);

      const [added] = await db.insert(sundayRosterDrivers)
        .values({ rosterId: roster.id, driverId: parsed.data.driverId })
        .returning();

      res.json(added);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/schedules/sunday-roster/drivers/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

      await db.delete(sundayRosterDrivers).where(eq(sundayRosterDrivers.id, id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/schedules/substitutes", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.query.cityId as string);
      const date = req.query.date as string;
      if (isNaN(cityId) || !date) return res.status(400).json({ message: "cityId and date required" });

      const subs = await db.select().from(substitutePool)
        .where(and(eq(substitutePool.cityId, cityId), eq(substitutePool.poolDate, date)));

      const driverIds = subs.map(s => s.driverId);
      let driverDetails: any[] = [];
      if (driverIds.length > 0) {
        driverDetails = await db.select().from(drivers).where(inArray(drivers.id, driverIds));
      }

      res.json({ substitutes: subs, drivers: driverDetails });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/schedules/substitutes", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        cityId: z.number(),
        date: z.string(),
        driverId: z.number(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });

      const [existing] = await db.select().from(substitutePool)
        .where(and(
          eq(substitutePool.cityId, parsed.data.cityId),
          eq(substitutePool.poolDate, parsed.data.date),
          eq(substitutePool.driverId, parsed.data.driverId)
        ));

      if (existing) return res.json(existing);

      const [added] = await db.insert(substitutePool)
        .values({ cityId: parsed.data.cityId, poolDate: parsed.data.date, driverId: parsed.data.driverId, addedBy: req.user!.userId })
        .returning();

      res.json(added);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/schedules/substitutes/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

      await db.delete(substitutePool).where(eq(substitutePool.id, id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/schedules/replacements", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.query.cityId as string);
      const date = req.query.date as string;
      if (isNaN(cityId) || !date) return res.status(400).json({ message: "cityId and date required" });

      const replacements = await db.select().from(driverReplacements)
        .where(and(eq(driverReplacements.cityId, cityId), eq(driverReplacements.replacementDate, date)));

      res.json(replacements);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/schedules/replacements", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        cityId: z.number(),
        date: z.string(),
        outDriverId: z.number(),
        substituteDriverId: z.number(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });

      const sub = await db.select().from(drivers).where(eq(drivers.id, parsed.data.substituteDriverId));
      if (!sub.length) return res.status(404).json({ message: "Substitute driver not found" });

      const subDriver = sub[0];
      if (!isDriverOnline(subDriver)) {
        return res.status(400).json({ message: "Substitute driver must be logged in" });
      }

      const [existing] = await db.select().from(driverReplacements)
        .where(and(
          eq(driverReplacements.cityId, parsed.data.cityId),
          eq(driverReplacements.replacementDate, parsed.data.date),
          eq(driverReplacements.outDriverId, parsed.data.outDriverId)
        ));

      if (existing) {
        const [updated] = await db.update(driverReplacements)
          .set({ substituteDriverId: parsed.data.substituteDriverId, status: "active", createdBy: req.user!.userId })
          .where(eq(driverReplacements.id, existing.id))
          .returning();
        return res.json(updated);
      }

      const [created] = await db.insert(driverReplacements)
        .values({
          cityId: parsed.data.cityId,
          replacementDate: parsed.data.date,
          outDriverId: parsed.data.outDriverId,
          substituteDriverId: parsed.data.substituteDriverId,
          createdBy: req.user!.userId,
        })
        .returning();

      res.json(created);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/schedules/replacements/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

      await db.delete(driverReplacements).where(eq(driverReplacements.id, id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/schedules/reassign", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        cityId: z.number(),
        date: z.string(),
        outDriverId: z.number(),
        substituteDriverId: z.number(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message });

      const { cityId, date, outDriverId, substituteDriverId } = parsed.data;

      const [subDriver] = await db.select().from(drivers).where(eq(drivers.id, substituteDriverId));
      if (!subDriver) return res.status(404).json({ message: "Substitute driver not found" });

      if (!isDriverOnline(subDriver)) {
        return res.status(400).json({ message: "Substitute must be logged in to receive trips" });
      }

      const eligibleTrips = await db.select().from(trips)
        .where(and(
          eq(trips.driverId, outDriverId),
          eq(trips.scheduledDate, date),
          eq(trips.cityId, cityId),
          inArray(trips.status, NOT_STARTED_STATUSES)
        ));

      if (eligibleTrips.length === 0) {
        return res.json({ reassigned: 0, skipped: 0, message: "No eligible trips to reassign" });
      }

      const tripIds = eligibleTrips.map(t => t.id);

      await db.update(trips)
        .set({
          driverId: substituteDriverId,
          vehicleId: subDriver.vehicleId,
          assignmentSource: "substitute_reassign",
          assignedBy: req.user!.userId,
          assignedAt: new Date(),
        })
        .where(inArray(trips.id, tripIds));

      const allOutTrips = await db.select().from(trips)
        .where(and(
          eq(trips.driverId, outDriverId),
          eq(trips.scheduledDate, date),
          eq(trips.cityId, cityId)
        ));
      const skipped = allOutTrips.length;

      await storage.createAuditLog({
        userId: req.user!.userId,
        action: "SUBSTITUTE_REASSIGN",
        entity: "schedule",
        entityId: outDriverId,
        details: `Reassigned ${tripIds.length} trip(s) from driver #${outDriverId} to substitute #${substituteDriverId}. ${skipped} trip(s) in-progress were kept.`,
        cityId,
      });

      res.json({
        reassigned: tripIds.length,
        skipped,
        tripIds,
        message: `${tripIds.length} trip(s) reassigned to substitute driver`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/schedules/eligible-drivers", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.query.cityId as string);
      const date = req.query.date as string;
      if (isNaN(cityId) || !date) return res.status(400).json({ message: "cityId and date required" });

      const scheduledDriverIds = await getScheduledDriverIdsForDay(cityId, date);

      const cityDrivers = await db.select().from(drivers)
        .where(and(eq(drivers.cityId, cityId), eq(drivers.active, true)));

      const eligible = cityDrivers.filter(d => {
        if (!scheduledDriverIds.has(d.id)) return false;
        if (!isDriverOnline(d)) return false;
        return true;
      });

      const scheduled = cityDrivers.filter(d => scheduledDriverIds.has(d.id));

      const replacementsData = await db.select().from(driverReplacements)
        .where(and(eq(driverReplacements.cityId, cityId), eq(driverReplacements.replacementDate, date), eq(driverReplacements.status, "active")));
      const outDriverIds = new Set(replacementsData.map(r => r.outDriverId));

      res.json({
        eligible,
        scheduled,
        outDriverIds: Array.from(outDriverIds),
        replacements: replacementsData,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/assignments/schedule-status", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const cityId = parseInt(req.query.cityId as string);
      const date = req.query.date as string;
      if (isNaN(cityId) || !date) return res.status(400).json({ message: "cityId and date required" });

      const scheduledDriverIds = await getScheduledDriverIdsForDay(cityId, date);

      const cityDrivers = await db.select().from(drivers)
        .where(and(eq(drivers.cityId, cityId), eq(drivers.active, true)));

      const scheduledDrivers = cityDrivers.filter(d => scheduledDriverIds.has(d.id));

      const eligibleDrivers = scheduledDrivers.filter(d => {
        if (!isDriverOnline(d)) return false;
        if (d.dispatchStatus === "hold") return false;
        return true;
      });

      const offlineScheduledCount = scheduledDrivers.filter(d => !isDriverOnline(d)).length;
      const holdCount = scheduledDrivers.filter(d => isDriverOnline(d) && d.dispatchStatus === "hold").length;

      const allTrips = await db.select().from(trips)
        .where(and(
          eq(trips.cityId, cityId),
          eq(trips.scheduledDate, date),
        ));

      const CANCELLED_STATUSES = ["CANCELLED", "NO_SHOW"];
      const activeTrips = allTrips.filter(t => !CANCELLED_STATUSES.includes(t.status) && !t.deletedAt);
      const assignedDriverIdsFromTrips = new Set(activeTrips.filter(t => t.driverId).map(t => t.driverId!));

      const existingAssignments = await storage.getDriverVehicleAssignments(cityId, date);
      const assignedDriverIdsFromAssignments = new Set(existingAssignments.map(a => a.driverId));

      const allAssignedDriverIds = new Set<number>();
      assignedDriverIdsFromTrips.forEach(id => allAssignedDriverIds.add(id));
      assignedDriverIdsFromAssignments.forEach(id => allAssignedDriverIds.add(id));

      const unassignedDrivers = eligibleDrivers.filter(d => !allAssignedDriverIds.has(d.id));

      const scheduledDriversWithStatus = scheduledDrivers.map(d => ({
        id: d.id,
        firstName: d.firstName,
        lastName: d.lastName,
        publicId: d.publicId,
        phone: d.phone,
        cityId: d.cityId,
        status: d.status,
        vehicleId: d.vehicleId,
        loggedIn: isDriverOnline(d),
        onHold: d.dispatchStatus === "hold",
        dispatchStatus: d.dispatchStatus,
      }));

      const unassignedDriversData = unassignedDrivers.map(d => ({
        id: d.id,
        firstName: d.firstName,
        lastName: d.lastName,
        publicId: d.publicId,
        phone: d.phone,
        cityId: d.cityId,
        status: d.status,
        vehicleId: d.vehicleId,
      }));

      const hasSchedule = scheduledDriverIds.size > 0;

      res.json({
        hasSchedule,
        scheduledDrivers: scheduledDriversWithStatus,
        unassignedDrivers: unassignedDriversData,
        counts: {
          scheduledCount: scheduledDrivers.length,
          eligibleCount: eligibleDrivers.length,
          assignedCount: allAssignedDriverIds.size,
          unassignedCount: unassignedDrivers.length,
          offlineScheduledCount,
          holdCount,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
