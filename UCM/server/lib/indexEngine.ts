import { db } from "../db";
import { trips, clinics, cities, drivers, vehicles, tripBilling } from "@shared/schema";
import { eq, and, gte, lte, sql, isNull, isNotNull, inArray, or, count } from "drizzle-orm";

export interface IndexParams {
  dateFrom: string;
  dateTo: string;
  scope: "general" | "state" | "city";
  state?: string;
  city?: string;
}

export interface TRIResult {
  score: number;
  completed: number;
  onTime: number;
  late: number;
  noShow: number;
}

export interface CTSResult {
  score: number;
  triComponent: number;
  returnReliability: number;
  proofCompleteness: number;
}

export interface DriverStabilityResult {
  score: number;
  assigned: number;
  completed: number;
  latePickups: number;
  driverCancels: number;
}

export interface DriverUtilizationResult {
  percent: number;
  activeTripMinutes: number;
  scheduledMinutes: number;
}

export interface DispatchEfficiencyResult {
  efficiency: number;
  autoAssigned: number;
  totalAssigned: number;
  manualOverrideCount: number;
  reassignmentCount: number;
}

export interface RevenueLeakageResult {
  leakageTotal: number;
  leakageByReason: Record<string, number>;
  leakageByClinic: Record<string, number>;
}

export interface ClinicLoadResult {
  ratio: number;
  level: "low" | "medium" | "high";
  activeTrips: number;
  scheduledDrivers: number;
}

export interface WeeklyProfitResult {
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
}

export interface ReplacementPressureResult {
  shortageCount: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  scheduledDrivers: number;
  activeDrivers: number;
  recommendedAction: string;
}

export interface LateRiskResult {
  summaryRed: number;
  summaryYellow: number;
  summaryGreen: number;
  riskyTrips: Array<{
    tripId: number;
    publicId: string;
    scheduledDate: string;
    pickupTime: string;
    riskScore: number;
    reasons: string[];
    clinicName: string;
    driverName: string;
    cityName: string;
  }>;
}

export interface BreakdownRow {
  label: string;
  key: string;
  tri: number;
  cts: number;
  driverStability: number;
  driverUtilization: number;
  dispatchEfficiency: number;
  leakage: number;
  load: number;
  profit: number;
  replacementPressure: number;
  lateRisk: number;
}

export interface IndexesSummary {
  tri: TRIResult;
  cts: CTSResult;
  driverStability: DriverStabilityResult;
  driverUtilization: DriverUtilizationResult;
  dispatchEfficiency: DispatchEfficiencyResult;
  revenueLeakage: RevenueLeakageResult;
  clinicLoad: ClinicLoadResult;
  weeklyProfit: WeeklyProfitResult;
  replacementPressure: ReplacementPressureResult;
  lateRisk: LateRiskResult;
}

export interface IndexesResult {
  meta: { dateFrom: string; dateTo: string; scope: string; state?: string; city?: string; computedAt: string };
  summary: IndexesSummary;
  breakdown: BreakdownRow[];
}

const GRACE_MINUTES = 10;
const LATE_WEIGHT = 0.5;
const NOSHOW_WEIGHT = 1.0;

function buildScopeFilter(params: IndexParams) {
  const conditions: any[] = [
    gte(trips.scheduledDate, params.dateFrom),
    lte(trips.scheduledDate, params.dateTo),
    isNull(trips.deletedAt),
  ];

  if (params.scope === "state" && params.state) {
    conditions.push(
      sql`(${trips.cityId} IN (SELECT id FROM cities WHERE state = ${params.state})
        OR ${trips.clinicId} IN (SELECT id FROM clinics WHERE address_state = ${params.state}))`
    );
  } else if (params.scope === "city" && params.city) {
    const cityId = parseInt(params.city);
    if (!isNaN(cityId)) {
      conditions.push(eq(trips.cityId, cityId));
    }
  }

  return conditions;
}

