import { db } from "../db";
import { trips, drivers, vehicles, patients, assignmentBatches } from "@shared/schema";
import { eq, and, inArray, isNull, sql } from "drizzle-orm";

interface ProposedAssignment {
  tripId: number;
  tripPublicId: string;
  scheduledDate: string;
  pickupTime: string;
  pickupZip: string | null;
  tripType: string;
  patientId: number;
  patientName: string;
  wheelchairRequired: boolean;
  approvalStatus: string;
  currentStatus: string;
  proposedDriverId: number | null;
  proposedDriverName: string | null;
  proposedVehicleId: number | null;
  proposedVehicleName: string | null;
  assignmentReason: string;
  canAssign: boolean;
  blockReason: string | null;
}

interface AssignmentPlan {
  cityId: number;
  cityName: string;
  date: string;
  batchId: number;
  proposals: ProposedAssignment[];
  stats: {
    totalTrips: number;
    assignable: number;
    blocked: number;
    byZip: Record<string, number>;
    byType: Record<string, number>;
  };
}

const TRIP_TYPE_PRIORITY: Record<string, number> = {
  dialysis: 0,
  recurring: 1,
  one_time: 2,
};

function buildRecurringAffinityMap(
  priorTrips: any[],
  recurringPatientIds: Set<number>
): Map<number, number> {
  const driverCounts = new Map<number, Map<number, number>>();

  for (const t of priorTrips) {
    if (!t.patientId || !t.driverId) continue;
    if (!recurringPatientIds.has(t.patientId)) continue;
    if (!driverCounts.has(t.patientId)) {
      driverCounts.set(t.patientId, new Map());
    }
    const counts = driverCounts.get(t.patientId)!;
    counts.set(t.driverId, (counts.get(t.driverId) || 0) + 1);
  }

  const affinityMap = new Map<number, number>();
  for (const [patientId, counts] of driverCounts) {
    let bestDriverId = 0;
    let bestCount = 0;
    for (const [driverId, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestDriverId = driverId;
      }
    }
    if (bestDriverId > 0) {
      affinityMap.set(patientId, bestDriverId);
    }
  }

  return affinityMap;
}

function buildGeneralHistoryMap(priorTrips: any[]): Map<number, number> {
  const driverCounts = new Map<number, Map<number, number>>();

  for (const t of priorTrips) {
    if (!t.patientId || !t.driverId) continue;
    if (!driverCounts.has(t.patientId)) {
      driverCounts.set(t.patientId, new Map());
    }
    const counts = driverCounts.get(t.patientId)!;
    counts.set(t.driverId, (counts.get(t.driverId) || 0) + 1);
  }

  const historyMap = new Map<number, number>();
  for (const [patientId, counts] of driverCounts) {
    let bestDriverId = 0;
    let bestCount = 0;
    for (const [driverId, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestDriverId = driverId;
      }
    }
    if (bestDriverId > 0) {
      historyMap.set(patientId, bestDriverId);
    }
  }

  return historyMap;
}

function findRoundTripPairs(activeTrips: any[]): Map<number, number> {
  const pairMap = new Map<number, number>();

  for (const t of activeTrips) {
    if (t.parentTripId) {
      const parent = activeTrips.find(p => p.id === t.parentTripId);
      if (parent && parent.patientId === t.patientId) {
        pairMap.set(t.id, parent.id);
      }
    }
  }

  return pairMap;
}

