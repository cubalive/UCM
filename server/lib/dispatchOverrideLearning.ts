/**
 * Dispatch Override Learning System
 *
 * When dispatchers override auto-dispatch decisions, this engine records the
 * override, analyzes patterns over time, and applies learned preferences as
 * bonus scores in future assignments.
 *
 * Examples of patterns it can learn:
 * - "Dispatcher always prefers Spanish-speaking drivers for clinic X"
 * - "Dispatcher prefers driver Y for wheelchair patients"
 * - "Dispatcher overrides when suggested driver has high fatigue"
 */

import { db } from "../db";
import { trips, drivers, automationEvents } from "@shared/schema";
import { eq, and, gte, isNull, sql, desc } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OverrideRecord {
  tripId: number;
  suggestedDriverId: number;
  overrideDriverId: number;
  reason: string;
  timestamp: Date;
  outcome?: "better" | "same" | "worse"; // filled after trip completes
}

export interface OverridePattern {
  pattern: string;
  description: string;
  occurrences: number;
  lastSeen: string;
  confidence: number;         // 0-1: how strong the pattern is
  suggestedAction: string;
}

export interface DriverCandidate {
  driverId: number;
  finalScore: number;
  [key: string]: any;
}

// ─── Record an Override ───────────────────────────────────────────────────────

export async function recordOverride(record: OverrideRecord): Promise<void> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, record.tripId)).limit(1);
  if (!trip) throw new Error(`Trip ${record.tripId} not found`);

  const [[suggestedDriver], [overrideDriver]] = await Promise.all([
    db.select().from(drivers).where(eq(drivers.id, record.suggestedDriverId)).limit(1),
    db.select().from(drivers).where(eq(drivers.id, record.overrideDriverId)).limit(1),
  ]);

  // Store the override as an automation event with detailed payload
  await db.insert(automationEvents).values({
    eventType: "DISPATCH_OVERRIDE",
    tripId: record.tripId,
    companyId: trip.companyId,
    driverId: record.overrideDriverId,
    payload: {
      suggestedDriverId: record.suggestedDriverId,
      suggestedDriverName: suggestedDriver
        ? `${suggestedDriver.firstName} ${suggestedDriver.lastName}` : null,
      overrideDriverId: record.overrideDriverId,
      overrideDriverName: overrideDriver
        ? `${overrideDriver.firstName} ${overrideDriver.lastName}` : null,
      reason: record.reason,
      outcome: record.outcome || null,
      tripDetails: {
        patientId: trip.patientId,
        clinicId: trip.clinicId,
        mobilityRequirement: trip.mobilityRequirement,
        pickupZip: trip.pickupZip,
        pickupTime: trip.pickupTime,
        tripType: trip.tripType,
      },
      suggestedDriverDetails: suggestedDriver ? {
        vehicleCapability: suggestedDriver.vehicleCapability,
        preferredServiceTypes: suggestedDriver.preferredServiceTypes,
      } : null,
      overrideDriverDetails: overrideDriver ? {
        vehicleCapability: overrideDriver.vehicleCapability,
        preferredServiceTypes: overrideDriver.preferredServiceTypes,
      } : null,
    },
  });

  console.log(JSON.stringify({
    event: "dispatch_override_recorded",
    tripId: record.tripId,
    suggestedDriverId: record.suggestedDriverId,
    overrideDriverId: record.overrideDriverId,
    reason: record.reason,
  }));
}

// ─── Update Override Outcome ──────────────────────────────────────────────────

export async function updateOverrideOutcome(
  tripId: number,
  outcome: "better" | "same" | "worse"
): Promise<void> {
  // Find the override event for this trip
  const overrideEvents = await db
    .select()
    .from(automationEvents)
    .where(
      and(
        eq(automationEvents.eventType, "DISPATCH_OVERRIDE"),
        eq(automationEvents.tripId, tripId)
      )
    )
    .orderBy(desc(automationEvents.createdAt))
    .limit(1);

  if (overrideEvents.length === 0) return;

  const event = overrideEvents[0];
  const payload = (event.payload as any) || {};
  payload.outcome = outcome;

  await db.insert(automationEvents).values({
    eventType: "DISPATCH_OVERRIDE_OUTCOME",
    tripId,
    companyId: event.companyId,
    driverId: event.driverId,
    payload: { ...payload, outcome, evaluatedAt: new Date().toISOString() },
  });
}

// ─── Analyze Override Patterns ────────────────────────────────────────────────

