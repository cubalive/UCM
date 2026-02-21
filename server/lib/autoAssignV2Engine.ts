import { db } from "../db";
import { trips, drivers, companies, autoAssignRuns, autoAssignRunCandidates, automationEvents } from "@shared/schema";
import { eq, and, inArray, isNull, sql, ne, gte, lte } from "drizzle-orm";

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

export async function scoreDriversForTrip(
  tripId: number,
  config: CompanyConfig
): Promise<ScoredCandidate[]> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip || !trip.pickupLat || !trip.pickupLng) return [];

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
  const GPS_STALE_SECONDS = 120;
  const MAX_TRIPS_PER_DAY = 12;
  const SHIFT_LIMIT_HOURS = 10;
  const totalWeight = config.weightDistance + config.weightReliability + config.weightLoad + config.weightFatigue || 100;

  const candidates: ScoredCandidate[] = [];

  for (const driver of companyDrivers) {
    let eligible = true;
    let ineligibleReason: string | null = null;

    if (!driver.lastLat || !driver.lastLng) {
      eligible = false;
      ineligibleReason = "No GPS location";
    }

    const gpsAge = driver.lastSeenAt ? (now - driver.lastSeenAt.getTime()) / 1000 : Infinity;
    if (eligible && gpsAge > GPS_STALE_SECONDS) {
      eligible = false;
      ineligibleReason = `GPS stale (${Math.round(gpsAge)}s ago)`;
    }

    const distanceM = (driver.lastLat && driver.lastLng)
      ? haversineMeters(Number(trip.pickupLat), Number(trip.pickupLng), driver.lastLat, driver.lastLng)
      : Infinity;

    if (eligible && distanceM > config.maxDistanceMeters) {
      eligible = false;
      ineligibleReason = `Too far (${Math.round(distanceM)}m > ${config.maxDistanceMeters}m)`;
    }

    const activeTrips = await getDriverActiveTrips(driver.id, trip.scheduledDate);
    if (eligible && activeTrips > 0) {
      const hasConflict = await db.execute(sql`
        SELECT 1 FROM trips
        WHERE driver_id = ${driver.id}
        AND scheduled_date = ${trip.scheduledDate}
        AND status NOT IN ('COMPLETED', 'CANCELLED', 'NO_SHOW')
        AND deleted_at IS NULL
        AND pickup_time = ${trip.pickupTime}
        LIMIT 1
      `);
      const conflictRows = (hasConflict as any).rows || hasConflict;
      if (Array.isArray(conflictRows) && conflictRows.length > 0) {
        eligible = false;
        ineligibleReason = "Conflicting trip at same time";
      }
    }

    const distanceScore = eligible ? Math.max(0, 1 - (distanceM / config.maxDistanceMeters)) : 0;
    const reliabilityRate = eligible ? await getDriverOnTimeRate(driver.id) : 0;
    const loadScore = eligible ? Math.max(0, 1 - (activeTrips / MAX_TRIPS_PER_DAY)) : 0;
    const hoursWorked = eligible ? await getDriverHoursWorkedToday(driver.id) : 0;
    const fatigueScore = eligible ? Math.max(0, 1 - (hoursWorked / SHIFT_LIMIT_HOURS)) : 0;

    const finalScore = eligible
      ? (
        (config.weightDistance / totalWeight) * distanceScore +
        (config.weightReliability / totalWeight) * reliabilityRate +
        (config.weightLoad / totalWeight) * loadScore +
        (config.weightFatigue / totalWeight) * fatigueScore
      ) * 100
      : 0;

    candidates.push({
      driverId: driver.id,
      driverName: `${driver.firstName} ${driver.lastName}`,
      distanceMeters: Math.round(distanceM),
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
    autoAssignSelectedDriverId: bestCandidate.driverId,
    autoAssignRunId: run.id,
    autoAssignFailureReason: null,
  };

  await db.update(trips).set(updateData).where(eq(trips.id, tripId));

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