async function computeTRI(conditions: any[]): Promise<TRIResult> {
  const tripsData = await db
    .select({
      id: trips.id,
      status: trips.status,
      scheduledTime: trips.scheduledTime,
      pickupTime: trips.pickupTime,
      arrivedPickupAt: trips.arrivedPickupAt,
      completedAt: trips.completedAt,
      billingOutcome: trips.billingOutcome,
    })
    .from(trips)
    .where(and(...conditions));

  let completed = 0;
  let onTime = 0;
  let late = 0;
  let noShow = 0;

  for (const t of tripsData) {
    if (t.status === "NO_SHOW" || t.billingOutcome === "no_show") {
      noShow++;
      continue;
    }
    if (t.status !== "COMPLETED") continue;
    completed++;

    if (t.arrivedPickupAt && (t.scheduledTime || t.pickupTime)) {
      const timeStr = t.scheduledTime || t.pickupTime || "00:00";
      const [h, m] = timeStr.split(":").map(Number);
      const scheduledMs = (h * 60 + m + GRACE_MINUTES) * 60000;
      const arrivedDate = new Date(t.arrivedPickupAt);
      const arrivedMs = (arrivedDate.getUTCHours() * 60 + arrivedDate.getUTCMinutes()) * 60000;
      if (arrivedMs <= scheduledMs) {
        onTime++;
      } else {
        late++;
      }
    } else {
      onTime++;
    }
  }

  const total = completed + noShow;
  if (total === 0) return { score: 0, completed, onTime, late, noShow };

  const onTimePct = completed > 0 ? (onTime / completed) : 0;
  const latePct = completed > 0 ? (late / completed) : 0;
  const noShowPct = (noShow / total);

  const score = Math.max(0, Math.min(100,
    100 * onTimePct - LATE_WEIGHT * 100 * latePct - NOSHOW_WEIGHT * 100 * noShowPct
  ));

  return { score: Math.round(score * 10) / 10, completed, onTime, late, noShow };
}

async function computeCTS(conditions: any[]): Promise<CTSResult> {
  const tripsData = await db
    .select({
      id: trips.id,
      status: trips.status,
      scheduledTime: trips.scheduledTime,
      arrivedPickupAt: trips.arrivedPickupAt,
      completedAt: trips.completedAt,
      pickedUpAt: trips.pickedUpAt,
      arrivedDropoffAt: trips.arrivedDropoffAt,
      startedAt: trips.startedAt,
      billingOutcome: trips.billingOutcome,
      parentTripId: trips.parentTripId,
    })
    .from(trips)
    .where(and(...conditions));

  const completed = tripsData.filter(t => t.status === "COMPLETED");
  const totalTrips = tripsData.length;
  if (totalTrips === 0) return { score: 0, triComponent: 0, returnReliability: 0, proofCompleteness: 0 };

  let onTime = 0;
  let lateCount = 0;
  const noShow = tripsData.filter(t => t.status === "NO_SHOW").length;

  for (const t of completed) {
    if (t.arrivedPickupAt && t.scheduledTime) {
      const [h, m] = t.scheduledTime.split(":").map(Number);
      const scheduledMs = (h * 60 + m + GRACE_MINUTES) * 60000;
      const arrivedDate = new Date(t.arrivedPickupAt);
      const arrivedMs = (arrivedDate.getHours() * 60 + arrivedDate.getMinutes()) * 60000;
      if (arrivedMs <= scheduledMs) onTime++;
      else lateCount++;
    } else {
      onTime++;
    }
  }

  const triNorm = completed.length > 0
    ? Math.max(0, 100 * (onTime / completed.length) - LATE_WEIGHT * 100 * (lateCount / completed.length) - NOSHOW_WEIGHT * 100 * (noShow / (completed.length + noShow)))
    : 0;

  const returnTrips = tripsData.filter(t => t.parentTripId != null && t.status === "COMPLETED");
  const totalReturns = tripsData.filter(t => t.parentTripId != null).length;
  const returnReliability = totalReturns > 0 ? (returnTrips.length / totalReturns) * 100 : 100;

  let proofCount = 0;
  for (const t of completed) {
    let fields = 0;
    let filled = 0;
    const timestamps = [t.arrivedPickupAt, t.pickedUpAt, t.arrivedDropoffAt, t.completedAt];
    fields += timestamps.length;
    filled += timestamps.filter(Boolean).length;
    proofCount += fields > 0 ? (filled / fields) : 0;
  }
  const proofCompleteness = completed.length > 0 ? (proofCount / completed.length) * 100 : 0;

  const weights = { tri: 0.5, returnReliability: 0.25, proofCompleteness: 0.25 };
  const score = weights.tri * triNorm + weights.returnReliability * returnReliability + weights.proofCompleteness * proofCompleteness;

  return {
    score: Math.round(Math.max(0, Math.min(100, score)) * 10) / 10,
    triComponent: Math.round(triNorm * 10) / 10,
    returnReliability: Math.round(returnReliability * 10) / 10,
    proofCompleteness: Math.round(proofCompleteness * 10) / 10,
  };
}