export async function getOverridePatterns(companyId: number): Promise<OverridePattern[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString();

  // Get all override events for this company in the last 90 days
  const overrides = await db
    .select()
    .from(automationEvents)
    .where(
      and(
        eq(automationEvents.eventType, "DISPATCH_OVERRIDE"),
        eq(automationEvents.companyId, companyId),
        gte(automationEvents.createdAt, cutoff)
      )
    )
    .orderBy(desc(automationEvents.createdAt));

  if (overrides.length === 0) {
    return [];
  }

  const patterns: OverridePattern[] = [];

  // Pattern 1: Driver preference — same override driver chosen repeatedly
  const driverPreferenceCounts = new Map<number, { count: number; lastSeen: string; name: string }>();
  for (const o of overrides) {
    const p = o.payload as any;
    const did = p?.overrideDriverId;
    if (!did) continue;
    const existing = driverPreferenceCounts.get(did);
    if (existing) {
      existing.count++;
    } else {
      driverPreferenceCounts.set(did, {
        count: 1,
        lastSeen: o.createdAt.toISOString(),
        name: p.overrideDriverName || `Driver #${did}`,
      });
    }
  }
  for (const [driverId, data] of driverPreferenceCounts) {
    if (data.count >= 3) {
      patterns.push({
        pattern: "driver_preference",
        description: `Dispatcher consistently prefers ${data.name} (chosen ${data.count} times in overrides)`,
        occurrences: data.count,
        lastSeen: data.lastSeen,
        confidence: Math.min(1, data.count / 10),
        suggestedAction: `Consider increasing ${data.name}'s base priority score`,
      });
    }
  }

  // Pattern 2: Clinic-driver affinity — override driver chosen for specific clinic
  const clinicDriverCounts = new Map<string, { count: number; lastSeen: string; clinicId: number; driverName: string }>();
  for (const o of overrides) {
    const p = o.payload as any;
    const clinicId = p?.tripDetails?.clinicId;
    const driverId = p?.overrideDriverId;
    if (!clinicId || !driverId) continue;
    const key = `${clinicId}:${driverId}`;
    const existing = clinicDriverCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      clinicDriverCounts.set(key, {
        count: 1,
        lastSeen: o.createdAt.toISOString(),
        clinicId,
        driverName: p.overrideDriverName || `Driver #${driverId}`,
      });
    }
  }
  for (const [, data] of clinicDriverCounts) {
    if (data.count >= 2) {
      patterns.push({
        pattern: "clinic_driver_affinity",
        description: `Dispatcher prefers ${data.driverName} for clinic #${data.clinicId} (${data.count} overrides)`,
        occurrences: data.count,
        lastSeen: data.lastSeen,
        confidence: Math.min(1, data.count / 5),
        suggestedAction: `Auto-boost ${data.driverName} for trips from clinic #${data.clinicId}`,
      });
    }
  }

  // Pattern 3: Vehicle capability preference — override favors certain vehicle types
  const vehiclePrefCounts = new Map<string, { count: number; lastSeen: string; mobilityReq: string }>();
  for (const o of overrides) {
    const p = o.payload as any;
    const overrideCap = p?.overrideDriverDetails?.vehicleCapability;
    const suggestedCap = p?.suggestedDriverDetails?.vehicleCapability;
    const mobilityReq = p?.tripDetails?.mobilityRequirement;
    if (!overrideCap || !suggestedCap || overrideCap === suggestedCap) continue;
    const key = `${mobilityReq}:${overrideCap}`;
    const existing = vehiclePrefCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      vehiclePrefCounts.set(key, {
        count: 1,
        lastSeen: o.createdAt.toISOString(),
        mobilityReq: mobilityReq || "unknown",
      });
    }
  }
  for (const [key, data] of vehiclePrefCounts) {
    if (data.count >= 2) {
      const [mobility, cap] = key.split(":");
      patterns.push({
        pattern: "vehicle_preference",
        description: `Dispatcher prefers ${cap} vehicles for ${mobility} trips (${data.count} overrides)`,
        occurrences: data.count,
        lastSeen: data.lastSeen,
        confidence: Math.min(1, data.count / 5),
        suggestedAction: `Adjust vehicle matching weight for ${mobility} trips`,
      });
    }
  }

  // Pattern 4: Zone preference — override driver preferred for certain zip codes
  const zipDriverCounts = new Map<string, { count: number; lastSeen: string; zip: string; driverName: string }>();
  for (const o of overrides) {
    const p = o.payload as any;
    const zip = p?.tripDetails?.pickupZip;
    const driverId = p?.overrideDriverId;
    if (!zip || !driverId) continue;
    const key = `${zip}:${driverId}`;
    const existing = zipDriverCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      zipDriverCounts.set(key, {
        count: 1,
        lastSeen: o.createdAt.toISOString(),
        zip,
        driverName: p.overrideDriverName || `Driver #${driverId}`,
      });
    }
  }
  for (const [, data] of zipDriverCounts) {
    if (data.count >= 2) {
      patterns.push({
        pattern: "zone_driver_affinity",
        description: `Dispatcher prefers ${data.driverName} for trips in zip ${data.zip} (${data.count} overrides)`,
        occurrences: data.count,
        lastSeen: data.lastSeen,
        confidence: Math.min(1, data.count / 5),
        suggestedAction: `Auto-boost ${data.driverName} for trips in zip ${data.zip}`,
      });
    }
  }

  // Pattern 5: Override outcome analysis
  const outcomeEvents = await db
    .select()
    .from(automationEvents)
    .where(
      and(
        eq(automationEvents.eventType, "DISPATCH_OVERRIDE_OUTCOME"),
        eq(automationEvents.companyId, companyId),
        gte(automationEvents.createdAt, cutoff)
      )
    );

  if (outcomeEvents.length >= 5) {
    let better = 0;
    let same = 0;
    let worse = 0;
    for (const e of outcomeEvents) {
      const outcome = (e.payload as any)?.outcome;
      if (outcome === "better") better++;
      else if (outcome === "same") same++;
      else if (outcome === "worse") worse++;
    }
    const total = better + same + worse;
    if (total > 0) {
      const betterRate = better / total;
      patterns.push({
        pattern: "override_success_rate",
        description: `Override outcomes: ${(betterRate * 100).toFixed(0)}% better, ${((same / total) * 100).toFixed(0)}% same, ${((worse / total) * 100).toFixed(0)}% worse (${total} evaluated)`,
        occurrences: total,
        lastSeen: outcomeEvents[0]?.createdAt.toISOString() || "",
        confidence: Math.min(1, total / 20),
        suggestedAction: betterRate > 0.5
          ? "Dispatcher overrides tend to improve outcomes — consider trusting dispatcher preferences more"
          : "Auto-dispatch generally performs well — consider fewer manual overrides",
      });
    }
  }

  // Sort by confidence descending
  patterns.sort((a, b) => b.confidence - a.confidence);

  return patterns;
}

