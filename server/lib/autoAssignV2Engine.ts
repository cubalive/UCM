import { db } from "../db";
import { trips, drivers, companies, patients, autoAssignRuns, autoAssignRunCandidates, automationEvents, isVehicleCompatible } from "@shared/schema";
import { eq, and, inArray, isNull, sql, ne, gte, lte } from "drizzle-orm";
import { checkTripFeasibility } from "./tripFeasibility";
import { getPreferenceScore } from "./driverPreferenceLearning";

const COOLDOWN_MAP = new Map<number, number>();
const COOLDOWN_MS = 30_000;

interface ScoredCandidate {
  driverId: number;
  driverName: string;
  distanceMeters: number;
  distanceScore: number;
  reliabilityScore: number;
  loadScore: number;
  fatigueScore: number;
  finalScore: number;
  rank: number;
  eligible: boolean;
  ineligibleReason: string | null;
}

interface CompanyConfig {
  offerTimeoutSeconds: number;
  maxRounds: number;
  maxDistanceMeters: number;
  weightDistance: number;
  weightReliability: number;
  weightLoad: number;
  weightFatigue: number;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getCompanyConfig(companyId: number): Promise<CompanyConfig | null> {
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return null;
  return {
    offerTimeoutSeconds: company.autoAssignOfferTimeoutSeconds,
    maxRounds: company.autoAssignMaxRounds,
    maxDistanceMeters: company.autoAssignMaxDistanceMeters,
    weightDistance: company.autoAssignWeightDistance,
    weightReliability: company.autoAssignWeightReliability,
    weightLoad: company.autoAssignWeightLoad,
    weightFatigue: company.autoAssignWeightFatigue,
  };
}

async function getDriverOnTimeRate(driverId: number): Promise<number> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
      COUNT(*) FILTER (WHERE status = 'NO_SHOW' OR status = 'CANCELLED') as missed
    FROM trips
    WHERE driver_id = ${driverId}
    AND scheduled_date >= (CURRENT_DATE - INTERVAL '30 days')::text
    AND status IN ('COMPLETED', 'NO_SHOW', 'CANCELLED')
  `);
  const row = (result as any).rows?.[0] || (result as any)[0];
  const completed = Number(row?.completed || 0);
  const missed = Number(row?.missed || 0);
  const total = completed + missed;
  return total > 0 ? completed / total : 0.8;
}

async function getDriverActiveTrips(driverId: number, scheduledDate: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) as cnt FROM trips
    WHERE driver_id = ${driverId}
    AND scheduled_date = ${scheduledDate}
    AND status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
    AND deleted_at IS NULL
  `);
  const row = (result as any).rows?.[0] || (result as any)[0];
  return Number(row?.cnt || 0);
}

async function getDriverHoursWorkedToday(driverId: number): Promise<number> {
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(
        EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at)) / 3600
      ), 0) as hours
    FROM trips
    WHERE driver_id = ${driverId}
    AND scheduled_date = CURRENT_DATE::text
    AND started_at IS NOT NULL
    AND status IN ('COMPLETED', 'IN_PROGRESS', 'EN_ROUTE_TO_DROPOFF', 'ARRIVED_DROPOFF')
    AND deleted_at IS NULL
  `);
  const row = (result as any).rows?.[0] || (result as any)[0];
  return Number(row?.hours || 0);
}

async function getClinicAffinityScore(driverId: number, clinicId: number | null): Promise<number> {
  if (!clinicId) return 0;
  try {
    const result = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
        COUNT(*) FILTER (WHERE status = 'COMPLETED' AND arrived_pickup_at IS NOT NULL AND picked_up_at IS NOT NULL
          AND EXTRACT(EPOCH FROM (picked_up_at - arrived_pickup_at)) < 600) as on_time
      FROM trips
      WHERE driver_id = ${driverId} AND clinic_id = ${clinicId}
      AND scheduled_date >= (CURRENT_DATE - INTERVAL '60 days')::text
      AND deleted_at IS NULL
    `);
    const row = (result as any).rows?.[0] || (result as any)[0];
    const completed = Number(row?.completed || 0);
    if (completed < 3) return 0;
    const onTime = Number(row?.on_time || 0);
    return onTime / completed;
  } catch {
    return 0;
  }
}

