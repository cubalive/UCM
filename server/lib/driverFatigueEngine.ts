/**
 * Driver Fatigue Monitoring Engine
 *
 * Tracks consecutive driving hours, total hours in shift, and flags
 * drivers approaching regulatory limits. Returns fatigue risk levels
 * for dispatch safety decisions.
 */

import { db } from "../db";
import { trips, drivers } from "@shared/schema";
import { eq, and, gte, isNull, sql, ne } from "drizzle-orm";
import { cache } from "./cache";

// ─── Types ───────────────────────────────────────────────────────────────────

type FatigueRisk = "low" | "medium" | "high";

export interface DriverFatigueStatus {
  driverId: number;
  driverName: string;
  /** Total hours worked today */
  totalHoursToday: number;
  /** Consecutive hours without significant break */
  consecutiveHours: number;
  /** Number of trips completed today */
  tripsToday: number;
  /** Active trip count right now */
  activeTrips: number;
  /** Shift start time (first trip today) */
  shiftStartTime: string | null;
  /** Fatigue risk level */
  riskLevel: FatigueRisk;
  /** Risk explanation */
  riskReason: string;
  /** Time remaining before hitting limit (in hours) */
  hoursRemaining: number;
  /** Whether driver should be blocked from new assignments */
  shouldBlock: boolean;
}