async function computeDriverStability(conditions: any[]): Promise<DriverStabilityResult> {
  const tripsData = await db
    .select({
      status: trips.status,
      driverId: trips.driverId,
      arrivedPickupAt: trips.arrivedPickupAt,
      scheduledTime: trips.scheduledTime,
      cancelType: trips.cancelType,
      faultParty: trips.faultParty,
    })
    .from(trips)
    .where(and(...conditions, isNotNull(trips.driverId)));

  const assigned = tripsData.length;
  const completed = tripsData.filter(t => t.status === "COMPLETED").length;

  let latePickups = 0;
  for (const t of tripsData) {
    if (t.arrivedPickupAt && t.scheduledTime) {
      const [h, m] = t.scheduledTime.split(":").map(Number);
      const scheduledMs = (h * 60 + m + GRACE_MINUTES) * 60000;
      const arrivedDate = new Date(t.arrivedPickupAt);
      const arrivedMs = (arrivedDate.getHours() * 60 + arrivedDate.getMinutes()) * 60000;
      if (arrivedMs > scheduledMs) latePickups++;
    }
  }

  const driverCancels = tripsData.filter(t =>
    t.status === "CANCELLED" && t.faultParty === "driver"
  ).length;

  if (assigned === 0) return { score: 0, assigned, completed, latePickups, driverCancels };

  const completionRate = completed / assigned;
  const latePenalty = assigned > 0 ? (latePickups / assigned) * 0.2 : 0;
  const cancelPenalty = assigned > 0 ? (driverCancels / assigned) * 0.3 : 0;

  const score = Math.max(0, Math.min(100, 100 * completionRate - latePenalty * 100 - cancelPenalty * 100));

  return {
    score: Math.round(score * 10) / 10,
    assigned,
    completed,
    latePickups,
    driverCancels,
  };
}

async function computeDriverUtilization(conditions: any[]): Promise<DriverUtilizationResult> {
  const completedTrips = await db
    .select({
      driverId: trips.driverId,
      pickedUpAt: trips.pickedUpAt,
      arrivedPickupAt: trips.arrivedPickupAt,
      completedAt: trips.completedAt,
      scheduledDate: trips.scheduledDate,
    })
    .from(trips)
    .where(and(...conditions, eq(trips.status, "COMPLETED"), isNotNull(trips.driverId)));

  let activeTripMinutes = 0;
  for (const t of completedTrips) {
    const start = t.pickedUpAt || t.arrivedPickupAt;
    const end = t.completedAt;
    if (start && end) {
      const diff = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
      if (diff > 0 && diff < 720) activeTripMinutes += diff;
    }
  }

  const uniqueDates = new Set(completedTrips.map(t => t.scheduledDate));
  const uniqueDrivers = new Set(completedTrips.map(t => t.driverId).filter(Boolean));
  const scheduledMinutes = uniqueDates.size * uniqueDrivers.size * 480;

  const percent = scheduledMinutes > 0 ? (activeTripMinutes / scheduledMinutes) * 100 : 0;

  return {
    percent: Math.round(percent * 10) / 10,
    activeTripMinutes: Math.round(activeTripMinutes),
    scheduledMinutes: Math.round(scheduledMinutes),
  };
}