async function getPatientPreferredDriverId(patientId: number): Promise<number | null> {
  try {
    const [patient] = await db.select({ isFrequent: patients.isFrequent, preferredDriverId: patients.preferredDriverId })
      .from(patients).where(eq(patients.id, patientId)).limit(1);
    if (patient?.isFrequent && patient.preferredDriverId) return patient.preferredDriverId;
    return null;
  } catch {
    return null;
  }
}

export async function scoreDriversForTrip(
  tripId: number,
  config: CompanyConfig
): Promise<ScoredCandidate[]> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip || !trip.pickupLat || !trip.pickupLng) return [];

  const patientPreferredDriverId = await getPatientPreferredDriverId(trip.patientId);
  const tripPreferredDriverId = trip.preferredDriverId || null;

  const companyDrivers = await db.select().from(drivers).where(
    and(
      eq(drivers.companyId, trip.companyId),
      eq(drivers.cityId, trip.cityId),
      eq(drivers.active, true),
      ne(drivers.dispatchStatus, "off"),
      isNull(drivers.deletedAt)
    )
  );

  const now = Date.now();
  const GPS_STALE_SECONDS = 300;
  const MAX_TRIPS_PER_DAY = 12;
  const SHIFT_LIMIT_HOURS = 10;
  const totalWeight = config.weightDistance + config.weightReliability + config.weightLoad + config.weightFatigue || 100;

  const candidates: ScoredCandidate[] = [];

  for (const driver of companyDrivers) {
    let eligible = true;
    let ineligibleReason: string | null = null;

    if (!driver.lastLat || !driver.lastLng) {
      const isPreferred = driver.id === patientPreferredDriverId || driver.id === tripPreferredDriverId;
      if (!isPreferred) {
        eligible = false;
        ineligibleReason = "No GPS location";
      }
    }

    const gpsAge = driver.lastSeenAt ? (now - driver.lastSeenAt.getTime()) / 1000 : Infinity;
    if (eligible && gpsAge > GPS_STALE_SECONDS) {
      const isPreferred = driver.id === patientPreferredDriverId || driver.id === tripPreferredDriverId;
      if (!isPreferred || gpsAge > 3600) {
        eligible = false;
        ineligibleReason = `GPS stale (${Math.round(gpsAge)}s ago)`;
      }
    }

    if (eligible && !isVehicleCompatible(trip.mobilityRequirement, driver.vehicleCapability)) {
      eligible = false;
      ineligibleReason = `Vehicle incompatible (${driver.vehicleCapability} vs ${trip.mobilityRequirement})`;
    }

    if (eligible && driver.preferredServiceTypes && driver.preferredServiceTypes.length > 0) {
      if (!driver.preferredServiceTypes.includes(trip.mobilityRequirement)) {
        const isPreferred = driver.id === patientPreferredDriverId || driver.id === tripPreferredDriverId;
        if (!isPreferred) {
          eligible = false;
          ineligibleReason = `Service type mismatch (driver: ${driver.preferredServiceTypes.join(",")} vs trip: ${trip.mobilityRequirement})`;
        }
      }
    }

    const distanceM = (driver.lastLat && driver.lastLng)
      ? haversineMeters(Number(trip.pickupLat), Number(trip.pickupLng), driver.lastLat, driver.lastLng)
      : Infinity;

    if (eligible && distanceM !== Infinity && distanceM > config.maxDistanceMeters) {
      const isPreferred = driver.id === patientPreferredDriverId || driver.id === tripPreferredDriverId;
      if (!isPreferred) {
        eligible = false;
        ineligibleReason = `Too far (${Math.round(distanceM)}m > ${config.maxDistanceMeters}m)`;
      }
    }

    if (eligible) {
      const feasibility = await checkTripFeasibility(driver.id, trip);
      if (!feasibility.feasible) {
        eligible = false;
        ineligibleReason = feasibility.reason || "Time conflict with existing trip";
      }
    }

    const activeTrips = eligible ? await getDriverActiveTrips(driver.id, trip.scheduledDate) : 0;
    const distanceScore = eligible ? (distanceM !== Infinity ? Math.max(0, 1 - (distanceM / config.maxDistanceMeters)) : 0.3) : 0;
    const reliabilityRate = eligible ? await getDriverOnTimeRate(driver.id) : 0;
    const loadScore = eligible ? Math.max(0, 1 - (activeTrips / MAX_TRIPS_PER_DAY)) : 0;
    const hoursWorked = eligible ? await getDriverHoursWorkedToday(driver.id) : 0;
    const fatigueScore = eligible ? Math.max(0, 1 - (hoursWorked / SHIFT_LIMIT_HOURS)) : 0;
    const clinicAffinity = eligible ? await getClinicAffinityScore(driver.id, trip.clinicId) : 0;
    const preferenceScore = eligible ? await getPreferenceScore(driver.id, {
      pickupTime: trip.pickupTime,
      pickupLat: Number(trip.pickupLat),
      pickupLng: Number(trip.pickupLng),
      pickupZip: trip.pickupZip,
      mobilityRequirement: trip.mobilityRequirement,
      routeDistanceMeters: trip.routeDistanceMeters,
    }) : 0;

    let preferredBonus = 0;
    if (eligible && driver.id === patientPreferredDriverId) preferredBonus = 1000;
    else if (eligible && driver.id === tripPreferredDriverId) preferredBonus = 500;

    const baseScore = eligible
      ? (
        (config.weightDistance / totalWeight) * distanceScore +
        (config.weightReliability / totalWeight) * reliabilityRate +
        (config.weightLoad / totalWeight) * loadScore +
        (config.weightFatigue / totalWeight) * fatigueScore
      ) * 100
      : 0;

    const clinicAffinityBonus = clinicAffinity * 200;
    const preferenceBonus = preferenceScore * 100;
    const trackingPenalty = (driver.trackingStatus !== "OK" && driver.trackingStatus !== "UNKNOWN") ? -50 : 0;

    const finalScore = baseScore + preferredBonus + clinicAffinityBonus + preferenceBonus + trackingPenalty;

    candidates.push({
      driverId: driver.id,
      driverName: `${driver.firstName} ${driver.lastName}`,
      distanceMeters: distanceM === Infinity ? 999999 : Math.round(distanceM),
      distanceScore: Math.round(distanceScore * 100) / 100,
      reliabilityScore: Math.round(reliabilityRate * 100) / 100,
      loadScore: Math.round(loadScore * 100) / 100,
      fatigueScore: Math.round(fatigueScore * 100) / 100,
      finalScore: Math.round(finalScore * 100) / 100,
      rank: 0,
      eligible,
      ineligibleReason,
    });
  }

  candidates
    .sort((a, b) => b.finalScore - a.finalScore)
    .forEach((c, i) => { c.rank = i + 1; });

  return candidates;
}

