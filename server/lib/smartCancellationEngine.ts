import { db } from "../db";
import {
  trips,
  recurringSchedules,
  tripSeries,
  recurringCancellationPolicies,
  recurringHolds,
  recurringCancellationLog,
} from "@shared/schema";
import { eq, and, gte, lte, isNull, inArray, not, sql } from "drizzle-orm";

// ── Cancel a single occurrence ──────────────────────────────────────────

export async function cancelSingleOccurrence(
  tripId: number,
  reason: string,
  userId: number
): Promise<{ ok: boolean; tripId: number }> {
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), isNull(trips.deletedAt)))
    .limit(1);

  if (!trip) throw new Error("Trip not found");
  if (trip.status === "CANCELLED" || trip.status === "COMPLETED") {
    throw new Error(`Trip is already ${trip.status}`);
  }

  await db
    .update(trips)
    .set({
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledBy: userId,
      cancelledReason: reason,
      cancelType: "soft",
    })
    .where(eq(trips.id, tripId));

  await db.insert(recurringCancellationLog).values({
    tripId,
    patientId: trip.patientId,
    companyId: trip.companyId,
    scheduleId: null,
    tripSeriesId: trip.tripSeriesId,
    cancellationType: "single",
    reason,
    cancelledBy: userId,
    affectedDates: [trip.scheduledDate],
  });

  return { ok: true, tripId };
}

// ── Cancel future occurrences from a given trip onward ──────────────────

export async function cancelFutureOccurrences(
  tripId: number,
  reason: string,
  userId: number
): Promise<{ ok: boolean; cancelledCount: number; affectedDates: string[] }> {
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), isNull(trips.deletedAt)))
    .limit(1);

  if (!trip) throw new Error("Trip not found");

  // Find all future trips in the same series or matching the same recurring pattern
  const conditions = [
    gte(trips.scheduledDate, trip.scheduledDate),
    eq(trips.patientId, trip.patientId),
    eq(trips.companyId, trip.companyId),
    not(inArray(trips.status, ["CANCELLED", "COMPLETED"])),
    isNull(trips.deletedAt),
  ];

  if (trip.tripSeriesId) {
    conditions.push(eq(trips.tripSeriesId, trip.tripSeriesId));
  } else {
    // Match by recurring trip type and same patient
    conditions.push(eq(trips.tripType, "recurring"));
  }

  const futureTrips = await db
    .select({ id: trips.id, scheduledDate: trips.scheduledDate })
    .from(trips)
    .where(and(...conditions));

  if (futureTrips.length === 0) {
    return { ok: true, cancelledCount: 0, affectedDates: [] };
  }

  const futureIds = futureTrips.map((t) => t.id);
  const affectedDates = futureTrips.map((t) => t.scheduledDate);

  await db
    .update(trips)
    .set({
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledBy: userId,
      cancelledReason: reason,
      cancelType: "soft",
    })
    .where(inArray(trips.id, futureIds));

  // If there's a recurring schedule, deactivate it
  if (trip.tripSeriesId) {
    await db
      .update(tripSeries)
      .set({ active: false })
      .where(eq(tripSeries.id, trip.tripSeriesId));
  }

  await db.insert(recurringCancellationLog).values({
    tripId,
    patientId: trip.patientId,
    companyId: trip.companyId,
    scheduleId: null,
    tripSeriesId: trip.tripSeriesId,
    cancellationType: "future",
    reason,
    cancelledBy: userId,
    affectedDates,
  });

  return { ok: true, cancelledCount: futureIds.length, affectedDates };
}

// ── Cancel an entire series ─────────────────────────────────────────────

export async function cancelEntireSeries(
  seriesId: number,
  reason: string,
  userId: number
): Promise<{ ok: boolean; cancelledCount: number; affectedDates: string[] }> {
  const [series] = await db
    .select()
    .from(tripSeries)
    .where(eq(tripSeries.id, seriesId))
    .limit(1);

  if (!series) throw new Error("Trip series not found");

  const seriesTrips = await db
    .select({ id: trips.id, scheduledDate: trips.scheduledDate })
    .from(trips)
    .where(
      and(
        eq(trips.tripSeriesId, seriesId),
        not(inArray(trips.status, ["CANCELLED", "COMPLETED"])),
        isNull(trips.deletedAt)
      )
    );

  const tripIds = seriesTrips.map((t) => t.id);
  const affectedDates = seriesTrips.map((t) => t.scheduledDate);

  if (tripIds.length > 0) {
    await db
      .update(trips)
      .set({
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancelledReason: reason,
        cancelType: "hard",
      })
      .where(inArray(trips.id, tripIds));
  }

  // Deactivate the series
  await db
    .update(tripSeries)
    .set({ active: false })
    .where(eq(tripSeries.id, seriesId));

  await db.insert(recurringCancellationLog).values({
    tripId: null,
    patientId: series.patientId,
    companyId: series.cityId, // series doesn't have companyId directly, log will rely on trip data
    scheduleId: null,
    tripSeriesId: seriesId,
    cancellationType: "series",
    reason,
    cancelledBy: userId,
    affectedDates,
  });

  return { ok: true, cancelledCount: tripIds.length, affectedDates };
}

