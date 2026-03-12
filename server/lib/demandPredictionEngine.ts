import { db } from "../db";
import { trips, drivers, companies, cities } from "@shared/schema";
import { eq, and, sql, gte, lte, isNull } from "drizzle-orm";
import { setJson, getJson } from "./redis";
import { cache } from "./cache";
import { createHarnessedTask, type HarnessedTask } from "./schedulerHarness";

const CACHE_PREFIX = "demand_prediction";
const CACHE_TTL_SECONDS = 300; // 5 min
const FORECAST_CACHE_TTL_SECONDS = 3600; // 1 hour for pre-computed forecasts

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface ZoneDemand {
  zone: string;
  lat: number;
  lng: number;
  predictedTrips: number;
  confidence: number;
  trend: "rising" | "stable" | "declining";
}

interface HeatmapPoint {
  lat: number;
  lng: number;
  intensity: number;
}

interface DriverPosition {
  zone: string;
  lat: number;
  lng: number;
  recommendedDrivers: number;
  reason: string;
}

interface SeasonalPattern {
  dayOfWeekFactors: number[];   // Mon(0)..Sun(6) — multiplier vs average
  hourOfDayFactors: number[];   // 0..23 — multiplier vs average
  weekOfMonthFactors: number[]; // week 1..5 — multiplier vs average
  specialDates: SpecialDate[];
  baseDailyAvg: number;         // overall daily average trip count
  dataPoints: number;           // total historical data points analyzed
}

interface SpecialDate {
  date: string;      // MM-DD format
  factor: number;    // multiplier vs normal
  label: string;     // e.g. "First of month", "Holiday"
}

interface DemandPrediction {
  predicted: number;
  confidence: number;
  factors: string[];
}

interface HourlyDriverNeed {
  hour: number;
  predictedTrips: number;
  recommendedDrivers: number;
  isPeak: boolean;
}

interface DriverNeedForecast {
  date: string;
  cityId: number;
  totalPredictedTrips: number;
  peakHour: number;
  peakTrips: number;
  hourly: HourlyDriverNeed[];
}