export async function runAutoAssignForTrip(tripId: number, actorUserId?: number): Promise<{
  success: boolean;
  runId: number;
  selectedDriverId?: number;
  reason: string;
  candidates: ScoredCandidate[];
}> {
  const lastRun = COOLDOWN_MAP.get(tripId);
  if (lastRun && Date.now() - lastRun < COOLDOWN_MS) {
    return { success: false, runId: 0, reason: "Cooldown active (30s)", candidates: [] };
  }
  COOLDOWN_MAP.set(tripId, Date.now());

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip) return { success: false, runId: 0, reason: "Trip not found", candidates: [] };

  const config = await getCompanyConfig(trip.companyId);
  if (!config) return { success: false, runId: 0, reason: "Company not found", candidates: [] };

  await db.update(trips).set({
    autoAssignStatus: "RUNNING",
    autoAssignLastRunAt: new Date(),
    autoAssignFailureReason: null,
  } as any).where(eq(trips.id, tripId));

  const [run] = await db.insert(autoAssignRuns).values({
    tripId,
    companyId: trip.companyId,
    cityId: trip.cityId,
    round: 1,
    result: "RUNNING",
    configSnapshot: config as any,
  }).returning();

  await db.insert(automationEvents).values({
    eventType: "AUTO_ASSIGN_ATTEMPT",
    tripId,
    companyId: trip.companyId,
    runId: run.id,
    actorUserId: actorUserId || null,
    payload: { config, tripPublicId: trip.publicId },
  });

  const candidates = await scoreDriversForTrip(tripId, config);

  if (candidates.length > 0) {
    await db.insert(autoAssignRunCandidates).values(
      candidates.map(c => ({
        runId: run.id,
        driverId: c.driverId,
        distanceMeters: c.distanceMeters === Infinity ? null : c.distanceMeters,
        distanceScore: c.distanceScore,
        reliabilityScore: c.reliabilityScore,
        loadScore: c.loadScore,
        fatigueScore: c.fatigueScore,
        finalScore: c.finalScore,
        rank: c.rank,
        eligible: c.eligible,
        ineligibleReason: c.ineligibleReason,
      }))
    );
  }

  const eligibleCandidates = candidates.filter(c => c.eligible);

  if (eligibleCandidates.length === 0) {
    await db.update(autoAssignRuns).set({
      result: "FAILED",
      endedAt: new Date(),
      reason: "No eligible drivers found",
    }).where(eq(autoAssignRuns.id, run.id));

    await db.update(trips).set({
      autoAssignStatus: "FAILED",
      autoAssignFailureReason: "No eligible drivers found",
      autoAssignRunId: run.id,
    } as any).where(eq(trips.id, tripId));

    await db.insert(automationEvents).values({
      eventType: "AUTO_ASSIGN_FAIL",
      tripId,
      companyId: trip.companyId,
      runId: run.id,
      payload: { reason: "No eligible drivers found", candidateCount: candidates.length },
    });

    return { success: false, runId: run.id, reason: "No eligible drivers found", candidates };
  }

  const bestCandidate = eligibleCandidates[0];

  const patientPreferred = await getPatientPreferredDriverId(trip.patientId);
  let assignReason = "scored_best";
  if (bestCandidate.driverId === patientPreferred) {
    assignReason = "preferred_driver";
  } else if (bestCandidate.driverId === trip.preferredDriverId) {
    assignReason = "trip_preferred_driver";
  } else if (bestCandidate.finalScore >= 200) {
    assignReason = "high_clinic_affinity";
  }

  await db.update(autoAssignRunCandidates).set({
    offeredAt: new Date(),
    response: "ACCEPTED",
    respondedAt: new Date(),
  }).where(
    and(
      eq(autoAssignRunCandidates.runId, run.id),
      eq(autoAssignRunCandidates.driverId, bestCandidate.driverId)
    )
  );

  const updateData: any = {
    driverId: bestCandidate.driverId,
    status: "ASSIGNED",
    assignedAt: new Date(),
    assignmentSource: "auto_assign_v2",
    assignmentReason: `Score: ${bestCandidate.finalScore} (dist=${bestCandidate.distanceScore}, rel=${bestCandidate.reliabilityScore}, load=${bestCandidate.loadScore}, fat=${bestCandidate.fatigueScore})`,
    autoAssignStatus: "SUCCESS",
    autoAssignReason: assignReason,
    autoAssignSelectedDriverId: bestCandidate.driverId,
    autoAssignRunId: run.id,
    autoAssignFailureReason: null,
  };

  // Optimistic locking: only update if the trip status is still eligible for assignment.
  // This prevents two concurrent auto-assign operations from overwriting each other.
  const previousStatus = trip.status;
  const assignableStatuses = ["SCHEDULED", "PENDING"];
  if (!assignableStatuses.includes(previousStatus)) {
    await db.update(autoAssignRuns).set({
      result: "FAILED",
      endedAt: new Date(),
      reason: `Trip status changed to ${previousStatus} before assignment`,
    }).where(eq(autoAssignRuns.id, run.id));

    return { success: false, runId: run.id, reason: `Trip status is ${previousStatus}, not assignable`, candidates };
  }

  const updated = await db.update(trips).set(updateData)
    .where(and(eq(trips.id, tripId), eq(trips.status, previousStatus)))
    .returning();

  if (!updated.length) {
    // Concurrent update detected — another process already changed the trip status
    await db.update(autoAssignRuns).set({
      result: "FAILED",
      endedAt: new Date(),
      reason: "Concurrent update detected — trip status changed during assignment",
    }).where(eq(autoAssignRuns.id, run.id));

    await db.insert(automationEvents).values({
      eventType: "AUTO_ASSIGN_FAIL",
      tripId,
      companyId: trip.companyId,
      runId: run.id,
      payload: { reason: "Concurrent update detected", previousStatus },
    });

    return { success: false, runId: run.id, reason: "Concurrent update detected — trip was modified by another process", candidates };
  }

  await db.update(autoAssignRuns).set({
    result: "SUCCESS",
    endedAt: new Date(),
    selectedDriverId: bestCandidate.driverId,
    reason: `Assigned to ${bestCandidate.driverName} (score: ${bestCandidate.finalScore})`,
  }).where(eq(autoAssignRuns.id, run.id));

  await db.insert(automationEvents).values({
    eventType: "AUTO_ASSIGN_SUCCESS",
    tripId,
    driverId: bestCandidate.driverId,
    companyId: trip.companyId,
    runId: run.id,
    payload: {
      selectedDriver: bestCandidate.driverName,
      score: bestCandidate.finalScore,
      candidatesEvaluated: candidates.length,
      eligibleCount: eligibleCandidates.length,
    },
  });

  return {
    success: true,
    runId: run.id,
    selectedDriverId: bestCandidate.driverId,
    reason: `Assigned to ${bestCandidate.driverName} (score: ${bestCandidate.finalScore})`,
    candidates,
  };
}