async function computeDispatchEfficiency(conditions: any[]): Promise<DispatchEfficiencyResult> {
  const assignedTrips = await db
    .select({
      assignmentSource: trips.assignmentSource,
      status: trips.status,
      driverId: trips.driverId,
    })
    .from(trips)
    .where(and(...conditions, isNotNull(trips.driverId)));

  const totalAssigned = assignedTrips.length;
  const autoAssigned = assignedTrips.filter(t =>
    t.assignmentSource === "auto" || t.assignmentSource === "auto_assignment"
  ).length;

  const manualOverrideCount = assignedTrips.filter(t =>
    t.assignmentSource === "manual" || t.assignmentSource === "dispatch" || !t.assignmentSource
  ).length;

  const reassignmentCount = assignedTrips.filter(t =>
    t.assignmentSource === "reassignment" || t.assignmentSource === "swap"
  ).length;

  const efficiency = totalAssigned > 0 ? (autoAssigned / totalAssigned) * 100 : 0;

  return {
    efficiency: Math.round(efficiency * 10) / 10,
    autoAssigned,
    totalAssigned,
    manualOverrideCount,
    reassignmentCount,
  };
}

async function computeRevenueLeakage(conditions: any[]): Promise<RevenueLeakageResult> {
  const tripsData = await db
    .select({
      id: trips.id,
      status: trips.status,
      billingOutcome: trips.billingOutcome,
      billable: trips.billable,
      priceTotalCents: trips.priceTotalCents,
      clinicId: trips.clinicId,
      parentTripId: trips.parentTripId,
    })
    .from(trips)
    .where(and(...conditions));

  const billingRows = await db
    .select({
      tripId: tripBilling.tripId,
      totalCents: tripBilling.totalCents,
      status: tripBilling.status,
    })
    .from(tripBilling);

  const billedSet = new Map<number, { totalCents: number; status: string }>();
  for (const b of billingRows) {
    billedSet.set(b.tripId, { totalCents: b.totalCents, status: b.status });
  }

  const clinicNames = await db.select({ id: clinics.id, name: clinics.name }).from(clinics);
  const clinicMap = new Map(clinicNames.map(c => [c.id, c.name]));

  let leakageTotal = 0;
  const leakageByReason: Record<string, number> = {};
  const leakageByClinic: Record<string, number> = {};

  const addLeak = (reason: string, clinicId: number | null, amount: number) => {
    leakageTotal += amount;
    leakageByReason[reason] = (leakageByReason[reason] || 0) + amount;
    const cName = clinicId ? (clinicMap.get(clinicId) || `Clinic #${clinicId}`) : "Unknown";
    leakageByClinic[cName] = (leakageByClinic[cName] || 0) + amount;
  };

  const estPerTrip = 5000;

  for (const t of tripsData) {
    const billing = billedSet.get(t.id);

    if (t.status === "NO_SHOW" && !billing) {
      addLeak("No-show not billed", t.clinicId, t.priceTotalCents || estPerTrip);
    }

    if (t.status === "CANCELLED" && t.billable && !billing) {
      addLeak("Cancelled billable not billed", t.clinicId, t.priceTotalCents || estPerTrip);
    }

    if (t.status === "COMPLETED" && !billing) {
      addLeak("Completed without billing record", t.clinicId, t.priceTotalCents || estPerTrip);
    }
  }

  const completedIds = new Set(tripsData.filter(t => t.status === "COMPLETED" && t.parentTripId == null).map(t => t.id));
  const returnTripParents = new Set(tripsData.filter(t => t.parentTripId != null).map(t => t.parentTripId));
  for (const origId of completedIds) {
    if (!returnTripParents.has(origId)) {
    }
  }

  return {
    leakageTotal: Math.round(leakageTotal) / 100,
    leakageByReason: Object.fromEntries(
      Object.entries(leakageByReason).map(([k, v]) => [k, Math.round(v) / 100])
    ),
    leakageByClinic: Object.fromEntries(
      Object.entries(leakageByClinic).map(([k, v]) => [k, Math.round(v) / 100])
    ),
  };
}