// ── Hold (pause) a recurring schedule ───────────────────────────────────

export async function holdSchedule(
  scheduleId: number,
  startDate: string,
  endDate: string,
  reason: string,
  userId: number
): Promise<{ ok: boolean; holdId: number; cancelledCount: number }> {
  const [schedule] = await db
    .select()
    .from(recurringSchedules)
    .where(eq(recurringSchedules.id, scheduleId))
    .limit(1);

  if (!schedule) throw new Error("Recurring schedule not found");

  // Cancel all trips in the hold window
  const heldTrips = await db
    .select({ id: trips.id, scheduledDate: trips.scheduledDate })
    .from(trips)
    .where(
      and(
        eq(trips.patientId, schedule.patientId),
        eq(trips.tripType, "recurring"),
        gte(trips.scheduledDate, startDate),
        lte(trips.scheduledDate, endDate),
        not(inArray(trips.status, ["CANCELLED", "COMPLETED"])),
        isNull(trips.deletedAt)
      )
    );

  const heldTripIds = heldTrips.map((t) => t.id);
  const affectedDates = heldTrips.map((t) => t.scheduledDate);

  if (heldTripIds.length > 0) {
    await db
      .update(trips)
      .set({
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancelledReason: `Hold: ${reason || "Temporary hold"}`,
        cancelType: "soft",
      })
      .where(inArray(trips.id, heldTripIds));
  }

  const [hold] = await db
    .insert(recurringHolds)
    .values({
      scheduleId,
      patientId: schedule.patientId,
      companyId: schedule.cityId, // Using cityId as proxy; adjust if schedule has companyId
      holdStartDate: startDate,
      holdEndDate: endDate,
      reason,
      createdBy: userId,
      status: "active",
    })
    .returning({ id: recurringHolds.id });

  await db.insert(recurringCancellationLog).values({
    scheduleId,
    tripId: null,
    patientId: schedule.patientId,
    companyId: schedule.cityId,
    tripSeriesId: null,
    cancellationType: "hold",
    reason,
    cancelledBy: userId,
    affectedDates,
  });

  return { ok: true, holdId: hold.id, cancelledCount: heldTripIds.length };
}

// ── Resume a held schedule ──────────────────────────────────────────────

export async function resumeSchedule(
  holdId: number,
  userId: number
): Promise<{ ok: boolean }> {
  const [hold] = await db
    .select()
    .from(recurringHolds)
    .where(and(eq(recurringHolds.id, holdId), eq(recurringHolds.status, "active")))
    .limit(1);

  if (!hold) throw new Error("Active hold not found");

  await db
    .update(recurringHolds)
    .set({ status: "ended" })
    .where(eq(recurringHolds.id, holdId));

  // Re-activate the recurring schedule if it was deactivated
  if (hold.scheduleId) {
    await db
      .update(recurringSchedules)
      .set({ active: true })
      .where(eq(recurringSchedules.id, hold.scheduleId));
  }

  return { ok: true };
}

// ── Check cancellation policy limits ────────────────────────────────────

export async function checkCancellationPolicy(
  patientId: number,
  companyId: number
): Promise<{
  allowed: boolean;
  weekCount: number;
  monthCount: number;
  maxPerWeek: number;
  maxPerMonth: number;
}> {
  // Get policy for company (or use defaults)
  const [policy] = await db
    .select()
    .from(recurringCancellationPolicies)
    .where(eq(recurringCancellationPolicies.companyId, companyId))
    .limit(1);

  const maxPerWeek = policy?.maxCancellationsPerWeek ?? 2;
  const maxPerMonth = policy?.maxCancellationsPerMonth ?? 6;

  // Count cancellations in the current week (Mon-Sun)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() + mondayOffset);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const weekCancels = await db
    .select({ count: sql<number>`count(*)` })
    .from(recurringCancellationLog)
    .where(
      and(
        eq(recurringCancellationLog.patientId, patientId),
        eq(recurringCancellationLog.companyId, companyId),
        gte(recurringCancellationLog.createdAt, new Date(weekStartStr))
      )
    );

  const monthCancels = await db
    .select({ count: sql<number>`count(*)` })
    .from(recurringCancellationLog)
    .where(
      and(
        eq(recurringCancellationLog.patientId, patientId),
        eq(recurringCancellationLog.companyId, companyId),
        gte(recurringCancellationLog.createdAt, new Date(monthStartStr))
      )
    );

  const weekCount = Number(weekCancels[0]?.count ?? 0);
  const monthCount = Number(monthCancels[0]?.count ?? 0);

  const allowed = weekCount < maxPerWeek && monthCount < maxPerMonth;

  return { allowed, weekCount, monthCount, maxPerWeek, maxPerMonth };
}