interface DailyForecast {
  date: string;
  cityId: number;
  companyId: number;
  totalPredicted: number;
  confidence: number;
  peakHour: number;
  peakTrips: number;
  factors: string[];
  hourly: { hour: number; predicted: number }[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Grid zone size in degrees (~1 mile)
const ZONE_SIZE = 0.015;
// Lookback weeks for zone-level EWMA (kept for heatmap/positioning)
const LOOKBACK_WEEKS = 12;
// Lookback days for seasonal analysis
const DEFAULT_LOOKBACK_DAYS = 90;
// US federal holidays (MM-DD) — approximate, covers most NEMT-relevant ones
const FEDERAL_HOLIDAYS = [
  "01-01", // New Year
  "01-15", // MLK (approx)
  "02-19", // Presidents' Day (approx)
  "05-27", // Memorial Day (approx)
  "07-04", // Independence Day
  "09-02", // Labor Day (approx)
  "11-11", // Veterans Day
  "11-28", // Thanksgiving (approx)
  "12-25", // Christmas
];
// Operating hours for NEMT
const OPERATING_START = 5;
const OPERATING_END = 22;

// ─── Utility ─────────────────────────────────────────────────────────────────

function zoneKey(lat: number, lng: number): string {
  const zLat = Math.floor(lat / ZONE_SIZE) * ZONE_SIZE;
  const zLng = Math.floor(lng / ZONE_SIZE) * ZONE_SIZE;
  return `${zLat.toFixed(3)},${zLng.toFixed(3)}`;
}

function zoneCenter(key: string): { lat: number; lng: number } {
  const [latStr, lngStr] = key.split(",");
  return {
    lat: parseFloat(latStr) + ZONE_SIZE / 2,
    lng: parseFloat(lngStr) + ZONE_SIZE / 2,
  };
}

function dayOfWeekIndex(d: Date): number {
  // JS getDay(): 0=Sun..6=Sat — convert to 0=Mon..6=Sun
  return (d.getDay() + 6) % 7;
}

function weekOfMonth(d: Date): number {
  // 1-indexed week of month (1-5)
  return Math.min(Math.ceil(d.getDate() / 7), 5);
}

function isFirstOfMonth(dateStr: string): boolean {
  return dateStr.endsWith("-01");
}

function getMMDD(dateStr: string): string {
  return dateStr.slice(5); // "YYYY-MM-DD" -> "MM-DD"
}

async function cacheGetOrCompute<T>(
  cacheKey: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  try {
    const cached = await getJson<T>(cacheKey);
    if (cached) return cached;
  } catch {
    const memCached = cache.get<T>(cacheKey);
    if (memCached) return memCached;
  }

  const result = await compute();

  try {
    await setJson(cacheKey, result, ttlSeconds);
  } catch {
    cache.set(cacheKey, result, ttlSeconds * 1000);
  }

  return result;
}

// ─── Seasonal Pattern Analysis ───────────────────────────────────────────────

/**
 * Compute seasonal patterns by analyzing historical trip counts.
 *
 * Decomposes demand into:
 * - Day-of-week factors (Mon–Sun)
 * - Hour-of-day factors (0–23)
 * - Week-of-month factors (1–5)
 * - Special date detection (holidays, first-of-month dialysis surges)
 *
 * Each factor is a multiplier relative to the overall average.
 * Factor = 1.0 means average, 1.5 means 50% above average, etc.
 */
export async function computeSeasonalPattern(
  cityId: number,
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS,
): Promise<SeasonalPattern> {
  const cacheKey = `${CACHE_PREFIX}:seasonal:${cityId}:${lookbackDays}`;

  return cacheGetOrCompute(cacheKey, FORECAST_CACHE_TTL_SECONDS, async () => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - lookbackDays);

    const startStr = startDate.toISOString().slice(0, 10);
    const endStr = endDate.toISOString().slice(0, 10);

    // Query trip counts grouped by date and hour
    const rows = await db
      .select({
        scheduledDate: trips.scheduledDate,
        hour: sql<number>`CAST(SPLIT_PART(${trips.pickupTime}, ':', 1) AS INTEGER)`,
        tripCount: sql<number>`count(*)::int`,
      })
      .from(trips)
      .where(
        and(
          eq(trips.cityId, cityId),
          gte(trips.scheduledDate, startStr),
          lte(trips.scheduledDate, endStr),
          sql`${trips.status} NOT IN ('CANCELLED', 'NO_SHOW')`,
          isNull(trips.deletedAt),
        ),
      )
      .groupBy(trips.scheduledDate, sql`SPLIT_PART(${trips.pickupTime}, ':', 1)`);

    // Aggregate by day-of-week, hour-of-day, week-of-month, and per-date
    const dayOfWeekSums = new Array(7).fill(0);
    const dayOfWeekCounts = new Array(7).fill(0);
    const hourOfDaySums = new Array(24).fill(0);
    const hourOfDayCounts = new Array(24).fill(0);
    const weekOfMonthSums = new Array(5).fill(0);
    const weekOfMonthCounts = new Array(5).fill(0);
    const dateTrips = new Map<string, number>();

    let totalTrips = 0;

    for (const row of rows) {
      const d = new Date(row.scheduledDate + "T12:00:00Z");
      const dow = dayOfWeekIndex(d);
      const wom = weekOfMonth(d) - 1; // 0-indexed for array
      const h = row.hour ?? 0;
      const count = row.tripCount;

      dayOfWeekSums[dow] += count;
      dayOfWeekCounts[dow] += 1;
      hourOfDaySums[h] += count;
      hourOfDayCounts[h] += 1;
      weekOfMonthSums[wom] += count;
      weekOfMonthCounts[wom] += 1;

      dateTrips.set(row.scheduledDate, (dateTrips.get(row.scheduledDate) || 0) + count);
      totalTrips += count;
    }

    // Calculate averages
    const totalDays = dateTrips.size || 1;
    const baseDailyAvg = totalTrips / totalDays;
    const overallHourlyAvg = totalTrips / (totalDays * (OPERATING_END - OPERATING_START + 1)) || 1;

    // Day-of-week factors: avg trips per that day / overall daily avg
    const dayOfWeekFactors = dayOfWeekSums.map((sum, i) => {
      const dayAvg = dayOfWeekCounts[i] > 0 ? sum / dayOfWeekCounts[i] : 0;
      // This gives us a daily total for that weekday. Factor = dayAvg / baseDailyAvg
      return baseDailyAvg > 0 ? Math.round((dayAvg / baseDailyAvg) * 100) / 100 : 1.0;
    });

    // Hour-of-day factors: avg trips in that hour / overall hourly avg
    const overallHourAvg = hourOfDaySums.reduce((s, v) => s + v, 0) /
      (hourOfDayCounts.reduce((s, v) => s + v, 0) || 1);
    const hourOfDayFactors = hourOfDaySums.map((sum, i) => {
      const hourAvg = hourOfDayCounts[i] > 0 ? sum / hourOfDayCounts[i] : 0;
      return overallHourAvg > 0 ? Math.round((hourAvg / overallHourAvg) * 100) / 100 : 1.0;
    });

    // Week-of-month factors
    const overallWeekAvg = weekOfMonthSums.reduce((s, v) => s + v, 0) /
      (weekOfMonthCounts.reduce((s, v) => s + v, 0) || 1);
    const weekOfMonthFactors = weekOfMonthSums.map((sum, i) => {
      const weekAvg = weekOfMonthCounts[i] > 0 ? sum / weekOfMonthCounts[i] : 0;
      return overallWeekAvg > 0 ? Math.round((weekAvg / overallWeekAvg) * 100) / 100 : 1.0;
    });

    // Detect special dates: find dates that consistently deviate > 40% from their weekday norm
    const specialDates: SpecialDate[] = [];
    const mmddTrips = new Map<string, number[]>();

    for (const [dateStr, count] of dateTrips) {
      const mmdd = getMMDD(dateStr);
      if (!mmddTrips.has(mmdd)) mmddTrips.set(mmdd, []);
      mmddTrips.get(mmdd)!.push(count);
    }

    // Check first-of-month (dialysis patients)
    const firstOfMonthCounts: number[] = [];
    const nonFirstCounts: number[] = [];
    for (const [dateStr, count] of dateTrips) {
      if (isFirstOfMonth(dateStr)) {
        firstOfMonthCounts.push(count);
      } else {
        nonFirstCounts.push(count);
      }
    }
    if (firstOfMonthCounts.length > 0 && nonFirstCounts.length > 0) {
      const firstAvg = firstOfMonthCounts.reduce((s, v) => s + v, 0) / firstOfMonthCounts.length;
      const nonFirstAvg = nonFirstCounts.reduce((s, v) => s + v, 0) / nonFirstCounts.length;
      if (nonFirstAvg > 0) {
        const factor = firstAvg / nonFirstAvg;
        if (factor > 1.15) {
          specialDates.push({
            date: "XX-01",
            factor: Math.round(factor * 100) / 100,
            label: "First of month (dialysis surge)",
          });
        }
      }
    }

    // Check federal holidays
    for (const holiday of FEDERAL_HOLIDAYS) {
      const holidayCounts = mmddTrips.get(holiday);
      if (holidayCounts && holidayCounts.length > 0) {
        const holidayAvg = holidayCounts.reduce((s, v) => s + v, 0) / holidayCounts.length;
        if (baseDailyAvg > 0) {
          const factor = holidayAvg / baseDailyAvg;
          if (Math.abs(factor - 1.0) > 0.2) {
            specialDates.push({
              date: holiday,
              factor: Math.round(factor * 100) / 100,
              label: `Holiday (${holiday})`,
            });
          }
        }
      }
    }

    return {
      dayOfWeekFactors,
      hourOfDayFactors,
      weekOfMonthFactors,
      specialDates,
      baseDailyAvg: Math.round(baseDailyAvg * 10) / 10,
      dataPoints: totalTrips,
    };
  });
}