async function computeClinicLoad(conditions: any[]): Promise<ClinicLoadResult> {
  const tripsData = await db
    .select({
      status: trips.status,
      driverId: trips.driverId,
    })
    .from(trips)
    .where(and(...conditions));

  const activeStatuses = ["ASSIGNED", "EN_ROUTE_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF", "ARRIVED_DROPOFF", "IN_PROGRESS"];
  const activeTrips = tripsData.filter(t => activeStatuses.includes(t.status) || t.status === "SCHEDULED").length;
  const scheduledDrivers = new Set(tripsData.filter(t => t.driverId).map(t => t.driverId)).size;

  const ratio = scheduledDrivers > 0 ? activeTrips / scheduledDrivers : 0;
  const level = ratio > 3 ? "high" : ratio > 1.5 ? "medium" : "low";

  return {
    ratio: Math.round(ratio * 100) / 100,
    level,
    activeTrips,
    scheduledDrivers,
  };
}

async function computeWeeklyProfit(conditions: any[]): Promise<WeeklyProfitResult> {
  const billingData = await db
    .select({
      tripId: tripBilling.tripId,
      totalCents: tripBilling.totalCents,
    })
    .from(tripBilling)
    .innerJoin(trips, eq(tripBilling.tripId, trips.id))
    .where(and(...conditions));

  const revenue = billingData.reduce((sum, b) => sum + (b.totalCents || 0), 0) / 100;

  const completedTrips = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(...conditions, eq(trips.status, "COMPLETED")));

  const estimatedCostPerTrip = 25;
  const cost = completedTrips.length * estimatedCostPerTrip;

  const profit = revenue - cost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  return {
    revenue: Math.round(revenue * 100) / 100,
    cost: Math.round(cost * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    margin: Math.round(margin * 10) / 10,
  };
}

async function computeReplacementPressure(conditions: any[]): Promise<ReplacementPressureResult> {
  const tripsData = await db
    .select({ driverId: trips.driverId, status: trips.status })
    .from(trips)
    .where(and(...conditions, isNotNull(trips.driverId)));

  const scheduledDriverIds = new Set(tripsData.map(t => t.driverId).filter(Boolean));
  const activeDriverIds = new Set(
    tripsData
      .filter(t => t.status !== "CANCELLED" && t.status !== "NO_SHOW")
      .map(t => t.driverId)
      .filter(Boolean)
  );

  const allDrivers = await db
    .select({ id: drivers.id, status: drivers.status, connected: drivers.connected, lastActiveAt: drivers.lastActiveAt })
    .from(drivers)
    .where(isNull(drivers.deletedAt));

  const onlineDrivers = allDrivers.filter(d =>
    d.connected || (d.lastActiveAt && Date.now() - new Date(d.lastActiveAt).getTime() < 3600000)
  );

  const scheduledDrivers = scheduledDriverIds.size;
  const activeDrivers = Math.max(onlineDrivers.length, activeDriverIds.size);
  const shortageCount = Math.max(0, scheduledDrivers - activeDrivers);

  let riskLevel: "low" | "medium" | "high" | "critical" = "low";
  let recommendedAction = "Staffing adequate";

  if (shortageCount === 0) {
    riskLevel = "low";
    recommendedAction = "Staffing adequate";
  } else if (shortageCount <= 2) {
    riskLevel = "medium";
    recommendedAction = "Consider activating backup drivers";
  } else if (shortageCount <= 5) {
    riskLevel = "high";
    recommendedAction = "Urgently activate backup drivers or redistribute trips";
  } else {
    riskLevel = "critical";
    recommendedAction = "Critical shortage - redistribute trips and activate all available drivers";
  }

  return { shortageCount, riskLevel, scheduledDrivers, activeDrivers, recommendedAction };
}

