import { db } from "../db";
import {
  interCityTransfers,
  trips,
  patients,
  drivers,
  cities,
  type InterCityTransfer,
} from "@shared/schema";
import { eq, and, sql, desc, or, inArray } from "drizzle-orm";

const VALID_STATUSES = [
  "requested",
  "planning",
  "driver_assigned",
  "in_transit",
  "at_transfer",
  "completed",
  "cancelled",
] as const;

type TransferStatus = (typeof VALID_STATUSES)[number];

interface CreateTransferData {
  companyId: number;
  originCityId: number;
  destinationCityId: number;
  patientId: number;
  requestedDate: string;
  requestedTime: string;
  pickupAddress: string;
  dropoffAddress: string;
  transferPointAddress?: string;
  transferPointLat?: number;
  transferPointLng?: number;
  estimatedDistanceMiles?: number;
  estimatedDurationMinutes?: number;
  coordinatorUserId?: number;
  notes?: string;
}

interface TransferFilters {
  status?: string;
  originCityId?: number;
  destinationCityId?: number;
  patientId?: number;
  from?: string;
  to?: string;
}

/**
 * Create an inter-city transfer request with auto-created outbound and return trips.
 */
export async function createTransferRequest(
  data: CreateTransferData
): Promise<InterCityTransfer> {
  const {
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
    coordinatorUserId,
    notes,
  } = data;

  if (originCityId === destinationCityId) {
    throw new Error("Origin and destination cities must be different for an inter-city transfer");
  }

  // Verify patient exists
  const [patient] = await db
    .select()
    .from(patients)
    .where(and(eq(patients.id, patientId), eq(patients.companyId, companyId)))
    .limit(1);
  if (!patient) {
    throw new Error("Patient not found or does not belong to this company");
  }

  // Verify both cities exist
  const citiesList = await db
    .select()
    .from(cities)
    .where(inArray(cities.id, [originCityId, destinationCityId]));
  if (citiesList.length < 2) {
    throw new Error("One or both cities not found");
  }

  const transferPoint = transferPointAddress || "TBD — midpoint to be determined";

  // Generate public IDs for trips
  const outboundPublicId = `T-${Date.now().toString(36).toUpperCase()}O`;
  const returnPublicId = `T-${Date.now().toString(36).toUpperCase()}R`;

  // Create outbound trip (origin city → transfer point)
  const [outboundTrip] = await db
    .insert(trips)
    .values({
      publicId: outboundPublicId,
      cityId: originCityId,
      patientId,
      pickupAddress,
      dropoffAddress: transferPoint,
      scheduledDate: requestedDate,
      pickupTime: requestedTime,
      estimatedArrivalTime: "TBD",
      status: "SCHEDULED",
      companyId,
      notes: `Inter-city transfer outbound leg. ${notes || ""}`.trim(),
    })
    .returning();

  // Create return trip (transfer point → destination)
  const [returnTrip] = await db
    .insert(trips)
    .values({
      publicId: returnPublicId,
      cityId: destinationCityId,
      patientId,
      pickupAddress: transferPoint,
      dropoffAddress,
      scheduledDate: requestedDate,
      pickupTime: "TBD",
      estimatedArrivalTime: "TBD",
      status: "SCHEDULED",
      companyId,
      notes: `Inter-city transfer return leg. ${notes || ""}`.trim(),
    })
    .returning();

  // Create the transfer record
  const [transfer] = await db
    .insert(interCityTransfers)
    .values({
      companyId,
      originCityId,
      destinationCityId,
      outboundTripId: outboundTrip.id,
      returnTripId: returnTrip.id,
      patientId,
      requestedDate,
      requestedTime,
      estimatedDistanceMiles: estimatedDistanceMiles?.toString() ?? null,
      estimatedDurationMinutes: estimatedDurationMinutes ?? null,
      transferPointAddress: transferPointAddress ?? null,
      transferPointLat: transferPointLat ?? null,
      transferPointLng: transferPointLng ?? null,
      status: "requested",
      coordinatorUserId: coordinatorUserId ?? null,
      notes: notes ?? null,
    })
    .returning();

  return transfer;
}

/**
 * Suggest a midpoint transfer location between two cities.
 * Uses the geographic midpoint of the two cities' first available drivers or a simple midpoint calculation.
 */