export async function generateAssignmentPlan(
  cityId: number,
  date: string,
  createdBy?: number
): Promise<AssignmentPlan> {
  const cityRows = await db.select().from((await import("@shared/schema")).cities).where(eq((await import("@shared/schema")).cities.id, cityId));
  if (cityRows.length === 0) throw new Error(`City ${cityId} not found`);
  const city = cityRows[0];

  const eligibleTrips = await db.select().from(trips).where(
    and(
      eq(trips.cityId, cityId),
      eq(trips.scheduledDate, date),
      isNull(trips.deletedAt),
      inArray(trips.status, ["SCHEDULED", "ASSIGNED"]),
    )
  );

  const activeTrips = eligibleTrips.filter(t =>
    t.status === "SCHEDULED" || t.status === "ASSIGNED"
  );

  const roundTripChildToParent = findRoundTripPairs(activeTrips);

  const parentTripIds = new Set(roundTripChildToParent.values());
  const childTripIds = new Set(roundTripChildToParent.keys());

  activeTrips.sort((a, b) => {
    const aIsParent = parentTripIds.has(a.id) ? 0 : 1;
    const bIsParent = parentTripIds.has(b.id) ? 0 : 1;
    if (aIsParent !== bIsParent) return aIsParent - bIsParent;

    const aIsChild = childTripIds.has(a.id) ? 1 : 0;
    const bIsChild = childTripIds.has(b.id) ? 1 : 0;
    if (aIsChild !== bIsChild) return aIsChild - bIsChild;

    const pa = TRIP_TYPE_PRIORITY[a.tripType] ?? 2;
    const pb = TRIP_TYPE_PRIORITY[b.tripType] ?? 2;
    if (pa !== pb) return pa - pb;
    return (a.pickupTime || "").localeCompare(b.pickupTime || "");
  });

  const allDrivers = await db.select().from(drivers).where(
    and(
      eq(drivers.cityId, cityId),
      eq(drivers.status, "ACTIVE"),
      eq(drivers.active, true),
      isNull(drivers.deletedAt)
    )
  );

  const eligibleDrivers = allDrivers.filter(d => d.dispatchStatus !== "hold");
  const holdDriverIds = new Set(allDrivers.filter(d => d.dispatchStatus === "hold").map(d => d.id));

  const allVehicles = await db.select().from(vehicles).where(
    and(
      eq(vehicles.cityId, cityId),
      eq(vehicles.status, "ACTIVE"),
      eq(vehicles.active, true),
      isNull(vehicles.deletedAt)
    )
  );

  const allPatients = await db.select().from(patients).where(eq(patients.cityId, cityId));
  const patientMap = new Map(allPatients.map(p => [p.id, p]));

  const recurringPatientIds = new Set<number>();
  for (const t of activeTrips) {
    if (t.tripType === "recurring" || t.tripType === "dialysis") {
      recurringPatientIds.add(t.patientId);
    }
  }

  const priorAssignments = await db.select().from(trips).where(
    and(
      eq(trips.cityId, cityId),
      inArray(trips.status, ["COMPLETED", "IN_PROGRESS", "ASSIGNED"]),
      isNull(trips.deletedAt)
    )
  );

  const recurringAffinityMap = buildRecurringAffinityMap(priorAssignments, recurringPatientIds);
  const generalHistoryMap = buildGeneralHistoryMap(priorAssignments);

  const driverVehiclePairing = new Map<number, number>();
  for (const d of eligibleDrivers) {
    if (d.vehicleId) {
      driverVehiclePairing.set(d.id, d.vehicleId);
    }
  }

  const [batch] = await db.insert(assignmentBatches).values({
    cityId,
    date,
    status: "proposed",
    createdBy: createdBy ?? null,
    tripCount: activeTrips.length,
  }).returning();

  const driverLoadCount = new Map<number, number>();
  eligibleDrivers.forEach(d => driverLoadCount.set(d.id, 0));

  const vehicleUsed = new Set<number>();
  const driverUsed = new Set<number>();

  const proposals: ProposedAssignment[] = [];
  const byZip: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let assignable = 0;
  let blocked = 0;

  const tripAssignmentResults = new Map<number, { driverId: number; vehicleId: number | null }>();

  for (const trip of activeTrips) {
    const patient = patientMap.get(trip.patientId);
    const patientName = patient ? `${patient.firstName} ${patient.lastName}` : `Patient #${trip.patientId}`;
    const needsWheelchair = patient?.wheelchairRequired ?? false;
    const zipKey = trip.pickupZip || "unknown";
    byZip[zipKey] = (byZip[zipKey] || 0) + 1;
    byType[trip.tripType] = (byType[trip.tripType] || 0) + 1;

    const isRecurring = trip.tripType === "recurring" || trip.tripType === "dialysis";
    const isReturnLeg = roundTripChildToParent.has(trip.id);

    let canAssign = true;
    let blockReason: string | null = null;

    if (trip.approvalStatus !== "approved") {
      canAssign = false;
      blockReason = "Needs dispatch approval";
    }

    let bestDriverId: number | null = null;
    let bestVehicleId: number | null = null;
    let reason = "";

    if (canAssign) {
      if (isReturnLeg) {
        const parentId = roundTripChildToParent.get(trip.id)!;
        const parentResult = tripAssignmentResults.get(parentId);
        if (parentResult) {
          const pickupDriverAvailable = eligibleDrivers.some(d => d.id === parentResult.driverId) && !holdDriverIds.has(parentResult.driverId);
          if (pickupDriverAvailable) {
            bestDriverId = parentResult.driverId;
            bestVehicleId = parentResult.vehicleId;
            reason = "Round-trip pairing (same driver for pickup & return)";
          }
        }
      }

      if (!bestDriverId && isRecurring) {
        const affinityDriverId = recurringAffinityMap.get(trip.patientId);
        if (affinityDriverId && eligibleDrivers.some(d => d.id === affinityDriverId) && !holdDriverIds.has(affinityDriverId)) {
          bestDriverId = affinityDriverId;
          reason = "Recurring patient-driver affinity (same driver for continuity)";
        }
      }

      if (!bestDriverId) {
        const historyDriverId = generalHistoryMap.get(trip.patientId);
        if (historyDriverId && eligibleDrivers.some(d => d.id === historyDriverId) && !holdDriverIds.has(historyDriverId)) {
          bestDriverId = historyDriverId;
          reason = "Patient-driver history match (same driver prioritized)";
        }
      }

      if (!bestDriverId) {
        let minLoad = Infinity;
        for (const d of eligibleDrivers) {
          const load = driverLoadCount.get(d.id) || 0;
          if (load < minLoad) {
            minLoad = load;
            bestDriverId = d.id;
            reason = "Round-robin balanced assignment";
          }
        }
      }

      if (bestDriverId && !bestVehicleId) {
        const pairedVehicleId = driverVehiclePairing.get(bestDriverId);
        if (pairedVehicleId) {
          const pairedVehicle = allVehicles.find(v => v.id === pairedVehicleId);
          if (pairedVehicle && pairedVehicle.active) {
            if (needsWheelchair && !pairedVehicle.wheelchairAccessible) {
            } else {
              bestVehicleId = pairedVehicleId;
              reason += "; kept driver-vehicle pairing";
            }
          }
        }

        if (!bestVehicleId) {
          for (const v of allVehicles) {
            if (vehicleUsed.has(v.id)) continue;
            if (needsWheelchair && !v.wheelchairAccessible) continue;
            bestVehicleId = v.id;
            reason += "; vehicle matched by availability";
            break;
          }
        }

        if (needsWheelchair && bestVehicleId) {
          const selectedVehicle = allVehicles.find(v => v.id === bestVehicleId);
          if (selectedVehicle && !selectedVehicle.wheelchairAccessible) {
            bestVehicleId = null;
            reason = "No wheelchair-accessible vehicle available";
            canAssign = false;
            blockReason = "No wheelchair vehicle available";
          }
        }

        if (!bestVehicleId && canAssign) {
          for (const v of allVehicles) {
            if (needsWheelchair && !v.wheelchairAccessible) continue;
            bestVehicleId = v.id;
            reason += "; vehicle reused (shared)";
            break;
          }
        }
      }

      if (!bestDriverId) {
        canAssign = false;
        blockReason = "No eligible drivers available";
      }

      if (canAssign && bestDriverId) {
        driverLoadCount.set(bestDriverId, (driverLoadCount.get(bestDriverId) || 0) + 1);
        driverUsed.add(bestDriverId);
        if (bestVehicleId) vehicleUsed.add(bestVehicleId);
        tripAssignmentResults.set(trip.id, { driverId: bestDriverId, vehicleId: bestVehicleId });
        assignable++;
      } else {
        blocked++;
      }
    } else {
      blocked++;
    }

    const driverObj = bestDriverId ? eligibleDrivers.find(d => d.id === bestDriverId) || allDrivers.find(d => d.id === bestDriverId) : null;
    const vehicleObj = bestVehicleId ? allVehicles.find(v => v.id === bestVehicleId) : null;

    proposals.push({
      tripId: trip.id,
      tripPublicId: trip.publicId,
      scheduledDate: trip.scheduledDate,
      pickupTime: trip.pickupTime,
      pickupZip: trip.pickupZip,
      tripType: trip.tripType,
      patientId: trip.patientId,
      patientName,
      wheelchairRequired: needsWheelchair,
      approvalStatus: trip.approvalStatus,
      currentStatus: trip.status,
      proposedDriverId: canAssign ? bestDriverId : null,
      proposedDriverName: driverObj ? `${driverObj.firstName} ${driverObj.lastName}` : null,
      proposedVehicleId: canAssign ? bestVehicleId : null,
      proposedVehicleName: vehicleObj ? vehicleObj.name : null,
      assignmentReason: reason || blockReason || "",
      canAssign,
      blockReason,
    });
  }

  return {
    cityId,
    cityName: city.name,
    date,
    batchId: batch.id,
    proposals,
    stats: {
      totalTrips: activeTrips.length,
      assignable,
      blocked,
      byZip,
      byType,
    },
  };
}

