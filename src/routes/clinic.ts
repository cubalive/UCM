import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, authorize, tenantIsolation } from "../middleware/auth.js";
import { validateBody, validateParams, validateQuery, uuidParam, paginationQuery } from "../middleware/validation.js";
import { billingRateLimiter } from "../middleware/rateLimiter.js";
import { createTrip, getTripsForDispatch, getTripById, cancelTrip } from "../services/tripService.js";
import { autoAssignTrip } from "../services/autoAssignService.js";
import { getDb } from "../db/index.js";
import { patients, users, trips as tripsTable, tenants } from "../db/schema.js";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import logger from "../lib/logger.js";

const router = Router();
router.use(authenticate, authorize("clinic", "admin"), tenantIsolation);

const createPatientSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.string().optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
  insuranceId: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

const createTripSchema = z.object({
  patientId: z.string().uuid(),
  pickupAddress: z.string().min(1).max(500),
  dropoffAddress: z.string().min(1).max(500),
  pickupLat: z.number().min(-90).max(90).optional(),
  pickupLng: z.number().min(-180).max(180).optional(),
  dropoffLat: z.number().min(-90).max(90).optional(),
  dropoffLng: z.number().min(-180).max(180).optional(),
  estimatedMiles: z.number().min(0).optional(),
  estimatedMinutes: z.number().int().min(0).optional(),
  scheduledAt: z.coerce.date(),
  timezone: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
  isImmediate: z.boolean().optional().default(false),
});

// List clinic's patients
router.get("/patients", billingRateLimiter, validateQuery(paginationQuery), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const offset = (page - 1) * limit;

    const results = await db
      .select()
      .from(patients)
      .where(eq(patients.tenantId, req.tenantId!))
      .orderBy(desc(patients.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(patients)
      .where(eq(patients.tenantId, req.tenantId!));

    res.json({ data: results, pagination: { page, limit, total: Number(count) } });
  } catch (err: any) {
    logger.error("Failed to list patients", { error: err.message });
    res.status(500).json({ error: "Failed to list patients" });
  }
});

// Create patient
router.post(
  "/patients",
  billingRateLimiter,
  validateBody(createPatientSchema),
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const [patient] = await db
        .insert(patients)
        .values({ tenantId: req.tenantId!, ...req.body })
        .returning();

      res.status(201).json(patient);
    } catch (err: any) {
      logger.error("Failed to create patient", { error: err.message });
      res.status(500).json({ error: "Failed to create patient" });
    }
  }
);

// Get single patient
router.get(
  "/patients/:id",
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const [patient] = await db
        .select()
        .from(patients)
        .where(and(eq(patients.id, req.params.id as string), eq(patients.tenantId, req.tenantId!)));

      if (!patient) {
        res.status(404).json({ error: "Patient not found" });
        return;
      }
      res.json(patient);
    } catch (err: any) {
      logger.error("Failed to get patient", { error: err.message });
      res.status(500).json({ error: "Failed to get patient" });
    }
  }
);

// Update patient
const updatePatientSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  dateOfBirth: z.string().optional(),
  phone: z.string().max(20).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  insuranceId: z.string().max(100).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
});

router.put(
  "/patients/:id",
  billingRateLimiter,
  validateParams(uuidParam),
  validateBody(updatePatientSchema),
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const [existing] = await db
        .select()
        .from(patients)
        .where(and(eq(patients.id, req.params.id as string), eq(patients.tenantId, req.tenantId!)));

      if (!existing) {
        res.status(404).json({ error: "Patient not found" });
        return;
      }

      const [updated] = await db
        .update(patients)
        .set({ ...req.body, updatedAt: new Date() })
        .where(and(eq(patients.id, req.params.id as string), eq(patients.tenantId, req.tenantId!)))
        .returning();

      res.json(updated);
    } catch (err: any) {
      logger.error("Failed to update patient", { error: err.message });
      res.status(500).json({ error: "Failed to update patient" });
    }
  }
);

