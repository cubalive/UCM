import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, authorize, tenantIsolation } from "../middleware/auth.js";
import { validateBody, validateParams, uuidParam } from "../middleware/validation.js";
import { getDb } from "../db/index.js";
import { trips, users, patients, driverStatus, tenants } from "../db/schema.js";
import { eq, and, sql, inArray, desc } from "drizzle-orm";
import { assignTrip, updateTripStatus, cancelTrip } from "../services/tripService.js";
import { updateDriverAvailability, detectStaleDrivers, getDriversForTenant } from "../services/driverService.js";
import { autoAssignTrip, findBestDriver } from "../services/autoAssignService.js";
import { recordAudit } from "../services/auditService.js";
import { getConnectedStats, getOnlineDrivers } from "../services/realtimeService.js";
import logger from "../lib/logger.js";

const router = Router();
router.use(authenticate, authorize("admin", "dispatcher"), tenantIsolation);

// Dispatch dashboard data — enriched for frontend consumption
router.get("/dashboard", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const tenantId = req.tenantId!;

    // Get tenant timezone + trips + drivers in parallel
    const [tenantRow] = await db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    const tenantTimezone = tenantRow?.timezone || "America/New_York";

    const [allTrips, enrichedDrivers] = await Promise.all([
      db
        .select()
        .from(trips)
        .where(
          and(
            eq(trips.tenantId, tenantId),
            inArray(trips.status, ["requested", "assigned", "en_route", "arrived", "in_progress"] as any)
          )
        )
        .orderBy(desc(trips.scheduledAt))
        .limit(300),
      getDriversForTenant(tenantId),
    ]);

    // Build lookup maps for patient/driver names
    const patientIds = [...new Set(allTrips.map((t) => t.patientId).filter(Boolean))];
    const driverIds = [...new Set(allTrips.map((t) => t.driverId).filter(Boolean))] as string[];

    const [patientRows, driverRows] = await Promise.all([
      patientIds.length > 0
        ? db.select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName })
            .from(patients).where(inArray(patients.id, patientIds))
        : [],
      driverIds.length > 0
        ? db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users).where(inArray(users.id, driverIds))
        : [],
    ]);

    const patientMap = new Map(patientRows.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));
    const driverMap = new Map(driverRows.map((d) => [d.id, `${d.firstName} ${d.lastName}`]));

    // Enrich trips with names and normalized fields
    const enrichedTrips = allTrips.map((t) => ({
      id: t.id,
      status: t.status,
      priority: (t.metadata as any)?.isImmediate ? "immediate" : "scheduled",
      pickupAddress: t.pickupAddress,
      dropoffAddress: t.dropoffAddress,
      scheduledPickup: t.scheduledAt?.toISOString(),
      patientName: patientMap.get(t.patientId) || null,
      driverId: t.driverId,
      driverName: t.driverId ? driverMap.get(t.driverId) || null : null,
      notes: t.notes,
      timezone: t.timezone,
      createdAt: t.createdAt.toISOString(),
      metadata: t.metadata,
    }));

    // Normalize drivers for frontend
    const normalizedDrivers = enrichedDrivers.map((d) => ({
      id: d.id,
      name: `${d.firstName} ${d.lastName}`,
      email: d.email,
      availability: d.availability,
      activeTripCount: d.activeTrips,
      latitude: d.latitude ? Number(d.latitude) : null,
      longitude: d.longitude ? Number(d.longitude) : null,
      lastLocationAt: d.lastLocationAt?.toISOString() || null,
    }));

    const wsStats = getConnectedStats();
    const onlineDriversList = getOnlineDrivers(tenantId);
    const onlineDriverIds = new Set(onlineDriversList.map(d => d.driverId));

    // Tag online presence on drivers
    const driversWithPresence = normalizedDrivers.map((d) => ({
      ...d,
      isOnline: onlineDriverIds.has(d.id),
    }));

    res.json({
      trips: enrichedTrips,
      drivers: driversWithPresence,
      timezone: tenantTimezone,
      stats: {
        connections: wsStats,
        onlineDrivers: onlineDriversList.length,
      },
    });
  } catch (err: any) {
    logger.error("Failed to load dispatch dashboard", { error: err.message });
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

// Bulk auto-assign all pending trips
router.post("/auto-assign-all", async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const pendingTrips = await db.select().from(trips).where(
      and(eq(trips.tenantId, req.tenantId!), eq(trips.status, "requested"))
    );

    const results = { assigned: 0, failed: 0, noDriver: 0 };

    for (const trip of pendingTrips) {
      const success = await autoAssignTrip(trip.id, req.tenantId!);
      if (success) results.assigned++;
      else results.noDriver++;
    }

    res.json(results);
  } catch (err: any) {
    logger.error("Bulk auto-assign failed", { error: err.message });
    res.status(500).json({ error: "Bulk auto-assign failed" });
  }
});