// ── Auto-suspend check for no-shows ─────────────────────────────────────

export async function autoSuspendCheck(
  patientId: number,
  companyId: number
): Promise<{ suspended: boolean; noShowCount: number; threshold: number }> {
  const [policy] = await db
    .select()
    .from(recurringCancellationPolicies)
    .where(eq(recurringCancellationPolicies.companyId, companyId))
    .limit(1);

  const threshold = policy?.noShowAutoSuspendCount ?? 3;
  const suspendDays = policy?.noShowAutoSuspendDays ?? 7;

  // Count recent no-shows (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const noShows = await db
    .select({ count: sql<number>`count(*)` })
    .from(trips)
    .where(
      and(
        eq(trips.patientId, patientId),
        eq(trips.companyId, companyId),
        eq(trips.status, "NO_SHOW"),
        gte(trips.cancelledAt, thirtyDaysAgo),
        isNull(trips.deletedAt)
      )
    );

  const noShowCount = Number(noShows[0]?.count ?? 0);

  if (noShowCount >= threshold) {
    // Auto-suspend: deactivate all recurring schedules for this patient
    const schedules = await db
      .select({ id: recurringSchedules.id })
      .from(recurringSchedules)
      .where(
        and(
          eq(recurringSchedules.patientId, patientId),
          eq(recurringSchedules.active, true)
        )
      );

    if (schedules.length > 0) {
      const scheduleIds = schedules.map((s) => s.id);
      await db
        .update(recurringSchedules)
        .set({ active: false })
        .where(inArray(recurringSchedules.id, scheduleIds));

      // Create holds for the suspended period
      const holdEnd = new Date();
      holdEnd.setDate(holdEnd.getDate() + suspendDays);
      const holdEndStr = holdEnd.toISOString().slice(0, 10);
      const todayStr = new Date().toISOString().slice(0, 10);

      for (const sched of schedules) {
        await db.insert(recurringHolds).values({
          scheduleId: sched.id,
          patientId,
          companyId,
          holdStartDate: todayStr,
          holdEndDate: holdEndStr,
          reason: `Auto-suspended: ${noShowCount} no-shows in last 30 days`,
          status: "active",
        });
      }
    }

    return { suspended: true, noShowCount, threshold };
  }

  return { suspended: false, noShowCount, threshold };
}

// ── Get cancellation history for a patient ──────────────────────────────

export async function getCancellationHistory(
  patientId: number
): Promise<{
  logs: Array<{
    id: number;
    cancellationType: string;
    reason: string | null;
    affectedDates: string[] | null;
    createdAt: Date | null;
  }>;
  holds: Array<{
    id: number;
    holdStartDate: string;
    holdEndDate: string;
    reason: string | null;
    status: string;
    createdAt: Date | null;
  }>;
}> {
  const logs = await db
    .select({
      id: recurringCancellationLog.id,
      cancellationType: recurringCancellationLog.cancellationType,
      reason: recurringCancellationLog.reason,
      affectedDates: recurringCancellationLog.affectedDates,
      createdAt: recurringCancellationLog.createdAt,
    })
    .from(recurringCancellationLog)
    .where(eq(recurringCancellationLog.patientId, patientId))
    .orderBy(sql`${recurringCancellationLog.createdAt} desc`)
    .limit(50);

  const holds = await db
    .select({
      id: recurringHolds.id,
      holdStartDate: recurringHolds.holdStartDate,
      holdEndDate: recurringHolds.holdEndDate,
      reason: recurringHolds.reason,
      status: recurringHolds.status,
      createdAt: recurringHolds.createdAt,
    })
    .from(recurringHolds)
    .where(eq(recurringHolds.patientId, patientId))
    .orderBy(sql`${recurringHolds.createdAt} desc`)
    .limit(50);

  return { logs, holds };
}