export async function getAutoAssignRunDetails(runId: number) {
  const [run] = await db.select().from(autoAssignRuns).where(eq(autoAssignRuns.id, runId));
  if (!run) return null;

  const candidateRows = await db.select().from(autoAssignRunCandidates)
    .where(eq(autoAssignRunCandidates.runId, runId))
    .orderBy(autoAssignRunCandidates.rank);

  const driverIds = candidateRows.map(c => c.driverId);
  const driverMap = new Map<number, { firstName: string; lastName: string }>();
  if (driverIds.length > 0) {
    const driverRows = await db.select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
    }).from(drivers).where(inArray(drivers.id, driverIds));
    driverRows.forEach(d => driverMap.set(d.id, d));
  }

  return {
    ...run,
    candidates: candidateRows.map(c => ({
      ...c,
      driverName: driverMap.get(c.driverId)
        ? `${driverMap.get(c.driverId)!.firstName} ${driverMap.get(c.driverId)!.lastName}`
        : `Driver #${c.driverId}`,
    })),
  };
}

export async function getAutoAssignHistory(tripId: number) {
  return db.select().from(autoAssignRuns)
    .where(eq(autoAssignRuns.tripId, tripId))
    .orderBy(sql`${autoAssignRuns.createdAt} DESC`);
}

