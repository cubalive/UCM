import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, authorize, tenantIsolation } from "../middleware/auth.js";
import { validateBody, validateParams, uuidParam } from "../middleware/validation.js";
import { billingRateLimiter } from "../middleware/rateLimiter.js";
import {
  getDriversForTenant,
  getDriverStatus,
  updateDriverAvailability,
  updateDriverLocation,
  detectStaleDrivers,
} from "../services/driverService.js";
import logger from "../lib/logger.js";

const router = Router();
router.use(authenticate, tenantIsolation);

const updateAvailabilitySchema = z.object({
  availability: z.enum(["available", "busy", "offline", "break"]),
});

const locationUpdateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).optional(),
});

const overrideStatusSchema = z.object({
  availability: z.enum(["available", "busy", "offline", "break"]),
  reason: z.string().max(500).optional(),
});

// List all drivers (dispatch view)
router.get(
  "/",
  authorize("admin", "dispatcher"),
  async (req: Request, res: Response) => {
    try {
      const drivers = await getDriversForTenant(req.tenantId!);
      res.json({ data: drivers });
    } catch (err: any) {
      logger.error("Failed to list drivers", { error: err.message });
      res.status(500).json({ error: "Failed to list drivers" });
    }
  }
);

// Get driver status
router.get(
  "/:id/status",
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const status = await getDriverStatus(req.params.id as string);
      if (!status) {
        res.status(404).json({ error: "Driver status not found" });
        return;
      }
      res.json(status);
    } catch (err: any) {
      logger.error("Failed to get driver status", { error: err.message });
      res.status(500).json({ error: "Failed to get driver status" });
    }
  }
);

// Driver updates own availability
router.post(
  "/me/availability",
  authorize("driver"),
  validateBody(updateAvailabilitySchema),
  async (req: Request, res: Response) => {
    try {
      const result = await updateDriverAvailability(
        req.user!.id,
        req.tenantId!,
        req.body.availability,
        req.user!.id,
        false
      );
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to update availability", { error: err.message });
      res.status(500).json({ error: "Failed to update availability" });
    }
  }
);

// Driver updates location
router.post(
  "/me/location",
  authorize("driver"),
  validateBody(locationUpdateSchema),
  async (req: Request, res: Response) => {
    try {
      const result = await updateDriverLocation(
        req.user!.id,
        req.tenantId!,
        req.body.latitude,
        req.body.longitude,
        req.body.heading,
        req.body.speed
      );
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to update location", { error: err.message });
      res.status(500).json({ error: "Failed to update location" });
    }
  }
);

// DISPATCH OVERRIDE: Force-set driver availability
router.post(
  "/:id/override-status",
  authorize("admin", "dispatcher"),
  validateParams(uuidParam),
  validateBody(overrideStatusSchema),
  async (req: Request, res: Response) => {
    try {
      const result = await updateDriverAvailability(
        req.params.id as string,
        req.tenantId!,
        req.body.availability,
        req.user!.id,
        true // manual override flag
      );
      res.json({ ...result, overrideApplied: true });
    } catch (err: any) {
      logger.error("Failed to override driver status", { error: err.message });
      const status = err.message.includes("not found") ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  }
);

// Detect stale drivers (dispatch tool)
router.get(
  "/stale",
  authorize("admin", "dispatcher"),
  async (req: Request, res: Response) => {
    try {
      const minutes = Number(req.query.minutes) || 15;
      const stale = await detectStaleDrivers(req.tenantId!, minutes);
      res.json({ data: stale, staleThresholdMinutes: minutes });
    } catch (err: any) {
      logger.error("Failed to detect stale drivers", { error: err.message });
      res.status(500).json({ error: "Failed to detect stale drivers" });
    }
  }
);

export default router;