// ─── Demand Prediction (Seasonal Decomposition + Trend) ──────────────────────

/**
 * Predict demand for a city on a given date (and optionally a specific hour).
 *
 * Combines:
 * 1. Base daily average from seasonal pattern
 * 2. Day-of-week seasonal factor
 * 3. Hour-of-day factor (if hour specified)
 * 4. Week-of-month factor
 * 5. Recent trend: 7-day moving avg vs 30-day moving avg
 * 6. Special date adjustments (holidays, first-of-month)
 *
 * Returns a prediction with confidence interval and explanatory factors.
 */
export async function predictDemand(
  companyId: number,
  cityId: number,
  date: string,
  hour?: number,
): Promise<ZoneDemand[]> {
  const cacheKey = `${CACHE_PREFIX}:demand:${companyId}:${cityId}:${date}:${hour ?? "all"}`;

  return cacheGetOrCompute(cacheKey, CACHE_TTL_SECONDS, async () => {
    const targetDate = new Date(date + "T12:00:00Z");
    const dow = dayOfWeekIndex(targetDate);

    // ── Step 1: Get seasonal pattern ──
    const pattern = await computeSeasonalPattern(cityId);

    // ── Step 2: Compute recent trend ──
    const trend = await computeRecentTrend(companyId, cityId, date);

    // ── Step 3: Zone-level prediction using historical same-weekday data ──
    const zoneDemands = await computeZoneLevelDemand(companyId, cityId, date, hour, pattern, trend);

    return zoneDemands;
  });
}

/**
 * Higher-level demand prediction returning a single aggregated forecast.
 * This is the main entry point for the dispatch dashboard.
 */