// Force reassign trip
const reassignSchema = z.object({
  driverId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

router.post(
  "/trips/:id/reassign",
  validateParams(uuidParam),
  validateBody(reassignSchema),
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const [trip] = await db.select().from(trips).where(
        and(eq(trips.id, req.params.id as string), eq(trips.tenantId, req.tenantId!))
      );

      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

      // Force back to requested, then reassign
      if (["assigned", "en_route", "arrived", "in_progress"].includes(trip.status)) {
        await db.update(trips).set({
          status: "requested",
          driverId: null,
          updatedAt: new Date(),
        }).where(and(eq(trips.id, trip.id), eq(trips.tenantId, req.tenantId!)));
      }

      const updated = await assignTrip(
        trip.id,
        req.body.driverId,
        req.tenantId!,
        req.user!.id
      );

      await recordAudit({
        tenantId: req.tenantId!,
        userId: req.user!.id,
        action: "dispatch.reassign",
        resource: "trip",
        resourceId: trip.id,
        details: {
          previousDriverId: trip.driverId,
          newDriverId: req.body.driverId,
          reason: req.body.reason,
        },
      });

      res.json({ reassigned: true, trip: updated });
    } catch (err: any) {
      logger.error("Reassign failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

// Force release a busy driver
router.post(
  "/drivers/:id/release",
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const result = await updateDriverAvailability(
        req.params.id as string,
        req.tenantId!,
        "available",
        req.user!.id,
        true
      );

      await recordAudit({
        tenantId: req.tenantId!,
        userId: req.user!.id,
        action: "dispatch.driver_released",
        resource: "driver",
        resourceId: req.params.id as string,
      });

      res.json({ released: true, ...result });
    } catch (err: any) {
      logger.error("Failed to release driver", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

// Force resync all stale drivers to offline
router.post("/resync-stale", async (req: Request, res: Response) => {
  try {
    const minutes = Number(req.query.minutes) || 15;
    const stale = await detectStaleDrivers(req.tenantId!, minutes);

    let corrected = 0;
    for (const driver of stale) {
      await updateDriverAvailability(
        driver.driverId,
        req.tenantId!,
        "offline",
        req.user!.id,
        true
      );
      corrected++;
    }

    await recordAudit({
      tenantId: req.tenantId!,
      userId: req.user!.id,
      action: "dispatch.resync_stale",
      resource: "drivers",
      details: { staleCount: stale.length, corrected, thresholdMinutes: minutes },
    });

    res.json({ staleDetected: stale.length, corrected });
  } catch (err: any) {
    logger.error("Stale resync failed", { error: err.message });
    res.status(500).json({ error: "Stale resync failed" });
  }
});

// Force unassign a trip (send back to requested pool)
router.post(
  "/trips/:id/unassign",
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const [trip] = await db.select().from(trips).where(
        and(eq(trips.id, req.params.id as string), eq(trips.tenantId, req.tenantId!))
      );

      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

      if (!["assigned", "en_route", "arrived"].includes(trip.status)) {
        res.status(400).json({ error: `Cannot unassign trip in status: ${trip.status}` });
        return;
      }

      const previousDriverId = trip.driverId;

      await db.update(trips).set({
        status: "requested",
        driverId: null,
        updatedAt: new Date(),
        metadata: {
          ...(trip.metadata as Record<string, unknown>),
          unassignedAt: new Date().toISOString(),
          unassignedBy: req.user!.id,
          unassignReason: req.body?.reason || "Dispatch unassign",
        },
      }).where(and(eq(trips.id, trip.id), eq(trips.tenantId, req.tenantId!)));

      await recordAudit({
        tenantId: req.tenantId!,
        userId: req.user!.id,
        action: "dispatch.unassign",
        resource: "trip",
        resourceId: trip.id,
        details: { previousDriverId, reason: req.body?.reason },
      });

      // Auto-release the previous driver if they have no other active trips
      if (previousDriverId) {
        try {
          const { autoSetAvailable } = await import("../services/driverService.js");
          await autoSetAvailable(previousDriverId, req.tenantId!);
        } catch { /* non-fatal */ }
      }

      res.json({ unassigned: true, tripId: trip.id });
    } catch (err: any) {
      logger.error("Unassign failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

// Trip status repair — fix inconsistent trip states
const statusRepairSchema = z.object({
  newStatus: z.enum(["requested", "assigned", "en_route", "arrived", "in_progress", "completed", "cancelled"]),
  reason: z.string().min(1).max(500),
});

router.post(
  "/trips/:id/repair",
  validateParams(uuidParam),
  validateBody(statusRepairSchema),
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const [trip] = await db.select().from(trips).where(
        and(eq(trips.id, req.params.id as string), eq(trips.tenantId, req.tenantId!))
      );

      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

      const previousStatus = trip.status;
      const updateData: Record<string, unknown> = {
        status: req.body.newStatus,
        updatedAt: new Date(),
        metadata: {
          ...(trip.metadata as Record<string, unknown>),
          repairedAt: new Date().toISOString(),
          repairedBy: req.user!.id,
          repairReason: req.body.reason,
          previousStatus,
        },
      };

      // Clear driver if going back to requested
      if (req.body.newStatus === "requested") {
        updateData.driverId = null;
      }
      if (req.body.newStatus === "completed" && !trip.completedAt) {
        updateData.completedAt = new Date();
      }

      const [updated] = await db.update(trips).set(updateData).where(and(eq(trips.id, trip.id), eq(trips.tenantId, req.tenantId!))).returning();

      await recordAudit({
        tenantId: req.tenantId!,
        userId: req.user!.id,
        action: "dispatch.trip_status_repair",
        resource: "trip",
        resourceId: trip.id,
        details: { previousStatus, newStatus: req.body.newStatus, reason: req.body.reason },
      });

      res.json({ repaired: true, trip: updated });
    } catch (err: any) {
      logger.error("Trip status repair failed", { error: err.message });
      res.status(500).json({ error: err.message });
    }
  }
);

// Force cancel a trip from dispatch
router.post(
  "/trips/:id/cancel",
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const trip = await cancelTrip(
        req.params.id as string,
        req.tenantId!,
        req.user!.id,
        req.body?.reason || "Cancelled by dispatch"
      );
      res.json({ cancelled: true, trip });
    } catch (err: any) {
      logger.error("Dispatch cancel failed", { error: err.message });
      const status = err.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

export default router;
