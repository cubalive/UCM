import express, { type Express, type Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { requireTenantScope } from "../middleware";
import { db } from "../db";
import { trips, pharmacyOrders } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  createProofOfDelivery,
  getProofOfDelivery,
  getPharmacyOrderProofs,
  validateDeliveryProof,
  type ProofType,
} from "../lib/proofOfDelivery";

const VALID_PROOF_TYPES: ProofType[] = ["SIGNATURE", "PHOTO", "GPS_VERIFICATION", "ID_CHECK"];

const router = express.Router();

// ─── POST /api/delivery-proof/:tripId — Submit proof of delivery ────────────

router.post(
  "/api/delivery-proof/:tripId",
  authMiddleware,
  requireRole("DRIVER", "ADMIN", "DISPATCH", "SUPER_ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tripId = parseInt(String(req.params.tripId), 10);
      if (isNaN(tripId)) {
        return res.status(400).json({ message: "Invalid trip ID" });
      }

      const { proofType, signatureData, photoUrl, gpsLat, gpsLng, gpsAccuracy, idVerified, recipientName, notes } = req.body;

      if (!proofType || !VALID_PROOF_TYPES.includes(proofType)) {
        return res.status(400).json({ message: `proofType must be one of: ${VALID_PROOF_TYPES.join(", ")}` });
      }

      // Verify trip exists and belongs to tenant
      const [trip] = await db
        .select({ id: trips.id, companyId: trips.companyId, driverId: trips.driverId })
        .from(trips)
        .where(eq(trips.id, tripId))
        .limit(1);

      if (!trip) {
        return res.status(404).json({ message: "Trip not found" });
      }

      const driverId = req.user?.driverId ?? trip.driverId;
      if (!driverId) {
        return res.status(400).json({ message: "No driver associated with this request" });
      }

      const proof = await createProofOfDelivery(tripId, proofType as ProofType, {
        driverId,
        companyId: trip.companyId,
        signatureData,
        photoUrl,
        gpsLat,
        gpsLng,
        gpsAccuracy,
        idVerified,
        recipientName,
        notes,
      });

      return res.status(201).json({ ok: true, proof });
    } catch (err: any) {
      console.error(`[DELIVERY-PROOF] POST /api/delivery-proof/:tripId error: ${err.message}`);
      return res.status(500).json({ message: err.message || "Failed to submit delivery proof" });
    }
  },
);

// ─── GET /api/delivery-proof/:tripId — Get proofs for a trip ────────────────

router.get(
  "/api/delivery-proof/:tripId",
  authMiddleware,
  requireRole("DRIVER", "ADMIN", "DISPATCH", "SUPER_ADMIN", "COMPANY_ADMIN", "VIEWER"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tripId = parseInt(String(req.params.tripId), 10);
      if (isNaN(tripId)) {
        return res.status(400).json({ message: "Invalid trip ID" });
      }

      const proofs = await getProofOfDelivery(tripId);
      const validation = await validateDeliveryProof(tripId);

      return res.json({ ok: true, proofs, validation });
    } catch (err: any) {
      console.error(`[DELIVERY-PROOF] GET /api/delivery-proof/:tripId error: ${err.message}`);
      return res.status(500).json({ message: "Failed to get delivery proofs" });
    }
  },
);

// ─── POST /api/delivery-proof/pharmacy/:orderId — Submit proof for pharmacy ─

router.post(
  "/api/delivery-proof/pharmacy/:orderId",
  authMiddleware,
  requireRole("DRIVER", "ADMIN", "DISPATCH", "SUPER_ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const orderId = parseInt(String(req.params.orderId), 10);
      if (isNaN(orderId)) {
        return res.status(400).json({ message: "Invalid order ID" });
      }

      const { proofType, signatureData, photoUrl, gpsLat, gpsLng, gpsAccuracy, idVerified, recipientName, notes } = req.body;

      if (!proofType || !VALID_PROOF_TYPES.includes(proofType)) {
        return res.status(400).json({ message: `proofType must be one of: ${VALID_PROOF_TYPES.join(", ")}` });
      }

      // Verify pharmacy order exists and get associated trip
      const [order] = await db
        .select({
          id: pharmacyOrders.id,
          tripId: pharmacyOrders.tripId,
          companyId: pharmacyOrders.companyId,
          driverId: pharmacyOrders.driverId,
        })
        .from(pharmacyOrders)
        .where(eq(pharmacyOrders.id, orderId))
        .limit(1);

      if (!order) {
        return res.status(404).json({ message: "Pharmacy order not found" });
      }

      if (!order.tripId) {
        return res.status(400).json({ message: "Pharmacy order has no associated trip" });
      }

      const driverId = req.user?.driverId ?? order.driverId;
      if (!driverId) {
        return res.status(400).json({ message: "No driver associated with this request" });
      }

      const proof = await createProofOfDelivery(order.tripId, proofType as ProofType, {
        driverId,
        companyId: order.companyId,
        signatureData,
        photoUrl,
        gpsLat,
        gpsLng,
        gpsAccuracy,
        idVerified,
        recipientName,
        notes,
      }, orderId);

      return res.status(201).json({ ok: true, proof });
    } catch (err: any) {
      console.error(`[DELIVERY-PROOF] POST /api/delivery-proof/pharmacy/:orderId error: ${err.message}`);
      return res.status(500).json({ message: err.message || "Failed to submit pharmacy delivery proof" });
    }
  },
);

// ─── GET /api/delivery-proof/pharmacy/:orderId — Get proofs for pharmacy order

router.get(
  "/api/delivery-proof/pharmacy/:orderId",
  authMiddleware,
  requireRole("DRIVER", "ADMIN", "DISPATCH", "SUPER_ADMIN", "COMPANY_ADMIN", "PHARMACY_ADMIN", "PHARMACY_USER"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const orderId = parseInt(String(req.params.orderId), 10);
      if (isNaN(orderId)) {
        return res.status(400).json({ message: "Invalid order ID" });
      }

      const proofs = await getPharmacyOrderProofs(orderId);

      return res.json({ ok: true, proofs });
    } catch (err: any) {
      console.error(`[DELIVERY-PROOF] GET /api/delivery-proof/pharmacy/:orderId error: ${err.message}`);
      return res.status(500).json({ message: "Failed to get pharmacy delivery proofs" });
    }
  },
);

export function registerDeliveryProofRoutes(app: Express) {
  app.use(router);
}