async function computeLateRisk(conditions: any[]): Promise<LateRiskResult> {
  const upcomingTrips = await db
    .select({
      id: trips.id,
      publicId: trips.publicId,
      scheduledDate: trips.scheduledDate,
      pickupTime: trips.pickupTime,
      scheduledTime: trips.scheduledTime,
      driverId: trips.driverId,
      clinicId: trips.clinicId,
      cityId: trips.cityId,
      distanceMiles: trips.distanceMiles,
      status: trips.status,
    })
    .from(trips)
    .where(and(...conditions, inArray(trips.status, ["SCHEDULED", "ASSIGNED"])));

  const historyData = await db
    .select({
      cityId: trips.cityId,
      arrivedPickupAt: trips.arrivedPickupAt,
      scheduledTime: trips.scheduledTime,
      status: trips.status,
    })
    .from(trips)
    .where(and(
      eq(trips.status, "COMPLETED"),
      isNotNull(trips.arrivedPickupAt),
      isNull(trips.deletedAt)
    ));

  const lateRateByCity = new Map<number, number>();
  const cityTotals = new Map<number, number>();
  for (const h of historyData) {
    if (!h.scheduledTime || !h.arrivedPickupAt) continue;
    const cityTotal = (cityTotals.get(h.cityId) || 0) + 1;
    cityTotals.set(h.cityId, cityTotal);

    const [hh, mm] = h.scheduledTime.split(":").map(Number);
    const scheduledMs = (hh * 60 + mm + GRACE_MINUTES) * 60000;
    const arrived = new Date(h.arrivedPickupAt);
    const arrivedMs = (arrived.getHours() * 60 + arrived.getMinutes()) * 60000;
    if (arrivedMs > scheduledMs) {
      lateRateByCity.set(h.cityId, (lateRateByCity.get(h.cityId) || 0) + 1);
    }
  }

  const driverRows = await db
    .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName })
    .from(drivers)
    .where(isNull(drivers.deletedAt));
  const driverMap = new Map(driverRows.map(d => [d.id, `${d.firstName} ${d.lastName}`]));

  const clinicRows = await db.select({ id: clinics.id, name: clinics.name }).from(clinics);
  const clinicMap = new Map(clinicRows.map(c => [c.id, c.name]));

  const cityRows = await db.select({ id: cities.id, name: cities.name }).from(cities);
  const cityMap = new Map(cityRows.map(c => [c.id, c.name]));

  const riskyTrips: LateRiskResult["riskyTrips"] = [];

  for (const t of upcomingTrips) {
    const reasons: string[] = [];
    let riskScore = 0;

    const cityLate = lateRateByCity.get(t.cityId) || 0;
    const cityTotal = cityTotals.get(t.cityId) || 1;
    const cityLateRate = cityLate / cityTotal;
    if (cityLateRate > 0.3) {
      riskScore += 30;
      reasons.push(`High historical late rate in ${cityMap.get(t.cityId) || "city"} (${Math.round(cityLateRate * 100)}%)`);
    } else if (cityLateRate > 0.15) {
      riskScore += 15;
      reasons.push(`Moderate late rate in ${cityMap.get(t.cityId) || "city"} (${Math.round(cityLateRate * 100)}%)`);
    }

    if (!t.driverId) {
      riskScore += 40;
      reasons.push("No driver assigned");
    }

    if (t.distanceMiles && Number(t.distanceMiles) > 20) {
      riskScore += 20;
      reasons.push(`Long distance (${Number(t.distanceMiles).toFixed(1)} mi)`);
    }

    riskScore = Math.min(100, riskScore);

    if (riskScore > 0) {
      riskyTrips.push({
        tripId: t.id,
        publicId: t.publicId,
        scheduledDate: t.scheduledDate,
        pickupTime: t.pickupTime,
        riskScore,
        reasons,
        clinicName: t.clinicId ? (clinicMap.get(t.clinicId) || "Unknown") : "Unknown",
        driverName: t.driverId ? (driverMap.get(t.driverId) || "Unknown") : "Unassigned",
        cityName: cityMap.get(t.cityId) || "Unknown",
      });
    }
  }

  riskyTrips.sort((a, b) => b.riskScore - a.riskScore);
  const top20 = riskyTrips.slice(0, 20);

  const summaryRed = top20.filter(t => t.riskScore >= 60).length;
  const summaryYellow = top20.filter(t => t.riskScore >= 30 && t.riskScore < 60).length;
  const summaryGreen = top20.filter(t => t.riskScore < 30).length;

  return { summaryRed, summaryYellow, summaryGreen, riskyTrips: top20 };
}