// Delete patient (cannot delete if they have active trips)
router.delete(
  "/patients/:id",
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const [existing] = await db
        .select()
        .from(patients)
        .where(and(eq(patients.id, req.params.id as string), eq(patients.tenantId, req.tenantId!)));

      if (!existing) {
        res.status(404).json({ error: "Patient not found" });
        return;
      }

      // Check for active trips
      const [activeTrips] = await db
        .select({ count: sql<number>`count(*)` })
        .from(tripsTable)
        .where(
          and(
            eq(tripsTable.patientId, req.params.id as string),
            eq(tripsTable.tenantId, req.tenantId!),
            sql`${tripsTable.status} NOT IN ('completed', 'cancelled')`
          )
        );

      if (Number(activeTrips.count) > 0) {
        res.status(409).json({
          error: `Cannot delete patient with ${activeTrips.count} active trip(s). Cancel or complete them first.`,
        });
        return;
      }

      await db
        .delete(patients)
        .where(and(eq(patients.id, req.params.id as string), eq(patients.tenantId, req.tenantId!)));

      res.json({ success: true, message: "Patient deleted" });
    } catch (err: any) {
      if (err.code === "23503") {
        res.status(409).json({
          error: "Cannot delete patient with existing trip or invoice history. Consider updating their record instead.",
        });
        return;
      }
      logger.error("Failed to delete patient", { error: err.message });
      res.status(500).json({ error: "Failed to delete patient" });
    }
  }
);

// Request a trip for a patient
router.post(
  "/request-trip",
  billingRateLimiter,
  validateBody(createTripSchema),
  async (req: Request, res: Response) => {
    try {
      const trip = await createTrip({
        tenantId: req.tenantId!,
        requestedBy: req.user!.id,
        ...req.body,
      });

      // Auto-attempt assignment for immediate trips
      let autoAssigned = false;
      if (req.body.isImmediate) {
        try {
          autoAssigned = await autoAssignTrip(trip.id, req.tenantId!);
        } catch {
          // Non-fatal: dispatch will handle manually
        }
      }

      res.status(201).json({
        trip,
        autoAssigned,
        message: autoAssigned
          ? "Immediate trip auto-assigned to nearest driver"
          : req.body.isImmediate
            ? "Immediate trip request sent to dispatch"
            : "Trip request submitted to dispatch",
      });
    } catch (err: any) {
      logger.error("Failed to request trip", { error: err.message });
      res.status(500).json({ error: "Failed to request trip" });
    }
  }
);

// View trips (clinic sees their own trips — enriched with names)
router.get("/trips", billingRateLimiter, async (req: Request, res: Response) => {
  try {
    const rawTrips = await getTripsForDispatch(req.tenantId!, {
      status: req.query.status ? (req.query.status as string).split(",") : undefined,
    });

    // Enrich with patient + driver names
    const db = getDb();
    const patientIds = [...new Set(rawTrips.map((t: any) => t.patientId).filter(Boolean))];
    const driverIds = [...new Set(rawTrips.map((t: any) => t.driverId).filter(Boolean))] as string[];

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

    const enriched = rawTrips.map((t: any) => ({
      id: t.id,
      status: t.status,
      priority: (t.metadata as any)?.isImmediate ? "immediate" : "scheduled",
      pickupAddress: t.pickupAddress,
      dropoffAddress: t.dropoffAddress,
      scheduledPickup: t.scheduledAt?.toISOString?.() || t.scheduledAt,
      timezone: t.timezone,
      patientName: patientMap.get(t.patientId) || null,
      driverName: t.driverId ? driverMap.get(t.driverId) || null : null,
      notes: t.notes,
      createdAt: t.createdAt?.toISOString?.() || t.createdAt,
    }));

    const [tenantRow] = await db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, req.tenantId!));
    res.json({ data: enriched, timezone: tenantRow?.timezone || "America/New_York" });
  } catch (err: any) {
    logger.error("Failed to list clinic trips", { error: err.message });
    res.status(500).json({ error: "Failed to list trips" });
  }
});

// Get trip details
router.get("/trips/:id", validateParams(uuidParam), async (req: Request, res: Response) => {
  try {
    const trip = await getTripById(req.params.id as string, req.tenantId!);
    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    res.json(trip);
  } catch (err: any) {
    logger.error("Failed to get trip", { error: err.message });
    res.status(500).json({ error: "Failed to get trip" });
  }
});

// Cancel a trip (clinic can cancel if not yet completed)
router.post(
  "/trips/:id/cancel",
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const trip = await cancelTrip(
        req.params.id as string,
        req.tenantId!,
        req.user!.id,
        req.body?.reason
      );
      res.json(trip);
    } catch (err: any) {
      logger.error("Failed to cancel trip", { error: err.message });
      const status = err.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

export default router;