// ─── Apply Learned Preferences ────────────────────────────────────────────────

export async function applyLearnedPreferences(
  tripId: number,
  candidates: DriverCandidate[]
): Promise<DriverCandidate[]> {
  if (candidates.length === 0) return candidates;

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  if (!trip) return candidates;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  // Get all overrides for this company
  const overrides = await db
    .select()
    .from(automationEvents)
    .where(
      and(
        eq(automationEvents.eventType, "DISPATCH_OVERRIDE"),
        eq(automationEvents.companyId, trip.companyId),
        gte(automationEvents.createdAt, cutoff)
      )
    );

  if (overrides.length === 0) return candidates;

  // Build bonus map: driverId -> bonus score
  const bonusMap = new Map<number, number>();

  for (const o of overrides) {
    const p = o.payload as any;
    const overrideDriverId = p?.overrideDriverId;
    if (!overrideDriverId) continue;

    let bonus = 0;

    // Bonus: driver was preferred override for this clinic
    if (trip.clinicId && p?.tripDetails?.clinicId === trip.clinicId) {
      bonus += 15;
    }

    // Bonus: driver was preferred override for this zip
    if (trip.pickupZip && p?.tripDetails?.pickupZip === trip.pickupZip) {
      bonus += 10;
    }

    // Bonus: driver was preferred for this mobility type
    if (p?.tripDetails?.mobilityRequirement === trip.mobilityRequirement) {
      bonus += 5;
    }

    // Bonus: driver was preferred for this trip type
    if (p?.tripDetails?.tripType === trip.tripType) {
      bonus += 5;
    }

    // Scale by outcome if known
    const outcome = p?.outcome;
    if (outcome === "better") {
      bonus *= 1.5;
    } else if (outcome === "worse") {
      bonus *= 0.3;
    }

    if (bonus > 0) {
      bonusMap.set(overrideDriverId, (bonusMap.get(overrideDriverId) || 0) + bonus);
    }
  }

  // Apply bonuses — cap at 200 points to avoid overwhelming other signals
  const MAX_LEARNED_BONUS = 200;

  return candidates.map(c => {
    const bonus = Math.min(MAX_LEARNED_BONUS, bonusMap.get(c.driverId) || 0);
    if (bonus > 0) {
      return { ...c, finalScore: c.finalScore + bonus };
    }
    return c;
  });
}