export async function predictCityDemand(
  cityId: number,
  date: string,
  hour?: number,
): Promise<DemandPrediction> {
  const cacheKey = `${CACHE_PREFIX}:city_demand:${cityId}:${date}:${hour ?? "all"}`;

  return cacheGetOrCompute(cacheKey, CACHE_TTL_SECONDS, async () => {
    const targetDate = new Date(date + "T12:00:00Z");
    const dow = dayOfWeekIndex(targetDate);
    const wom = weekOfMonth(targetDate) - 1;
    const mmdd = getMMDD(date);

    const pattern = await computeSeasonalPattern(cityId);
    const trend = await computeRecentTrend(0, cityId, date); // companyId=0 means all companies

    const factors: string[] = [];

    // Start with base daily average
    let predicted = pattern.baseDailyAvg;

    // Apply day-of-week factor
    const dowFactor = pattern.dayOfWeekFactors[dow] || 1.0;
    predicted *= dowFactor;
    const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    if (Math.abs(dowFactor - 1.0) > 0.05) {
      factors.push(`${dayNames[dow]}: ${dowFactor > 1 ? "+" : ""}${Math.round((dowFactor - 1) * 100)}%`);
    }

    // Apply week-of-month factor
    const womFactor = pattern.weekOfMonthFactors[wom] || 1.0;
    predicted *= womFactor;
    if (Math.abs(womFactor - 1.0) > 0.05) {
      factors.push(`Week ${wom + 1} of month: ${womFactor > 1 ? "+" : ""}${Math.round((womFactor - 1) * 100)}%`);
    }

    // Apply hour-of-day factor if specified
    if (hour !== undefined) {
      const hourFactor = pattern.hourOfDayFactors[hour] || 1.0;
      // For hourly prediction, divide daily total by operating hours then multiply by hour factor
      const operatingHours = OPERATING_END - OPERATING_START + 1;
      predicted = (predicted / operatingHours) * hourFactor;
      if (Math.abs(hourFactor - 1.0) > 0.1) {
        factors.push(`Hour ${hour}: ${hourFactor > 1 ? "+" : ""}${Math.round((hourFactor - 1) * 100)}%`);
      }
    }

    // Apply recent trend
    predicted *= trend.trendMultiplier;
    if (Math.abs(trend.trendMultiplier - 1.0) > 0.03) {
      factors.push(`Recent trend: ${trend.trendMultiplier > 1 ? "+" : ""}${Math.round((trend.trendMultiplier - 1) * 100)}%`);
    }

    // Apply special date adjustments
    for (const special of pattern.specialDates) {
      if (special.date === mmdd || (special.date === "XX-01" && isFirstOfMonth(date))) {
        predicted *= special.factor;
        factors.push(`${special.label}: ${special.factor > 1 ? "+" : ""}${Math.round((special.factor - 1) * 100)}%`);
      }
    }

    // Check holidays that aren't in the data yet
    if (FEDERAL_HOLIDAYS.includes(mmdd) && !pattern.specialDates.some(s => s.date === mmdd)) {
      predicted *= 0.6; // Default: holidays have ~40% less demand
      factors.push("Holiday (estimated -40%)");
    }

    // Compute confidence
    const confidence = computeConfidence(pattern, trend);

    if (factors.length === 0) {
      factors.push("Based on historical average");
    }

    return {
      predicted: Math.round(predicted * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
      factors,
    };
  });
}

// ─── Driver Need Prediction ──────────────────────────────────────────────────

/**
 * Predict driver staffing needs per hour for a given city and date.
 *
 * Uses demand prediction for each operating hour, then estimates driver count
 * based on average trips-per-driver capacity (typically 4-6 trips/day,
 * varying by hour based on trip duration patterns).
 */
export async function predictDriverNeed(
  cityId: number,
  date: string,
): Promise<DriverNeedForecast> {
  const cacheKey = `${CACHE_PREFIX}:driver_need:${cityId}:${date}`;

  return cacheGetOrCompute(cacheKey, FORECAST_CACHE_TTL_SECONDS, async () => {
    const pattern = await computeSeasonalPattern(cityId);
    const targetDate = new Date(date + "T12:00:00Z");
    const dow = dayOfWeekIndex(targetDate);
    const wom = weekOfMonth(targetDate) - 1;
    const mmdd = getMMDD(date);

    const hourly: HourlyDriverNeed[] = [];
    let totalPredictedTrips = 0;
    let peakHour = 0;
    let peakTrips = 0;

    // Compute predicted trips for each operating hour
    for (let h = OPERATING_START; h <= OPERATING_END; h++) {
      const prediction = await predictCityDemand(cityId, date, h);
      const predictedTrips = prediction.predicted;

      // Estimate drivers needed: each driver can handle ~1 trip per hour
      // (accounting for pickup, transport, dropoff, and repositioning)
      // During peak hours with shorter trips, ratio can be higher
      const tripsPerDriverPerHour = getTripsPerDriverEstimate(h);
      const recommendedDrivers = Math.max(1, Math.ceil(predictedTrips / tripsPerDriverPerHour));

      const isPeak = predictedTrips > pattern.baseDailyAvg / (OPERATING_END - OPERATING_START + 1) * 1.3;

      hourly.push({
        hour: h,
        predictedTrips: Math.round(predictedTrips * 10) / 10,
        recommendedDrivers,
        isPeak,
      });

      totalPredictedTrips += predictedTrips;

      if (predictedTrips > peakTrips) {
        peakTrips = predictedTrips;
        peakHour = h;
      }
    }

    return {
      date,
      cityId,
      totalPredictedTrips: Math.round(totalPredictedTrips * 10) / 10,
      peakHour,
      peakTrips: Math.round(peakTrips * 10) / 10,
      hourly,
    };
  });
}

// ─── Internal: Recent Trend Computation ──────────────────────────────────────

interface TrendResult {
  trendMultiplier: number;
  direction: "rising" | "stable" | "declining";
  recentAvg: number;
  baselineAvg: number;
}

async function computeRecentTrend(
  companyId: number,
  cityId: number,
  targetDate: string,
): Promise<TrendResult> {
  const target = new Date(targetDate + "T12:00:00Z");

  // 7-day window: recent activity
  const recent7Start = new Date(target);
  recent7Start.setDate(recent7Start.getDate() - 7);
  const recent7StartStr = recent7Start.toISOString().slice(0, 10);

  // 30-day window: baseline
  const baseline30Start = new Date(target);
  baseline30Start.setDate(baseline30Start.getDate() - 30);
  const baseline30StartStr = baseline30Start.toISOString().slice(0, 10);

  const targetStr = new Date(target.getTime() - 86400000).toISOString().slice(0, 10); // yesterday

  const baseConditions = [
    eq(trips.cityId, cityId),
    sql`${trips.status} NOT IN ('CANCELLED', 'NO_SHOW')`,
    isNull(trips.deletedAt),
  ];

  if (companyId > 0) {
    baseConditions.push(eq(trips.companyId, companyId));
  }

  // Get daily trip counts for last 30 days
  const dailyCounts = await db
    .select({
      scheduledDate: trips.scheduledDate,
      count: sql<number>`count(*)::int`,
    })
    .from(trips)
    .where(
      and(
        ...baseConditions,
        gte(trips.scheduledDate, baseline30StartStr),
        lte(trips.scheduledDate, targetStr),
      ),
    )
    .groupBy(trips.scheduledDate);

  const countMap = new Map(dailyCounts.map(r => [r.scheduledDate, r.count]));

  // Calculate 7-day average
  let recent7Sum = 0;
  let recent7Count = 0;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(target);
    d.setDate(d.getDate() - i);
    const dStr = d.toISOString().slice(0, 10);
    const c = countMap.get(dStr) || 0;
    recent7Sum += c;
    recent7Count++;
  }
  const recentAvg = recent7Count > 0 ? recent7Sum / recent7Count : 0;

  // Calculate 30-day average
  let baseline30Sum = 0;
  let baseline30Count = 0;
  for (let i = 1; i <= 30; i++) {
    const d = new Date(target);
    d.setDate(d.getDate() - i);
    const dStr = d.toISOString().slice(0, 10);
    const c = countMap.get(dStr) || 0;
    baseline30Sum += c;
    baseline30Count++;
  }
  const baselineAvg = baseline30Count > 0 ? baseline30Sum / baseline30Count : 0;

  // Trend multiplier: clamp between 0.7 and 1.4 to avoid wild swings
  let trendMultiplier = 1.0;
  if (baselineAvg > 0) {
    trendMultiplier = recentAvg / baselineAvg;
    trendMultiplier = Math.max(0.7, Math.min(1.4, trendMultiplier));
  }

  let direction: "rising" | "stable" | "declining" = "stable";
  if (trendMultiplier > 1.1) direction = "rising";
  else if (trendMultiplier < 0.9) direction = "declining";

  return {
    trendMultiplier: Math.round(trendMultiplier * 100) / 100,
    direction,
    recentAvg: Math.round(recentAvg * 10) / 10,
    baselineAvg: Math.round(baselineAvg * 10) / 10,
  };
}

