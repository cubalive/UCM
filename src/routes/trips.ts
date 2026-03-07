import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, authorize, tenantIsolation } from "../middleware/auth.js";
import { validateBody, validateParams, validateQuery, uuidParam } from "../middleware/validation.js";
import { billingRateLimiter } from "../middleware/rateLimiter.js";
import {
  createTrip,
  assignTrip,
  updateTripStatus,
  getTripsForDispatch,
  getTripById,
  getDriverTrips,
  cancelTrip,
  acceptTrip,
  declineTrip,
} from "../services/tripService.js";
import { autoAssignTrip } from "../services/autoAssignService.js";
import { getDb } from "../db/index.js";
import { tenants } from "../db/schema.js";
import { eq } from "drizzle-orm";
import logger from "../lib/logger.js";

const router = Router();
router.use(authenticate, tenantIsolation);

const createTripSchema = z.object({
  patientId: z.string().uuid(),
  pickupAddress: z.string().min(1).max(500),
  dropoffAddress: z.string().min(1).max(500),
  scheduledAt: z.coerce.date(),
  timezone: z.string().max(100).optional(),
  notes: z.string().max(1000).optional(),
  isImmediate: z.boolean().optional().default(false),
});

const assignTripSchema = z.object({
  driverId: z.string().uuid(),
});

const updateStatusSchema = z.object({
  status: z.enum(["en_route", "arrived", "in_progress", "completed", "cancelled"]),
  mileage: z.number().min(0).optional(),
  cancellationReason: z.string().max(500).optional(),
});

const tripFilterQuery = z.object({
  status: z.string().optional(),
  driverId: z.string().uuid().optional(),
  date: z.string().optional(),
});

// List trips (dispatch view)
router.get("/", billingRateLimiter, validateQuery(tripFilterQuery), async (req: Request, res: Response) => {
  try {
    const filters = {
      status: req.query.status ? (req.query.status as string).split(",") : undefined,
      driverId: req.query.driverId as string | undefined,
      date: req.query.date as string | undefined,
    };
    const trips = await getTripsForDispatch(req.tenantId!, filters);
    res.json({ data: trips });
  } catch (err: any) {
    logger.error("Failed to list trips", { error: err.message });
    res.status(500).json({ error: "Failed to list trips" });
  }
});

// Get single trip
router.get("/:id", validateParams(uuidParam), async (req: Request, res: Response) => {
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

// Create trip (clinic or dispatch)
router.post(
  "/",
  billingRateLimiter,
  authorize("admin", "dispatcher", "clinic"),
  validateBody(createTripSchema),
  async (req: Request, res: Response) => {
    try {
      const trip = await createTrip({
        tenantId: req.tenantId!,
        requestedBy: req.user!.id,
        ...req.body,
      });
      res.status(201).json(trip);
    } catch (err: any) {
      logger.error("Failed to create trip", { error: err.message });
      res.status(500).json({ error: "Failed to create trip" });
    }
  }
);

// Assign trip to driver (dispatch)
router.post(
  "/:id/assign",
  billingRateLimiter,
  authorize("admin", "dispatcher"),
  validateParams(uuidParam),
  validateBody(assignTripSchema),
  async (req: Request, res: Response) => {
    try {
      const trip = await assignTrip(
        req.params.id as string,
        req.body.driverId,
        req.tenantId!,
        req.user!.id
      );
      res.json(trip);
    } catch (err: any) {
      logger.error("Failed to assign trip", { error: err.message });
      const status = err.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

// Auto-assign trip (dispatch)
router.post(
  "/:id/auto-assign",
  billingRateLimiter,
  authorize("admin", "dispatcher"),
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const assigned = await autoAssignTrip(req.params.id as string, req.tenantId!);
      if (assigned) {
        res.json({ autoAssigned: true });
      } else {
        res.status(422).json({ error: "No available drivers for auto-assignment" });
      }
    } catch (err: any) {
      logger.error("Auto-assign failed", { error: err.message });
      res.status(500).json({ error: "Auto-assign failed" });
    }
  }
);

// Update trip status (driver or dispatch)
router.post(
  "/:id/status",
  billingRateLimiter,
  validateParams(uuidParam),
  validateBody(updateStatusSchema),
  async (req: Request, res: Response) => {
    try {
      if (req.body.status === "cancelled") {
        const trip = await cancelTrip(
          req.params.id as string,
          req.tenantId!,
          req.user!.id,
          req.body.cancellationReason
        );
        res.json(trip);
      } else {
        const trip = await updateTripStatus(
          req.params.id as string,
          req.body.status,
          req.tenantId!,
          req.user!.id,
          { mileage: req.body.mileage }
        );
        res.json(trip);
      }
    } catch (err: any) {
      logger.error("Failed to update trip status", { error: err.message });
      const status = err.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

// Driver accepts an assigned trip
router.post(
  "/:id/accept",
  authorize("driver"),
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const trip = await acceptTrip(req.params.id as string, req.user!.id, req.tenantId!);
      res.json({ accepted: true, trip });
    } catch (err: any) {
      const status = err.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

// Driver declines an assigned trip (goes back to pool)
router.post(
  "/:id/decline",
  authorize("driver"),
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const trip = await declineTrip(req.params.id as string, req.user!.id, req.tenantId!, req.body?.reason);
      res.json({ declined: true, trip });
    } catch (err: any) {
      const status = err.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

// Get driver's trips (driver view)
router.get(
  "/driver/my-trips",
  authorize("driver"),
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const activeOnly = req.query.active === "true";
      const [tenantRow] = await db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, req.tenantId!));
      const driverTrips = await getDriverTrips(req.user!.id, req.tenantId!, activeOnly);
      res.json({ data: driverTrips, timezone: tenantRow?.timezone || "America/New_York" });
    } catch (err: any) {
      logger.error("Failed to get driver trips", { error: err.message });
      res.status(500).json({ error: "Failed to get driver trips" });
    }
  }
);

export default router;
