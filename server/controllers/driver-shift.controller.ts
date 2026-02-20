import type { Response } from "express";
import { storage } from "../storage";
import type { AuthRequest } from "../auth";
import { drivers, driverShifts, noShowEvidence, trips, tripSignatures, tripBilling } from "@shared/schema";
import { db } from "../db";
import { eq, and, sql, desc, gte, isNull, inArray } from "drizzle-orm";
import { z } from "zod";

export async function postDriverShiftStartHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const existing = await db.select().from(driverShifts)
      .where(and(eq(driverShifts.driverId, user.driverId), eq(driverShifts.status, "ACTIVE")))
      .limit(1);
    if (existing.length > 0) {
      return res.status(400).json({ message: "Shift already active", shift: existing[0] });
    }

    const driver = await storage.getDriver(user.driverId);
    const [shift] = await db.insert(driverShifts).values({
      driverId: user.driverId,
      companyId: driver?.companyId || null,
      source: "manual",
    }).returning();

    await db.update(drivers).set({
      dispatchStatus: "available",
      lastActiveAt: new Date(),
      lastSeenAt: new Date(),
    }).where(eq(drivers.id, user.driverId));

    const updatedDriver = await storage.getDriver(user.driverId);
    res.json({ shift, driver: updatedDriver });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postDriverShiftEndHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const [activeShift] = await db.select().from(driverShifts)
      .where(and(eq(driverShifts.driverId, user.driverId), eq(driverShifts.status, "ACTIVE")))
      .limit(1);
    if (!activeShift) {
      return res.status(400).json({ message: "No active shift to end" });
    }

    const now = new Date();
    const startedAt = new Date(activeShift.startedAt);
    const totalMinutes = (now.getTime() - startedAt.getTime()) / 60000;

    const [ended] = await db.update(driverShifts)
      .set({
        status: "COMPLETED",
        endedAt: now,
        totalMinutes: Math.round(totalMinutes * 100) / 100,
        notes: req.body?.notes || null,
      })
      .where(eq(driverShifts.id, activeShift.id))
      .returning();

    await db.update(drivers).set({
      dispatchStatus: "off",
      lastSeenAt: now,
      lastLat: null,
      lastLng: null,
    }).where(eq(drivers.id, user.driverId));

    const updatedDriver = await storage.getDriver(user.driverId);
    res.json({ shift: ended, driver: updatedDriver });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverActiveShiftHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const [activeShift] = await db.select().from(driverShifts)
      .where(and(eq(driverShifts.driverId, user.driverId), eq(driverShifts.status, "ACTIVE")))
      .limit(1);

    res.json({ shift: activeShift || null });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverShiftHistoryHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 20, 50);
    const range = (req.query.range as string) || "week";
    const now = new Date();
    let startDate = new Date();
    if (range === "week") {
      startDate.setDate(now.getDate() - 7);
    } else if (range === "month") {
      startDate.setMonth(now.getMonth() - 1);
    } else {
      startDate.setDate(now.getDate() - 1);
    }

    const conditions = [
      eq(driverShifts.driverId, user.driverId),
      gte(driverShifts.startedAt, startDate),
    ];

    const total = await db.select({ count: sql<number>`count(*)` })
      .from(driverShifts).where(and(...conditions)).then(r => Number(r[0]?.count || 0));

    const results = await db.select().from(driverShifts)
      .where(and(...conditions))
      .orderBy(desc(driverShifts.startedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const todayStr = now.toISOString().split("T")[0];
    const todayShifts = results.filter(s => s.startedAt.toISOString().split("T")[0] === todayStr);
    const todayMinutes = todayShifts.reduce((sum, s) => sum + (s.totalMinutes || 0), 0);
    const weekMinutes = results.reduce((sum, s) => sum + (s.totalMinutes || 0), 0);

    res.json({
      shifts: results,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      todayMinutes: Math.round(todayMinutes * 100) / 100,
      weekMinutes: Math.round(weekMinutes * 100) / 100,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postNoShowEvidenceHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const schema = z.object({
      tripId: z.number(),
      arrivedAt: z.string().optional(),
      waitedMinutes: z.number().optional(),
      callAttempted: z.boolean().optional().default(false),
      smsAttempted: z.boolean().optional().default(false),
      dispatchNotified: z.boolean().optional().default(false),
      reason: z.string().optional(),
      notes: z.string().optional(),
    });
    const data = schema.parse(req.body);

    const [trip] = await db.select().from(trips)
      .where(and(eq(trips.id, data.tripId), eq(trips.driverId, user.driverId)))
      .limit(1);
    if (!trip) return res.status(404).json({ message: "Trip not found or not assigned to you" });

    const [evidence] = await db.insert(noShowEvidence).values({
      tripId: data.tripId,
      driverId: user.driverId,
      arrivedAt: data.arrivedAt ? new Date(data.arrivedAt) : null,
      waitedMinutes: data.waitedMinutes || null,
      callAttempted: data.callAttempted,
      smsAttempted: data.smsAttempted,
      dispatchNotified: data.dispatchNotified,
      reason: data.reason || null,
      notes: data.notes || null,
    }).returning();

    res.json({ evidence });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function postSignatureRefusedHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const schema = z.object({
      tripId: z.number(),
      reason: z.string().optional(),
      stage: z.string().optional().default("dropoff"),
    });
    const data = schema.parse(req.body);

    const [trip] = await db.select().from(trips)
      .where(and(eq(trips.id, data.tripId), eq(trips.driverId, user.driverId)))
      .limit(1);
    if (!trip) return res.status(404).json({ message: "Trip not found or not assigned to you" });

    const existing = await db.select().from(tripSignatures)
      .where(eq(tripSignatures.tripId, data.tripId)).limit(1);

    if (existing.length > 0) {
      await db.update(tripSignatures).set({
        signatureRefused: true,
        refusedReason: data.reason || null,
        signatureStage: data.stage,
        driverSignedAt: new Date(),
      }).where(eq(tripSignatures.tripId, data.tripId));
    } else {
      await db.insert(tripSignatures).values({
        tripId: data.tripId,
        signatureRefused: true,
        refusedReason: data.reason || null,
        signatureStage: data.stage,
        driverSignedAt: new Date(),
      });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function getDriverGeofenceCheckHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const tripId = parseInt(req.query.tripId as string);
    const driverLat = parseFloat(req.query.lat as string);
    const driverLng = parseFloat(req.query.lng as string);

    if (!tripId || isNaN(driverLat) || isNaN(driverLng)) {
      return res.status(400).json({ message: "tripId, lat, lng required" });
    }

    const [trip] = await db.select().from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.driverId, user.driverId)))
      .limit(1);
    if (!trip) return res.status(404).json({ message: "Trip not found" });

    const pickupLat = Number(trip.pickupLat || 0);
    const pickupLng = Number(trip.pickupLng || 0);
    const dropoffLat = Number(trip.dropoffLat || 0);
    const dropoffLng = Number(trip.dropoffLng || 0);

    const pickupDistance = pickupLat && pickupLng
      ? haversineDistance(driverLat, driverLng, pickupLat, pickupLng) : null;
    const dropoffDistance = dropoffLat && dropoffLng
      ? haversineDistance(driverLat, driverLng, dropoffLat, dropoffLng) : null;

    const PICKUP_RADIUS = parseInt(process.env.GEOFENCE_PICKUP_RADIUS_METERS || "120");
    const DROPOFF_RADIUS = parseInt(process.env.GEOFENCE_DROPOFF_RADIUS_METERS || "160");

    res.json({
      pickupDistanceMeters: pickupDistance ? Math.round(pickupDistance) : null,
      dropoffDistanceMeters: dropoffDistance ? Math.round(dropoffDistance) : null,
      withinPickupRadius: pickupDistance !== null && pickupDistance <= PICKUP_RADIUS,
      withinDropoffRadius: dropoffDistance !== null && dropoffDistance <= DROPOFF_RADIUS,
      pickupRadiusMeters: PICKUP_RADIUS,
      dropoffRadiusMeters: DROPOFF_RADIUS,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getDriverShiftEarningsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if (!user?.driverId) return res.status(403).json({ message: "No driver profile linked" });

    const range = (req.query.range as string) || "today";
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    let startDate = todayStr;
    if (range === "week") {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      startDate = d.toISOString().split("T")[0];
    } else if (range === "month") {
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    }

    const completedTrips = await db.select().from(trips)
      .where(and(
        eq(trips.driverId, user.driverId),
        eq(trips.status, "COMPLETED"),
        sql`${trips.scheduledDate} >= ${startDate}`,
        sql`${trips.scheduledDate} <= ${todayStr}`,
        isNull(trips.deletedAt),
      ));

    const tripIds = completedTrips.length > 0 ? completedTrips.map(t => t.id) : [-1];
    const billingRecords = await db.select().from(tripBilling)
      .where(inArray(tripBilling.tripId, tripIds));

    let totalCents = 0;
    for (const b of billingRecords) {
      totalCents += b.totalCents || 0;
    }

    const shifts = await db.select().from(driverShifts)
      .where(and(
        eq(driverShifts.driverId, user.driverId),
        gte(driverShifts.startedAt, new Date(startDate)),
      ))
      .orderBy(desc(driverShifts.startedAt));

    const totalShiftMinutes = shifts.reduce((sum, s) => sum + (s.totalMinutes || 0), 0);
    const totalBreakMinutes = shifts.reduce((sum, s) => sum + (s.breakMinutes || 0), 0);

    const todayShifts = shifts.filter(s =>
      s.startedAt.toISOString().split("T")[0] === todayStr
    );
    const todayMinutes = todayShifts.reduce((sum, s) => sum + (s.totalMinutes || 0), 0);

    const todayTrips = completedTrips.filter(t => t.scheduledDate === todayStr);
    const todayTripIds = todayTrips.length > 0 ? todayTrips.map(t => t.id) : [-1];
    const todayBilling = billingRecords.filter(b => todayTripIds.includes(b.tripId));
    const todayCents = todayBilling.reduce((sum, b) => sum + (b.totalCents || 0), 0);

    res.json({
      range,
      startDate,
      endDate: todayStr,
      totalCents,
      tripCount: completedTrips.length,
      todayCents,
      todayTripCount: todayTrips.length,
      todayMinutes: Math.round(todayMinutes),
      totalShiftMinutes: Math.round(totalShiftMinutes),
      totalBreakMinutes: Math.round(totalBreakMinutes),
      shiftCount: shifts.length,
      items: completedTrips.slice(0, 30).map(t => ({
        tripId: t.id,
        publicId: t.publicId,
        date: t.scheduledDate,
        pickupAddress: t.pickupAddress,
        dropoffAddress: t.dropoffAddress,
        amountCents: billingRecords.find(b => b.tripId === t.id)?.totalCents || 0,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