export async function getAutomationEventsForTrip(tripId: number) {
  return db.select().from(automationEvents)
    .where(eq(automationEvents.tripId, tripId))
    .orderBy(sql`${automationEvents.createdAt} DESC`);
}

export async function getAutomationEventsByType(
  eventType: string,
  companyId?: number,
  limit = 50
) {
  const conditions = [eq(automationEvents.eventType, eventType)];
  if (companyId) conditions.push(eq(automationEvents.companyId, companyId));

  return db.select().from(automationEvents)
    .where(and(...conditions))
    .orderBy(sql`${automationEvents.createdAt} DESC`)
    .limit(limit);
}

const ASSIGN_LOCKS = new Set<number>();

export async function assignTripAutomatically(
  tripId: number,
  source: string = "approve_flow",
  actorUserId?: number,
): Promise<{ success: boolean; reason: string; driverId?: number }> {
  if (ASSIGN_LOCKS.has(tripId)) {
    return { success: false, reason: "Assignment already in progress" };
  }
  ASSIGN_LOCKS.add(tripId);
  try {
    const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
    if (!trip) return { success: false, reason: "Trip not found" };

    if (trip.driverId) return { success: true, reason: "Already assigned", driverId: trip.driverId };
    if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(trip.status)) {
      return { success: false, reason: "Trip is in terminal status" };
    }

    const [company] = await db.select().from(companies).where(eq(companies.id, trip.companyId));
    if (!company?.autoAssignV2Enabled) {
      await db.update(trips).set({
        autoAssignStatus: "IDLE",
        autoAssignReason: "auto_assign_disabled",
      } as any).where(eq(trips.id, tripId));
      return { success: false, reason: "Auto-assign not enabled for company" };
    }

    await db.update(trips).set({
      autoAssignStatus: "PENDING",
      assignmentSource: source,
    } as any).where(eq(trips.id, tripId));

    const result = await runAutoAssignForTrip(tripId, actorUserId);

    if (result.success && result.selectedDriverId) {
      try {
        const { computeEtaAndDispatchWindow } = await import("./dispatchWindowEngine");
        await computeEtaAndDispatchWindow(tripId);
      } catch (err: any) {
        console.warn(`[AUTO-ASSIGN] ETA/dispatch computation failed for trip ${tripId}:`, err.message);
      }

      console.log(JSON.stringify({
        event: "auto_assign_immediate",
        tripId,
        source,
        driverId: result.selectedDriverId,
        reason: result.reason,
        runId: result.runId,
      }));

      // Attempt auto-accept for high-rated drivers
      try {
        const { attemptAutoAccept } = await import("./driverAutoAcceptEngine");
        const autoAcceptResult = await attemptAutoAccept(tripId, result.selectedDriverId);
        if (autoAcceptResult.autoAccepted) {
          console.log(JSON.stringify({
            event: "auto_accept_applied",
            tripId,
            driverId: result.selectedDriverId,
            reason: autoAcceptResult.reason,
          }));
        }
      } catch (aaErr: any) {
        console.warn(`[AUTO-ASSIGN] Auto-accept check failed for trip ${tripId}:`, aaErr.message);
      }
    } else {
      console.log(JSON.stringify({
        event: "auto_assign_failed",
        tripId,
        source,
        reason: result.reason,
        runId: result.runId,
      }));

      try {
        const { broadcastToTrip } = await import("./realtime");
        broadcastToTrip(tripId, {
          type: "status_change" as const,
          data: {
            event: "auto_assign_failed",
            tripId,
            reason: result.reason,
          },
        });
      } catch {}
    }

    return {
      success: result.success,
      reason: result.reason,
      driverId: result.selectedDriverId,
    };
  } catch (err: any) {
    console.error(`[AUTO-ASSIGN] Error for trip ${tripId}:`, err.message);
    await db.update(trips).set({
      autoAssignStatus: "FAILED",
      autoAssignFailureReason: err.message,
    } as any).where(eq(trips.id, tripId));
    return { success: false, reason: err.message };
  } finally {
    ASSIGN_LOCKS.delete(tripId);
  }
}