// ─── Internal: Zone-Level Demand ─────────────────────────────────────────────

async function computeZoneLevelDemand(
  companyId: number,
  cityId: number,
  date: string,
  hour: number | undefined,
  pattern: SeasonalPattern,
  trend: TrendResult,
): Promise<ZoneDemand[]> {
  const targetDate = new Date(date + "T12:00:00Z");
  const dow = dayOfWeekIndex(targetDate);

  // Look back N weeks for same day-of-week (for zone-level spatial distribution)
  const historicalDates: string[] = [];
  for (let w = 1; w <= LOOKBACK_WEEKS; w++) {
    const d = new Date(targetDate);
    d.setDate(d.getDate() - w * 7);
    historicalDates.push(d.toISOString().slice(0, 10));
  }

  const conditions: any[] = [
    eq(trips.companyId, companyId),
    eq(trips.cityId, cityId),
    sql`${trips.scheduledDate} = ANY(${historicalDates})`,
    sql`${trips.status} NOT IN ('CANCELLED', 'NO_SHOW')`,
    isNull(trips.deletedAt),
  ];

  if (hour !== undefined) {
    const hourStr = hour.toString().padStart(2, "0");
    conditions.push(sql`${trips.pickupTime} >= ${hourStr + ":00"}`);
    conditions.push(sql`${trips.pickupTime} < ${(hour + 1).toString().padStart(2, "0") + ":00"}`);
  }

  const historicalTrips = await db
    .select({
      pickupLat: trips.pickupLat,
      pickupLng: trips.pickupLng,
      scheduledDate: trips.scheduledDate,
    })
    .from(trips)
    .where(and(...conditions));

  // Group by zone and by date
  const zoneWeekMap = new Map<string, Map<string, number>>();

  for (const t of historicalTrips) {
    if (!t.pickupLat || !t.pickupLng) continue;
    const key = zoneKey(t.pickupLat, t.pickupLng);
    if (!zoneWeekMap.has(key)) {
      zoneWeekMap.set(key, new Map());
    }
    const weekMap = zoneWeekMap.get(key)!;
    weekMap.set(t.scheduledDate, (weekMap.get(t.scheduledDate) || 0) + 1);
  }

  // Get seasonal multipliers for this date
  const wom = weekOfMonth(targetDate) - 1;
  const dowFactor = pattern.dayOfWeekFactors[dow] || 1.0;
  const womFactor = pattern.weekOfMonthFactors[wom] || 1.0;
  const hourFactor = hour !== undefined ? (pattern.hourOfDayFactors[hour] || 1.0) : 1.0;

  // Combined seasonal adjustment (normalize so it doesn't double-count)
  // The historical same-weekday data already captures DOW effect,
  // so we only apply WOM and trend adjustments on top
  const adjustmentFactor = womFactor * trend.trendMultiplier;

  // Special date adjustment
  let specialFactor = 1.0;
  const mmdd = getMMDD(date);
  for (const special of pattern.specialDates) {
    if (special.date === mmdd || (special.date === "XX-01" && isFirstOfMonth(date))) {
      specialFactor *= special.factor;
    }
  }

  const result: ZoneDemand[] = [];

  for (const [key, weekMap] of zoneWeekMap) {
    const center = zoneCenter(key);

    // Build weekly values array — most-recent-first for weighted average
    const weeklyValues: number[] = [];
    for (const dateStr of historicalDates) {
      weeklyValues.push(weekMap.get(dateStr) || 0);
    }

    // Use weighted average with recency bias (more weight on recent weeks)
    const predicted = weightedRecencyAverage(weeklyValues) * adjustmentFactor * specialFactor;
    const trendDir = trend.direction;

    // Confidence based on data coverage, consistency, and pattern strength
    const weeksWithData = weeklyValues.filter(v => v > 0).length;
    const dataCoverage = weeksWithData / LOOKBACK_WEEKS;
    const mean = weeklyValues.reduce((s, v) => s + v, 0) / weeklyValues.length;
    const variance = mean > 0
      ? weeklyValues.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / weeklyValues.length / (mean * mean)
      : 1;
    const consistencyScore = Math.max(0, 1 - Math.sqrt(variance));
    // Bonus confidence if pattern has many data points
    const patternBonus = Math.min(0.1, pattern.dataPoints / 10000);
    const confidence = Math.min(1, Math.round((dataCoverage * 0.5 + consistencyScore * 0.35 + patternBonus + 0.05) * 100) / 100);

    result.push({
      zone: key,
      lat: center.lat,
      lng: center.lng,
      predictedTrips: Math.round(predicted * 10) / 10,
      confidence,
      trend: trendDir,
    });
  }

  result.sort((a, b) => b.predictedTrips - a.predictedTrips);
  return result;
}