async function computeBreakdownRow(label: string, key: string, conditions: any[]): Promise<BreakdownRow> {
  const [tri, cts, ds, du, de, rl, cl, wp, rp, lr] = await Promise.all([
    computeTRI(conditions),
    computeCTS(conditions),
    computeDriverStability(conditions),
    computeDriverUtilization(conditions),
    computeDispatchEfficiency(conditions),
    computeRevenueLeakage(conditions),
    computeClinicLoad(conditions),
    computeWeeklyProfit(conditions),
    computeReplacementPressure(conditions),
    computeLateRisk(conditions),
  ]);

  return {
    label,
    key,
    tri: tri.score,
    cts: cts.score,
    driverStability: ds.score,
    driverUtilization: du.percent,
    dispatchEfficiency: de.efficiency,
    leakage: rl.leakageTotal,
    load: cl.ratio,
    profit: wp.profit,
    replacementPressure: rp.shortageCount,
    lateRisk: lr.summaryRed,
  };
}

export async function computeIndexes(params: IndexParams): Promise<IndexesResult> {
  const conditions = buildScopeFilter(params);

  const [tri, cts, driverStability, driverUtilization, dispatchEfficiency, revenueLeakage, clinicLoad, weeklyProfit, replacementPressure, lateRisk] = await Promise.all([
    computeTRI(conditions),
    computeCTS(conditions),
    computeDriverStability(conditions),
    computeDriverUtilization(conditions),
    computeDispatchEfficiency(conditions),
    computeRevenueLeakage(conditions),
    computeClinicLoad(conditions),
    computeWeeklyProfit(conditions),
    computeReplacementPressure(conditions),
    computeLateRisk(conditions),
  ]);

  const breakdown: BreakdownRow[] = [];

  if (params.scope === "general") {
    const statesResult = await db.select({ state: cities.state }).from(cities).groupBy(cities.state);
    const stateNames = statesResult.map(r => r.state);

    for (const state of stateNames) {
      const stateConditions = [
        gte(trips.scheduledDate, params.dateFrom),
        lte(trips.scheduledDate, params.dateTo),
        isNull(trips.deletedAt),
        sql`${trips.cityId} IN (SELECT id FROM cities WHERE state = ${state})`,
      ];
      breakdown.push(await computeBreakdownRow(state, state, stateConditions));
    }
  } else if (params.scope === "state" && params.state) {
    const citiesResult = await db
      .select({ id: cities.id, name: cities.name })
      .from(cities)
      .where(eq(cities.state, params.state));

    for (const city of citiesResult) {
      const cityConditions = [
        gte(trips.scheduledDate, params.dateFrom),
        lte(trips.scheduledDate, params.dateTo),
        isNull(trips.deletedAt),
        eq(trips.cityId, city.id),
      ];
      breakdown.push(await computeBreakdownRow(city.name, String(city.id), cityConditions));
    }
  } else if (params.scope === "city" && params.city) {
    const cityId = parseInt(params.city);
    const clinicsResult = await db
      .select({ id: clinics.id, name: clinics.name })
      .from(clinics)
      .where(and(eq(clinics.cityId, cityId), isNull(clinics.deletedAt)));

    for (const clinic of clinicsResult) {
      const clinicConditions = [
        gte(trips.scheduledDate, params.dateFrom),
        lte(trips.scheduledDate, params.dateTo),
        isNull(trips.deletedAt),
        eq(trips.clinicId, clinic.id),
      ];
      breakdown.push(await computeBreakdownRow(clinic.name, String(clinic.id), clinicConditions));
    }
  }

  return {
    meta: {
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      scope: params.scope,
      state: params.state,
      city: params.city,
      computedAt: new Date().toISOString(),
    },
    summary: {
      tri,
      cts,
      driverStability,
      driverUtilization,
      dispatchEfficiency,
      revenueLeakage,
      clinicLoad,
      weeklyProfit,
      replacementPressure,
      lateRisk,
    },
    breakdown,
  };
}