const RETRY_INTERVAL_MS = 5 * 60_000;
const MAX_RETRY_AGE_HOURS = 24;
let retryTask: (() => Promise<void>) | null = null;

async function runAutoAssignRetry() {
  const cutoff = new Date(Date.now() - MAX_RETRY_AGE_HOURS * 3600_000);
  const unassigned = await db
    .select({ id: trips.id, companyId: trips.companyId })
    .from(trips)
    .where(
      and(
        isNull(trips.driverId),
        eq(trips.approvalStatus, "approved"),
        inArray(trips.status, ["SCHEDULED"]),
        gte(trips.scheduledDate, cutoff.toISOString().split("T")[0]),
        inArray(trips.autoAssignStatus, ["FAILED", "PENDING"]),
      )
    )
    .limit(20);

  if (unassigned.length === 0) return;

  let retried = 0;
  let assigned = 0;
  for (const trip of unassigned) {
    if (COOLDOWN_MAP.has(trip.id) && Date.now() - (COOLDOWN_MAP.get(trip.id) || 0) < COOLDOWN_MS * 3) continue;

    try {
      const result = await assignTripAutomatically(trip.id, "retry_scheduler");
      retried++;
      if (result.success) assigned++;
    } catch {}
  }

  if (retried > 0) {
    console.log(JSON.stringify({ event: "auto_assign_retry_cycle", retried, assigned }));
  }
}

export function startAutoAssignRetryScheduler() {
  const { createHarnessedTask, registerInterval } = require("./schedulerHarness");

  if (retryTask) return;

  retryTask = createHarnessedTask({
    name: "auto_assign_retry",
    lockKey: "scheduler:lock:auto_assign_retry",
    lockTtlSeconds: 60,
    timeoutMs: 240_000,
    fn: runAutoAssignRetry,
  });

  registerInterval("auto_assign_retry", RETRY_INTERVAL_MS, retryTask);
  console.log("[AUTO-ASSIGN] Retry scheduler started (interval: 5min)");
}
