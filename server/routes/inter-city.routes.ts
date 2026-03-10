import express, { type Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import {
  createTransferRequest,
  findTransferPoint,
  assignDrivers,
  handleDriverHandoff,
  getTransferStatus,
  cancelTransfer,
  listTransfers,
} from "../lib/interCityTransferEngine";

const router = express.Router();

// ─── POST /api/inter-city/transfers — Create a new inter-city transfer ────────
router.post(
  "/api/inter-city/transfers",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = (req as any).user;
      const companyId = req.body.companyId || user?.companyId;
      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }

      const {
        originCityId,
        destinationCityId,
        patientId,
        requestedDate,
        requestedTime,
        pickupAddress,
        dropoffAddress,
        transferPointAddress,
        transferPointLat,
        transferPointLng,
        estimatedDistanceMiles,
        estimatedDurationMinutes,
        notes,
      } = req.body;

      if (!originCityId || !destinationCityId || !patientId || !requestedDate || !requestedTime || !pickupAddress || !dropoffAddress) {
        return res.status(400).json({
          message: "Required fields: originCityId, destinationCityId, patientId, requestedDate, requestedTime, pickupAddress, dropoffAddress",
        });
      }

      const transfer = await createTransferRequest({
        companyId,
        originCityId,
        destinationCityId,
        patientId,
        requestedDate,
        requestedTime,
        pickupAddress,
        dropoffAddress,
        transferPointAddress,
        transferPointLat,
        transferPointLng,
        estimatedDistanceMiles,
        estimatedDurationMinutes,
        coordinatorUserId: user?.id,
        notes,
      });

      res.status(201).json({ ok: true, transfer });
    } catch (err: any) {
      res.status(err.message?.includes("not found") ? 404 : 400).json({ message: err.message });
    }
  }
);

// ─── GET /api/inter-city/transfers — List transfers ───────────────────────────
router.get(
  "/api/inter-city/transfers",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = (req as any).user;
      const companyId = req.query.companyId
        ? parseInt(req.query.companyId as string)
        : user?.companyId;

      if (!companyId) {
        return res.status(400).json({ message: "companyId is required" });
      }

      const filters = {
        status: req.query.status as string | undefined,
        originCityId: req.query.originCityId ? parseInt(req.query.originCityId as string) : undefined,
        destinationCityId: req.query.destinationCityId ? parseInt(req.query.destinationCityId as string) : undefined,
        patientId: req.query.patientId ? parseInt(req.query.patientId as string) : undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      };

      const transfers = await listTransfers(companyId, filters);
      res.json({ ok: true, transfers, count: transfers.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

// ─── GET /api/inter-city/transfers/:id — Get transfer details ─────────────────
router.get(
  "/api/inter-city/transfers/:id",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const transferId = parseInt(String(req.params.id));
      if (isNaN(transferId)) {
        return res.status(400).json({ message: "Invalid transfer ID" });
      }

      const result = await getTransferStatus(transferId);
      res.json({ ok: true, ...result });
    } catch (err: any) {
      const status = err.message?.includes("not found") ? 404 : 500;
      res.status(status).json({ message: err.message });
    }
  }
);

// ─── PUT /api/inter-city/transfers/:id/assign-drivers — Assign drivers ────────
router.put(
  "/api/inter-city/transfers/:id/assign-drivers",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const transferId = parseInt(String(req.params.id));
      if (isNaN(transferId)) {
        return res.status(400).json({ message: "Invalid transfer ID" });
      }

      const { originDriverId, destinationDriverId } = req.body;
      if (!originDriverId || !destinationDriverId) {
        return res.status(400).json({ message: "originDriverId and destinationDriverId are required" });
      }

      const transfer = await assignDrivers(transferId, originDriverId, destinationDriverId);
      res.json({ ok: true, transfer });
    } catch (err: any) {
      const status = err.message?.includes("not found") ? 404 : 400;
      res.status(status).json({ message: err.message });
    }
  }
);

// ─── POST /api/inter-city/transfers/:id/handoff — Advance handoff status ──────
router.post(
  "/api/inter-city/transfers/:id/handoff",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const transferId = parseInt(String(req.params.id));
      if (isNaN(transferId)) {
        return res.status(400).json({ message: "Invalid transfer ID" });
      }

      const transfer = await handleDriverHandoff(transferId);
      res.json({ ok: true, transfer });
    } catch (err: any) {
      const status = err.message?.includes("not found") ? 404 : 400;
      res.status(status).json({ message: err.message });
    }
  }
);

// ─── POST /api/inter-city/transfers/:id/cancel — Cancel a transfer ────────────
router.post(
  "/api/inter-city/transfers/:id/cancel",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const transferId = parseInt(String(req.params.id));
      if (isNaN(transferId)) {
        return res.status(400).json({ message: "Invalid transfer ID" });
      }

      const user = (req as any).user;
      const reason = req.body.reason || "No reason provided";
      const transfer = await cancelTransfer(transferId, reason, user?.id || 0);
      res.json({ ok: true, transfer });
    } catch (err: any) {
      const status = err.message?.includes("not found") ? 404 : 400;
      res.status(status).json({ message: err.message });
    }
  }
);

// ─── GET /api/inter-city/transfer-points — Suggest transfer points ────────────
router.get(
  "/api/inter-city/transfer-points",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const originCityId = parseInt(req.query.originCityId as string);
      const destinationCityId = parseInt(req.query.destinationCityId as string);

      if (isNaN(originCityId) || isNaN(destinationCityId)) {
        return res.status(400).json({ message: "originCityId and destinationCityId query params are required" });
      }

      const point = await findTransferPoint(originCityId, destinationCityId);
      res.json({ ok: true, transferPoint: point });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

export function registerInterCityRoutes(app: express.Express) {
  app.use(router);
}
