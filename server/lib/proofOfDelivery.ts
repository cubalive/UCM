import { db } from "../db";
import {
  deliveryProofs,
  trips,
  pharmacyOrders,
  type InsertDeliveryProof,
  type DeliveryProof,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";

export type ProofType = "SIGNATURE" | "PHOTO" | "GPS_VERIFICATION" | "ID_CHECK";

export interface ProofOfDeliveryData {
  proofType: ProofType;
  driverId: number;
  companyId: number;
  signatureData?: string;
  photoUrl?: string;
  gpsLat?: number;
  gpsLng?: number;
  gpsAccuracy?: number;
  idVerified?: boolean;
  recipientName?: string;
  notes?: string;
  collectedAt?: Date;
}

/**
 * Stores a proof-of-delivery record for a trip.
 */
export async function createProofOfDelivery(
  tripId: number,
  proofType: ProofType,
  data: Omit<ProofOfDeliveryData, "proofType">,
  pharmacyOrderId?: number | null,
): Promise<DeliveryProof> {
  // Validate the trip exists
  const [trip] = await db
    .select({ id: trips.id, companyId: trips.companyId })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);

  if (!trip) {
    throw new Error(`Trip ${tripId} not found`);
  }

  // If pharmacy order specified, validate it
  if (pharmacyOrderId) {
    const [order] = await db
      .select({ id: pharmacyOrders.id })
      .from(pharmacyOrders)
      .where(eq(pharmacyOrders.id, pharmacyOrderId))
      .limit(1);

    if (!order) {
      throw new Error(`Pharmacy order ${pharmacyOrderId} not found`);
    }
  }

  // Validate proof type has required data
  validateProofData(proofType, data);

  const insertData: Omit<InsertDeliveryProof, "id"> = {
    tripId,
    pharmacyOrderId: pharmacyOrderId ?? null,
    companyId: data.companyId,
    driverId: data.driverId,
    proofType,
    signatureData: data.signatureData ?? null,
    photoUrl: data.photoUrl ?? null,
    gpsLat: data.gpsLat ?? null,
    gpsLng: data.gpsLng ?? null,
    gpsAccuracy: data.gpsAccuracy ?? null,
    idVerified: data.idVerified ?? null,
    recipientName: data.recipientName ?? null,
    notes: data.notes ?? null,
    collectedAt: data.collectedAt ?? new Date(),
  };

  const [proof] = await db.insert(deliveryProofs).values(insertData).returning();
  console.log(`[POD] Created ${proofType} proof #${proof.id} for trip ${tripId}`);
  return proof;
}

/**
 * Retrieves all proof-of-delivery records for a trip.
 */
export async function getProofOfDelivery(tripId: number): Promise<DeliveryProof[]> {
  return db
    .select()
    .from(deliveryProofs)
    .where(eq(deliveryProofs.tripId, tripId))
    .orderBy(deliveryProofs.collectedAt);
}

/**
 * Retrieves proof-of-delivery records for a pharmacy order.
 */
export async function getPharmacyOrderProofs(orderId: number): Promise<DeliveryProof[]> {
  return db
    .select()
    .from(deliveryProofs)
    .where(eq(deliveryProofs.pharmacyOrderId, orderId))
    .orderBy(deliveryProofs.collectedAt);
}

/**
 * Validates that all required proof types have been collected for a trip.
 * Returns which proof types are present and which are missing from the required set.
 */
export async function validateDeliveryProof(
  tripId: number,
  requiredTypes: ProofType[] = ["SIGNATURE", "GPS_VERIFICATION"],
): Promise<{
  valid: boolean;
  collected: ProofType[];
  missing: ProofType[];
}> {
  const proofs = await getProofOfDelivery(tripId);
  const collectedTypes = [...new Set(proofs.map((p) => p.proofType as ProofType))];
  const missing = requiredTypes.filter((t) => !collectedTypes.includes(t));

  return {
    valid: missing.length === 0,
    collected: collectedTypes,
    missing,
  };
}

function validateProofData(proofType: ProofType, data: Omit<ProofOfDeliveryData, "proofType">): void {
  switch (proofType) {
    case "SIGNATURE":
      if (!data.signatureData) {
        throw new Error("Signature data (base64) is required for SIGNATURE proof type");
      }
      if (!data.recipientName) {
        throw new Error("Recipient name is required for SIGNATURE proof type");
      }
      break;
    case "PHOTO":
      if (!data.photoUrl) {
        throw new Error("Photo URL is required for PHOTO proof type");
      }
      break;
    case "GPS_VERIFICATION":
      if (data.gpsLat == null || data.gpsLng == null) {
        throw new Error("GPS coordinates are required for GPS_VERIFICATION proof type");
      }
      break;
    case "ID_CHECK":
      if (data.idVerified == null) {
        throw new Error("ID verification result is required for ID_CHECK proof type");
      }
      if (!data.recipientName) {
        throw new Error("Recipient name is required for ID_CHECK proof type");
      }
      break;
    default:
      throw new Error(`Unknown proof type: ${proofType}`);
  }
}