/**
 * Weighted recency average — linearly decreasing weights from most recent to oldest.
 * More robust than EWMA for small sample sizes common in zone-level data.
 */
function weightedRecencyAverage(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < values.length; i++) {
    // Linear weights: most recent gets highest weight
    const weight = values.length - i;
    numerator += weight * values[i];
    denominator += weight;
  }

  return denominator > 0 ? numerator / denominator : 0;
}

function computeConfidence(pattern: SeasonalPattern, trend: TrendResult): number {
  // More historical data = higher confidence
  const dataCoverage = Math.min(1, pattern.dataPoints / 500); // 500+ trips = full confidence from data
  // Stable trends are more predictable
  const trendStability = trend.direction === "stable" ? 1.0 : 0.85;
  // If base daily avg is very low, predictions are less reliable
  const volumeConfidence = Math.min(1, pattern.baseDailyAvg / 5);

  return Math.round((dataCoverage * 0.4 + trendStability * 0.3 + volumeConfidence * 0.3) * 100) / 100;
}

/**
 * Estimate how many trips a driver can handle per hour.
 * Morning and evening rush: shorter availability gaps, so lower ratio.
 * Mid-day: more flexible, can handle slightly more.
 */
function getTripsPerDriverEstimate(hour: number): number {
  if (hour >= 7 && hour <= 9) return 0.8;   // Morning rush — appointment pickups
  if (hour >= 15 && hour <= 17) return 0.8;  // Afternoon rush — return trips
  if (hour >= 10 && hour <= 14) return 1.0;  // Mid-day
  return 0.6; // Early morning / evening — longer distances, less volume
}