export async function findTransferPoint(
  originCityId: number,
  destinationCityId: number
): Promise<{
  address: string;
  lat: number | null;
  lng: number | null;
  description: string;
}> {
  // Try to find drivers in each city with known positions to estimate midpoint
  const [originDriver] = await db
    .select({ lat: drivers.lastLat, lng: drivers.lastLng })
    .from(drivers)
    .where(
      and(
        eq(drivers.cityId, originCityId),
        eq(drivers.status, "ACTIVE"),
        sql`${drivers.lastLat} IS NOT NULL`
      )
    )
    .limit(1);

  const [destDriver] = await db
    .select({ lat: drivers.lastLat, lng: drivers.lastLng })
    .from(drivers)
    .where(
      and(
        eq(drivers.cityId, destinationCityId),
        eq(drivers.status, "ACTIVE"),
        sql`${drivers.lastLat} IS NOT NULL`
      )
    )
    .limit(1);

  const [originCity] = await db
    .select()
    .from(cities)
    .where(eq(cities.id, originCityId))
    .limit(1);
  const [destCity] = await db
    .select()
    .from(cities)
    .where(eq(cities.id, destinationCityId))
    .limit(1);

  if (originDriver?.lat && originDriver?.lng && destDriver?.lat && destDriver?.lng) {
    const midLat = (originDriver.lat + destDriver.lat) / 2;
    const midLng = (originDriver.lng + destDriver.lng) / 2;
    return {
      address: `Midpoint between ${originCity?.name || "Origin"} and ${destCity?.name || "Destination"}`,
      lat: midLat,
      lng: midLng,
      description: `Suggested midpoint based on active driver positions (${midLat.toFixed(4)}, ${midLng.toFixed(4)})`,
    };
  }

  return {
    address: `Transfer point between ${originCity?.name || "Origin"} and ${destCity?.name || "Destination"} — please specify manually`,
    lat: null,
    lng: null,
    description:
      "Unable to calculate midpoint automatically. No driver GPS data available for one or both cities.",
  };
}

/**
 * Assign drivers from both cities to a transfer.
 */
export async function assignDrivers(
  transferId: number,
  originDriverId: number,
  destinationDriverId: number
): Promise<InterCityTransfer> {
  const [transfer] = await db
    .select()
    .from(interCityTransfers)
    .where(eq(interCityTransfers.id, transferId))
    .limit(1);

  if (!transfer) {
    throw new Error("Transfer not found");
  }

  if (transfer.status === "cancelled" || transfer.status === "completed") {
    throw new Error(`Cannot assign drivers to a ${transfer.status} transfer`);
  }

  // Verify origin driver belongs to origin city
  const [origDriver] = await db
    .select()
    .from(drivers)
    .where(
      and(
        eq(drivers.id, originDriverId),
        eq(drivers.cityId, transfer.originCityId),
        eq(drivers.companyId, transfer.companyId)
      )
    )
    .limit(1);
  if (!origDriver) {
    throw new Error("Origin driver not found or does not belong to the origin city");
  }

  // Verify destination driver belongs to destination city
  const [destDriver] = await db
    .select()
    .from(drivers)
    .where(
      and(
        eq(drivers.id, destinationDriverId),
        eq(drivers.cityId, transfer.destinationCityId),
        eq(drivers.companyId, transfer.companyId)
      )
    )
    .limit(1);
  if (!destDriver) {
    throw new Error("Destination driver not found or does not belong to the destination city");
  }

  // Update transfer
  const [updated] = await db
    .update(interCityTransfers)
    .set({
      originDriverId,
      destinationDriverId,
      status: "driver_assigned",
      updatedAt: new Date(),
    })
    .where(eq(interCityTransfers.id, transferId))
    .returning();

  // Assign drivers to their respective trips
  if (transfer.outboundTripId) {
    await db
      .update(trips)
      .set({ driverId: originDriverId, status: "ASSIGNED", assignedAt: new Date() })
      .where(eq(trips.id, transfer.outboundTripId));
  }
  if (transfer.returnTripId) {
    await db
      .update(trips)
      .set({ driverId: destinationDriverId, status: "ASSIGNED", assignedAt: new Date() })
      .where(eq(trips.id, transfer.returnTripId));
  }

  return updated;
}

/**
 * Handle driver handoff at transfer point — transitions transfer status.
 */
export async function handleDriverHandoff(
  transferId: number
): Promise<InterCityTransfer> {
  const [transfer] = await db
    .select()
    .from(interCityTransfers)
    .where(eq(interCityTransfers.id, transferId))
    .limit(1);

  if (!transfer) {
    throw new Error("Transfer not found");
  }

  // Determine next status based on current
  let nextStatus: TransferStatus;
  switch (transfer.status) {
    case "driver_assigned":
      nextStatus = "in_transit";
      break;
    case "in_transit":
      nextStatus = "at_transfer";
      break;
    case "at_transfer":
      nextStatus = "completed";
      break;
    default:
      throw new Error(
        `Cannot advance handoff from status '${transfer.status}'. Expected driver_assigned, in_transit, or at_transfer.`
      );
  }

  const [updated] = await db
    .update(interCityTransfers)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(interCityTransfers.id, transferId))
    .returning();

  return updated;
}

/**
 * Get transfer status with full details including both trip statuses.
 */