export async function applyAssignmentBatch(batchId: number): Promise<{ applied: number }> {
  const [batch] = await db.select().from(assignmentBatches).where(eq(assignmentBatches.id, batchId));
  if (!batch) throw new Error("Batch not found");
  if (batch.status !== "proposed") throw new Error(`Batch is already ${batch.status}`);

  const batchTrips = await db.select().from(trips).where(
    and(
      eq(trips.assignmentBatchId, batchId),
      isNull(trips.deletedAt)
    )
  );

  let applied = 0;
  for (const t of batchTrips) {
    if (t.driverId && t.vehicleId && t.approvalStatus === "approved") {
      await db.update(trips).set({
        status: "ASSIGNED",
        assignmentSource: t.assignmentSource || "auto",
        updatedAt: new Date(),
      }).where(eq(trips.id, t.id));
      applied++;
    }
  }

  await db.update(assignmentBatches).set({ status: "applied" }).where(eq(assignmentBatches.id, batchId));

  return { applied };
}

export async function cancelAssignmentBatch(batchId: number): Promise<void> {
  const [batch] = await db.select().from(assignmentBatches).where(eq(assignmentBatches.id, batchId));
  if (!batch) throw new Error("Batch not found");
  if (batch.status !== "proposed") throw new Error(`Batch is already ${batch.status}`);

  await db.update(trips).set({
    driverId: null,
    vehicleId: null,
    assignmentBatchId: null,
    assignmentSource: null,
    assignmentReason: null,
    status: "SCHEDULED",
    updatedAt: new Date(),
  }).where(eq(trips.assignmentBatchId, batchId));

  await db.update(assignmentBatches).set({ status: "cancelled" }).where(eq(assignmentBatches.id, batchId));
}

export async function saveProposals(batchId: number, proposals: ProposedAssignment[]): Promise<void> {
  for (const p of proposals) {
    if (p.canAssign && p.proposedDriverId) {
      await db.update(trips).set({
        driverId: p.proposedDriverId,
        vehicleId: p.proposedVehicleId,
        assignmentBatchId: batchId,
        assignmentSource: "auto",
        assignmentReason: p.assignmentReason,
        updatedAt: new Date(),
      }).where(eq(trips.id, p.tripId));
    } else {
      await db.update(trips).set({
        assignmentBatchId: batchId,
        assignmentReason: p.blockReason || p.assignmentReason,
        updatedAt: new Date(),
      }).where(eq(trips.id, p.tripId));
    }
  }
}

export async function overrideTripAssignment(
  tripId: number,
  driverId: number | null,
  vehicleId: number | null,
  reason?: string
): Promise<void> {
  await db.update(trips).set({
    driverId,
    vehicleId,
    assignmentSource: "manual",
    assignmentReason: reason || "Manual override",
    updatedAt: new Date(),
  }).where(eq(trips.id, tripId));
}