// ─── Heatmap & Driver Positioning (retained, now use enhanced predictions) ───

/**
 * Generate heatmap data for demand visualization.
 */
export async function getDemandHeatmap(
  companyId: number,
  cityId: number,
  date: string,
): Promise<HeatmapPoint[]> {
  const cacheKey = `${CACHE_PREFIX}:heatmap:${companyId}:${cityId}:${date}`;

  return cacheGetOrCompute(cacheKey, CACHE_TTL_SECONDS, async () => {
    // Get demand predictions for each operating hour
    const allDemands: ZoneDemand[] = [];
    for (let h = OPERATING_START; h <= OPERATING_END; h++) {
      const hourDemand = await predictDemand(companyId, cityId, date, h);
      allDemands.push(...hourDemand);
    }

    // Aggregate by zone
    const zoneAgg = new Map<string, { lat: number; lng: number; totalDemand: number }>();
    for (const d of allDemands) {
      const existing = zoneAgg.get(d.zone);
      if (existing) {
        existing.totalDemand += d.predictedTrips;
      } else {
        zoneAgg.set(d.zone, { lat: d.lat, lng: d.lng, totalDemand: d.predictedTrips });
      }
    }

    // Normalize intensity to 0-1 range
    const maxDemand = Math.max(...Array.from(zoneAgg.values()).map(z => z.totalDemand), 1);

    const heatmap: HeatmapPoint[] = Array.from(zoneAgg.values()).map(z => ({
      lat: z.lat,
      lng: z.lng,
      intensity: Math.round((z.totalDemand / maxDemand) * 100) / 100,
    }));

    heatmap.sort((a, b) => b.intensity - a.intensity);
    return heatmap;
  });
}

/**
 * Suggest optimal positioning for idle drivers based on predicted demand.
 */
export async function getOptimalDriverPositioning(
  companyId: number,
  cityId: number,
  date: string,
  hour: number,
): Promise<DriverPosition[]> {
  const cacheKey = `${CACHE_PREFIX}:positioning:${companyId}:${cityId}:${date}:${hour}`;

  return cacheGetOrCompute(cacheKey, CACHE_TTL_SECONDS, async () => {
    const demand = await predictDemand(companyId, cityId, date, hour);

    const availableDrivers = await db
      .select({ id: drivers.id })
      .from(drivers)
      .where(
        and(
          eq(drivers.companyId, companyId),
          eq(drivers.cityId, cityId),
          eq(drivers.status, "ACTIVE"),
          sql`${drivers.dispatchStatus} IN ('available', 'off')`,
          isNull(drivers.deletedAt),
        ),
      );

    const totalDrivers = availableDrivers.length;
    if (totalDrivers === 0 || demand.length === 0) {
      return [];
    }

    // Weight demand by trend
    const trendMultiplier = (trend: string) => {
      switch (trend) {
        case "rising": return 1.2;
        case "declining": return 0.8;
        default: return 1.0;
      }
    };

    const weightedDemand = demand.map(d => ({
      ...d,
      weightedTrips: d.predictedTrips * trendMultiplier(d.trend),
    }));

    const totalWeightedDemand = weightedDemand.reduce((s, d) => s + d.weightedTrips, 0);
    if (totalWeightedDemand === 0) return [];

    const positions: DriverPosition[] = [];
    let driversAssigned = 0;

    for (const zone of weightedDemand) {
      if (driversAssigned >= totalDrivers) break;

      const proportion = zone.weightedTrips / totalWeightedDemand;
      const recommended = Math.max(1, Math.round(proportion * totalDrivers));
      const actual = Math.min(recommended, totalDrivers - driversAssigned);

      const trendLabel = zone.trend === "rising"
        ? " (trending up)"
        : zone.trend === "declining"
          ? " (trending down)"
          : "";

      positions.push({
        zone: zone.zone,
        lat: zone.lat,
        lng: zone.lng,
        recommendedDrivers: actual,
        reason: `${zone.predictedTrips} predicted trips (${Math.round(proportion * 100)}% of demand)${trendLabel}`,
      });

      driversAssigned += actual;
    }

    return positions;
  });
}

// ─── Pre-compute Forecasts Scheduler ─────────────────────────────────────────