export async function getTransferStatus(transferId: number): Promise<{
  transfer: InterCityTransfer;
  outboundTrip: any | null;
  returnTrip: any | null;
  patient: any | null;
  originCity: any | null;
  destinationCity: any | null;
  originDriver: any | null;
  destinationDriver: any | null;
}> {
  const [transfer] = await db
    .select()
    .from(interCityTransfers)
    .where(eq(interCityTransfers.id, transferId))
    .limit(1);

  if (!transfer) {
    throw new Error("Transfer not found");
  }

  const [outboundTrip] = transfer.outboundTripId
    ? await db.select().from(trips).where(eq(trips.id, transfer.outboundTripId)).limit(1)
    : [null];

  const [returnTrip] = transfer.returnTripId
    ? await db.select().from(trips).where(eq(trips.id, transfer.returnTripId)).limit(1)
    : [null];

  const [patient] = await db
    .select({ id: patients.id, firstName: patients.firstName, lastName: patients.lastName, phone: patients.phone })
    .from(patients)
    .where(eq(patients.id, transfer.patientId))
    .limit(1);

  const [originCity] = await db
    .select({ id: cities.id, name: cities.name, state: cities.state })
    .from(cities)
    .where(eq(cities.id, transfer.originCityId))
    .limit(1);

  const [destinationCity] = await db
    .select({ id: cities.id, name: cities.name, state: cities.state })
    .from(cities)
    .where(eq(cities.id, transfer.destinationCityId))
    .limit(1);

  const originDriver = transfer.originDriverId
    ? (
        await db
          .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName, phone: drivers.phone })
          .from(drivers)
          .where(eq(drivers.id, transfer.originDriverId))
          .limit(1)
      )[0] || null
    : null;

  const destinationDriver = transfer.destinationDriverId
    ? (
        await db
          .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName, phone: drivers.phone })
          .from(drivers)
          .where(eq(drivers.id, transfer.destinationDriverId))
          .limit(1)
      )[0] || null
    : null;

  return {
    transfer,
    outboundTrip,
    returnTrip,
    patient: patient || null,
    originCity: originCity || null,
    destinationCity: destinationCity || null,
    originDriver,
    destinationDriver,
  };
}

/**
 * Cancel an inter-city transfer and handle both trips.
 */
export async function cancelTransfer(
  transferId: number,
  reason: string,
  userId: number
): Promise<InterCityTransfer> {
  const [transfer] = await db
    .select()
    .from(interCityTransfers)
    .where(eq(interCityTransfers.id, transferId))
    .limit(1);

  if (!transfer) {
    throw new Error("Transfer not found");
  }

  if (transfer.status === "completed") {
    throw new Error("Cannot cancel a completed transfer");
  }
  if (transfer.status === "cancelled") {
    throw new Error("Transfer is already cancelled");
  }

  // Cancel both trips
  const now = new Date();
  if (transfer.outboundTripId) {
    await db
      .update(trips)
      .set({
        status: "CANCELLED",
        cancelledBy: userId,
        cancelledReason: `Inter-city transfer cancelled: ${reason}`,
        cancelledAt: now,
        updatedAt: now,
      })
      .where(eq(trips.id, transfer.outboundTripId));
  }
  if (transfer.returnTripId) {
    await db
      .update(trips)
      .set({
        status: "CANCELLED",
        cancelledBy: userId,
        cancelledReason: `Inter-city transfer cancelled: ${reason}`,
        cancelledAt: now,
        updatedAt: now,
      })
      .where(eq(trips.id, transfer.returnTripId));
  }

  const [updated] = await db
    .update(interCityTransfers)
    .set({
      status: "cancelled",
      notes: transfer.notes
        ? `${transfer.notes}\n[Cancelled] ${reason}`
        : `[Cancelled] ${reason}`,
      updatedAt: now,
    })
    .where(eq(interCityTransfers.id, transferId))
    .returning();

  return updated;
}

/**
 * List transfers for a company with optional filters.
 */
export async function listTransfers(
  companyId: number,
  filters: TransferFilters = {}
): Promise<InterCityTransfer[]> {
  const conditions: any[] = [eq(interCityTransfers.companyId, companyId)];

  if (filters.status) {
    conditions.push(eq(interCityTransfers.status, filters.status));
  }
  if (filters.originCityId) {
    conditions.push(eq(interCityTransfers.originCityId, filters.originCityId));
  }
  if (filters.destinationCityId) {
    conditions.push(eq(interCityTransfers.destinationCityId, filters.destinationCityId));
  }
  if (filters.patientId) {
    conditions.push(eq(interCityTransfers.patientId, filters.patientId));
  }
  if (filters.from) {
    conditions.push(sql`${interCityTransfers.requestedDate} >= ${filters.from}`);
  }
  if (filters.to) {
    conditions.push(sql`${interCityTransfers.requestedDate} <= ${filters.to}`);
  }

  return db
    .select()
    .from(interCityTransfers)
    .where(and(...conditions))
    .orderBy(desc(interCityTransfers.createdAt));
}