export interface FatigueAlertSummary {
  companyId: number;
  cityId: number;
  date: string;
  alerts: DriverFatigueStatus[];
  stats: {
    totalDriversChecked: number;
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    blocked: number;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SHIFT_LIMIT_HOURS = 8;
const MAX_HOURS = 10;
const CONSECUTIVE_LIMIT_HOURS = 6;
const MEDIUM_THRESHOLD_HOURS = 6;
const HIGH_THRESHOLD_HOURS = 8;
const CACHE_TTL = 120; // 2 minutes

// ─── Single Driver Fatigue Check ─────────────────────────────────────────────

/**
 * Compute fatigue status for a single driver.
 */
export async function getDriverFatigueStatus(driverId: number): Promise<DriverFatigueStatus> {
  const cacheKey = `fatigue:driver:${driverId}`;
  const cached = cache.get<DriverFatigueStatus>(cacheKey);
  if (cached) return cached;

  const [driver] = await db
    .select({
      id: drivers.id,
      firstName: drivers.firstName,
      lastName: drivers.lastName,
    })
    .from(drivers)
    .where(eq(drivers.id, driverId))
    .limit(1);

  if (!driver) {
    return {
      driverId,
      driverName: `Driver #${driverId}`,
      totalHoursToday: 0,
      consecutiveHours: 0,
      tripsToday: 0,
      activeTrips: 0,
      shiftStartTime: null,
      riskLevel: "low",
      riskReason: "Driver not found",
      hoursRemaining: MAX_HOURS,
      shouldBlock: false,
    };
  }

  const today = new Date().toISOString().slice(0, 10);

  // Get today's trips for this driver (ordered by time)
  const todayTrips = await db
    .select({
      id: trips.id,
      status: trips.status,
      startedAt: trips.startedAt,
      completedAt: trips.completedAt,
      pickupTime: trips.pickupTime,
      actualDurationSeconds: trips.actualDurationSeconds,
    })
    .from(trips)
    .where(
      and(
        eq(trips.driverId, driverId),
        eq(trips.scheduledDate, today),
        isNull(trips.deletedAt)
      )
    )
    .orderBy(trips.pickupTime);

  // Calculate total hours worked
  let totalSeconds = 0;
  let shiftStart: Date | null = null;
  let lastEndTime: Date | null = null;
  let consecutiveSeconds = 0;
  let lastBreakAt: Date | null = null;

  const completedTrips = todayTrips.filter(t =>
    t.status === "COMPLETED" || t.startedAt
  );
  const activeTrips = todayTrips.filter(t =>
    ["EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"].includes(t.status)
  );

  for (const t of completedTrips) {
    if (!t.startedAt) continue;

    const start = new Date(t.startedAt);
    const end = t.completedAt ? new Date(t.completedAt) : new Date();
    const durationSec = t.actualDurationSeconds || (end.getTime() - start.getTime()) / 1000;

    if (!shiftStart || start < shiftStart) {
      shiftStart = start;
    }

    totalSeconds += durationSec;

    // Track consecutive hours (break = > 30 min gap between trips)
    if (lastEndTime) {
      const gapMinutes = (start.getTime() - lastEndTime.getTime()) / 60000;
      if (gapMinutes > 30) {
        // Significant break - reset consecutive counter
        consecutiveSeconds = durationSec;
        lastBreakAt = start;
      } else {
        consecutiveSeconds += durationSec;
      }
    } else {
      consecutiveSeconds = durationSec;
    }

    lastEndTime = end;
  }

  // Include active trips in working time
  for (const t of activeTrips) {
    if (t.startedAt) {
      const start = new Date(t.startedAt);
      const activeSeconds = (Date.now() - start.getTime()) / 1000;
      totalSeconds += activeSeconds;
      consecutiveSeconds += activeSeconds;

      if (!shiftStart || start < shiftStart) {
        shiftStart = start;
      }
    }
  }

  const totalHours = totalSeconds / 3600;
  const consecutiveHours = consecutiveSeconds / 3600;
  const hoursRemaining = Math.max(0, MAX_HOURS - totalHours);

  // Determine risk level
  let riskLevel: FatigueRisk = "low";
  let riskReason = "Within normal limits";
  let shouldBlock = false;

  if (totalHours >= MAX_HOURS) {
    riskLevel = "high";
    riskReason = `Exceeded maximum ${MAX_HOURS}h limit (${totalHours.toFixed(1)}h worked)`;
    shouldBlock = true;
  } else if (totalHours >= HIGH_THRESHOLD_HOURS || consecutiveHours >= CONSECUTIVE_LIMIT_HOURS) {
    riskLevel = "high";
    if (consecutiveHours >= CONSECUTIVE_LIMIT_HOURS) {
      riskReason = `${consecutiveHours.toFixed(1)}h consecutive driving without significant break`;
    } else {
      riskReason = `Approaching ${MAX_HOURS}h limit (${totalHours.toFixed(1)}h worked, ${hoursRemaining.toFixed(1)}h remaining)`;
    }
    shouldBlock = totalHours >= MAX_HOURS;
  } else if (totalHours >= MEDIUM_THRESHOLD_HOURS) {
    riskLevel = "medium";
    riskReason = `${totalHours.toFixed(1)}h worked (${hoursRemaining.toFixed(1)}h remaining before limit)`;
  }

  const result: DriverFatigueStatus = {
    driverId,
    driverName: `${driver.firstName} ${driver.lastName}`,
    totalHoursToday: Math.round(totalHours * 10) / 10,
    consecutiveHours: Math.round(consecutiveHours * 10) / 10,
    tripsToday: completedTrips.length + activeTrips.length,
    activeTrips: activeTrips.length,
    shiftStartTime: shiftStart ? shiftStart.toISOString() : null,
    riskLevel,
    riskReason,
    hoursRemaining: Math.round(hoursRemaining * 10) / 10,
    shouldBlock,
  };

  cache.set(cacheKey, result, CACHE_TTL * 1000);
  return result;
}

// ─── Bulk Fatigue Alerts ─────────────────────────────────────────────────────

/**
 * Check all active drivers in a city for fatigue risks.
 */
export async function getFatigueAlerts(
  companyId: number,
  cityId: number
): Promise<FatigueAlertSummary> {
  const cacheKey = `fatigue:alerts:${companyId}:${cityId}`;
  const cached = cache.get<FatigueAlertSummary>(cacheKey);
  if (cached) return cached;

  const today = new Date().toISOString().slice(0, 10);

  // Get all active drivers in this city
  const activeDrivers = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(
      and(
        eq(drivers.companyId, companyId),
        eq(drivers.cityId, cityId),
        eq(drivers.status, "ACTIVE"),
        eq(drivers.active, true),
        isNull(drivers.deletedAt),
        ne(drivers.dispatchStatus, "off")
      )
    );

  const alerts: DriverFatigueStatus[] = [];
  let lowRisk = 0, mediumRisk = 0, highRisk = 0, blocked = 0;

  for (const driver of activeDrivers) {
    const status = await getDriverFatigueStatus(driver.id);

    // Only include drivers with some activity or risk
    if (status.totalHoursToday > 0 || status.activeTrips > 0) {
      alerts.push(status);
    }

    switch (status.riskLevel) {
      case "low": lowRisk++; break;
      case "medium": mediumRisk++; break;
      case "high": highRisk++; break;
    }
    if (status.shouldBlock) blocked++;
  }

  // Sort by risk level (high first) then by hours worked
  alerts.sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2 };
    const riskDiff = riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    if (riskDiff !== 0) return riskDiff;
    return b.totalHoursToday - a.totalHoursToday;
  });

  const result: FatigueAlertSummary = {
    companyId,
    cityId,
    date: today,
    alerts,
    stats: {
      totalDriversChecked: activeDrivers.length,
      lowRisk,
      mediumRisk,
      highRisk,
      blocked,
    },
  };

  cache.set(cacheKey, result, CACHE_TTL * 1000);
  return result;
}