/**
 * Pre-compute demand forecasts for the next 7 days for all active cities.
 * Runs daily via the scheduler harness.
 */
async function runForecastPrecompute(): Promise<void> {
  const tag = "[DEMAND-FORECAST]";

  // Get all active cities
  const activeCities = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .where(eq(cities.active, true));

  if (activeCities.length === 0) {
    console.log(`${tag} No active cities, skipping forecast`);
    return;
  }

  const today = new Date();
  const forecastDays: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    forecastDays.push(d.toISOString().slice(0, 10));
  }

  let forecastsComputed = 0;

  for (const city of activeCities) {
    try {
      // Pre-compute seasonal pattern (cached for 1 hour)
      await computeSeasonalPattern(city.id);

      for (const dateStr of forecastDays) {
        // Pre-compute city-level demand
        const prediction = await predictCityDemand(city.id, dateStr);

        // Pre-compute driver need
        const driverNeed = await predictDriverNeed(city.id, dateStr);

        // Store the daily forecast in Redis / memory cache for API access
        const forecastKey = `${CACHE_PREFIX}:daily_forecast:${city.id}:${dateStr}`;
        const forecast: DailyForecast = {
          date: dateStr,
          cityId: city.id,
          companyId: 0, // aggregated across companies
          totalPredicted: prediction.predicted,
          confidence: prediction.confidence,
          peakHour: driverNeed.peakHour,
          peakTrips: driverNeed.peakTrips,
          factors: prediction.factors,
          hourly: driverNeed.hourly.map(h => ({
            hour: h.hour,
            predicted: h.predictedTrips,
          })),
        };

        try {
          await setJson(forecastKey, forecast, 86400); // Cache for 24 hours
        } catch {
          cache.set(forecastKey, forecast, 86400_000);
        }

        forecastsComputed++;
      }
    } catch (err: any) {
      console.error(`${tag} Error computing forecast for city ${city.id} (${city.name}):`, err.message);
    }
  }

  console.log(JSON.stringify({
    event: "demand_forecast_precompute_complete",
    cities: activeCities.length,
    days: forecastDays.length,
    forecastsComputed,
    ts: new Date().toISOString(),
  }));
}

/**
 * Get pre-computed forecast for a city and date range.
 * Falls back to live computation if not pre-computed.
 */
export async function getDailyForecasts(
  cityId: number,
  startDate: string,
  endDate: string,
): Promise<DailyForecast[]> {
  const start = new Date(startDate + "T12:00:00Z");
  const end = new Date(endDate + "T12:00:00Z");
  const results: DailyForecast[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const cacheKey = `${CACHE_PREFIX}:daily_forecast:${cityId}:${dateStr}`;

    // Try cached forecast first
    let forecast: DailyForecast | null = null;
    try {
      forecast = await getJson<DailyForecast>(cacheKey);
    } catch {
      forecast = cache.get<DailyForecast>(cacheKey);
    }

    if (!forecast) {
      // Compute on-demand
      const prediction = await predictCityDemand(cityId, dateStr);
      const driverNeed = await predictDriverNeed(cityId, dateStr);
      forecast = {
        date: dateStr,
        cityId,
        companyId: 0,
        totalPredicted: prediction.predicted,
        confidence: prediction.confidence,
        peakHour: driverNeed.peakHour,
        peakTrips: driverNeed.peakTrips,
        factors: prediction.factors,
        hourly: driverNeed.hourly.map(h => ({
          hour: h.hour,
          predicted: h.predictedTrips,
        })),
      };
    }

    results.push(forecast);
  }

  return results;
}

// ─── Scheduler Registration ──────────────────────────────────────────────────

let forecastTask: HarnessedTask | null = null;

export function startDemandForecastScheduler(): void {
  if (forecastTask) return;

  forecastTask = createHarnessedTask({
    name: "demand_forecast",
    lockKey: "scheduler:lock:demand_forecast",
    lockTtlSeconds: 120,
    timeoutMs: 300_000, // 5 min timeout
    fn: runForecastPrecompute,
  });

  // Run immediately on startup, then every 6 hours
  forecastTask.run().catch(err => {
    console.error("[DEMAND-FORECAST] Initial run error:", err.message);
  });

  const handle = setInterval(() => {
    forecastTask?.run().catch(err => {
      console.error("[DEMAND-FORECAST] Scheduled run error:", err.message);
    });
  }, 6 * 60 * 60 * 1000); // every 6 hours

  // Store handle so stopAllSchedulers can clean up
  (forecastTask as any)._intervalHandle = handle;
}

export function stopDemandForecastScheduler(): void {
  if (forecastTask) {
    const handle = (forecastTask as any)._intervalHandle;
    if (handle) clearInterval(handle);
    forecastTask.stop();
    forecastTask = null;
  }
}
