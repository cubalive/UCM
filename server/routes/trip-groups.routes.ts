import express, { type Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import {
  listGroups,
  createGroup,
  addToGroup,
  removeFromGroup,
  getGroupDetails,
  optimizeGroupPickupOrder,
  autoGroupTrips,
  savingsReport,
} from "../lib/tripGroupingEngine";
import { findPickupClusterTrips } from "../lib/tripGroupingScheduler";

const router = express.Router();

// ─── GET /api/trip-groups — List trip groups ────────────────────────────────
router.get(
  "/api/trip-groups",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : req.user?.companyId;

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }

      const date = req.query.date as string | undefined;
      const cityId = req.query.cityId
        ? parseInt(req.query.cityId as string)
        : undefined;

      const groups = await listGroups(companyId, date, cityId);
      res.json({ ok: true, groups });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── POST /api/trip-groups — Create a group manually ────────────────────────
router.post(
  "/api/trip-groups",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { tripIds, companyId: bodyCompanyId, cityId, driverId } = req.body;
      const companyId = bodyCompanyId || req.user?.companyId;

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }
      if (!cityId) {
        return res.status(400).json({ error: "cityId is required" });
      }
      if (!tripIds || !Array.isArray(tripIds) || tripIds.length < 2) {
        return res.status(400).json({ error: "At least 2 tripIds are required" });
      }

      const group = await createGroup(
        tripIds,
        companyId,
        cityId,
        req.user!.userId,
        driverId
      );
      res.json({ ok: true, group });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// ─── POST /api/trip-groups/auto-detect — Auto-detect groupable trips ────────
router.post(
  "/api/trip-groups/auto-detect",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.body.companyId || req.user?.companyId;
      const date = req.body.date;

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }
      if (!date) {
        return res.status(400).json({ error: "date is required" });
      }

      const suggestions = await autoGroupTrips(companyId, date);
      res.json({
        ok: true,
        suggestions: suggestions.map((s) => ({
          destination: s.destination,
          tripCount: s.trips.length,
          trips: s.trips.map((t) => ({
            id: t.id,
            pickupTime: t.pickupTime,
            pickupAddress: t.pickupAddress,
            dropoffAddress: t.dropoffAddress,
          })),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /api/trip-groups/savings-report — Savings report ───────────────────
router.get(
  "/api/trip-groups/savings-report",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : req.user?.companyId;

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }

      const startDate = req.query.startDate as string | undefined;
      const endDate = req.query.endDate as string | undefined;

      const report = await savingsReport(companyId, startDate, endDate);
      res.json({ ok: true, ...report });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /api/trip-groups/:id — Get group details ───────────────────────────
router.get(
  "/api/trip-groups/:id",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const groupId = parseInt(req.params.id as string);
      if (isNaN(groupId)) {
        return res.status(400).json({ error: "Invalid group ID" });
      }

      const group = await getGroupDetails(groupId);
      if (!group) {
        return res.status(404).json({ error: "Group not found" });
      }

      res.json({ ok: true, group });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── POST /api/trip-groups/:id/members — Add trip to group ──────────────────
router.post(
  "/api/trip-groups/:id/members",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const groupId = parseInt(req.params.id as string);
      if (isNaN(groupId)) {
        return res.status(400).json({ error: "Invalid group ID" });
      }

      const { tripId } = req.body;
      if (!tripId) {
        return res.status(400).json({ error: "tripId is required" });
      }

      const member = await addToGroup(groupId, tripId);
      res.json({ ok: true, member });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// ─── DELETE /api/trip-groups/:id/members/:tripId — Remove from group ────────
router.delete(
  "/api/trip-groups/:id/members/:tripId",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const groupId = parseInt(req.params.id as string);
      const tripId = parseInt(req.params.tripId as string);
      if (isNaN(groupId) || isNaN(tripId)) {
        return res.status(400).json({ error: "Invalid group or trip ID" });
      }

      const member = await removeFromGroup(groupId, tripId);
      res.json({ ok: true, member });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// ─── POST /api/trip-groups/:id/optimize — Optimize pickup order ─────────────
router.post(
  "/api/trip-groups/:id/optimize",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const groupId = parseInt(req.params.id as string);
      if (isNaN(groupId)) {
        return res.status(400).json({ error: "Invalid group ID" });
      }

      const ordered = await optimizeGroupPickupOrder(groupId);
      res.json({ ok: true, ordered });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── POST /api/trip-groups/pickup-clusters — Find pickup-based groupings ───
router.post(
  "/api/trip-groups/pickup-clusters",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = req.body.companyId || req.user?.companyId;
      const date = req.body.date;

      if (!companyId) {
        return res.status(400).json({ error: "companyId is required" });
      }
      if (!date) {
        return res.status(400).json({ error: "date is required" });
      }

      const suggestions = await findPickupClusterTrips(companyId, date);
      res.json({
        ok: true,
        suggestions: suggestions.map((s) => ({
          pickupArea: s.pickupArea,
          type: s.type,
          tripCount: s.trips.length,
          trips: s.trips.map((t) => ({
            id: t.id,
            pickupTime: t.pickupTime,
            pickupAddress: t.pickupAddress,
            dropoffAddress: t.dropoffAddress,
          })),
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export function registerTripGroupRoutes(app: express.Express) {
  app.use(router);
}
