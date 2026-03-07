import { db } from "../db";
import { trips, drivers, clinics, cities } from "@shared/schema";
import { eq, and, gte, lte, isNull, isNotNull, sql, count } from "drizzle-orm";

const GRACE_MINUTES = 10;

interface PredictionInput {
  dateFrom: string;
  dateTo: string;
  scope?: "general" | "state" | "city";
  state?: string;
  city?: string;
}

interface LateRiskTrip {
  tripId: number;
  publicId: string;
  scheduledDate: string;
  pickupTime: string;
  riskScore: number;
  riskLabel: "green" | "yellow" | "red";
  reasons: string[];
  clinicName: string;
  driverName: string;
  cityName: string;
}

interface StaffingDay {
  date: string;
  scheduledTrips: number;
  availableDrivers: number;
  ratio: number;
  riskLevel: "low" | "moderate" | "high" | "critical";
  forecast: string;
}

interface PredictionResult {
  lateRisk: {
    summaryRed: number;
    summaryYellow: number;
    summaryGreen: number;
    riskyTrips: LateRiskTrip[];
  };
  staffingRisk: {
    days: StaffingDay[];
    overallRisk: "low" | "moderate" | "high" | "critical";
    shortageCount: number;
    recommendation: string;
  };
}

export async function computePredictions(input: PredictionInput): Promise<PredictionResult> {
  const scopeConditions: any[] = [
    gte(trips.scheduledDate, input.dateFrom),
    lte(trips.scheduledDate, input.dateTo),
    isNull(trips.deletedAt),
  ];

  if (input.scope === "state" && input.state) {
    scopeConditions.push(
      sql`(${trips.cityId} IN (SELECT id FROM cities WHERE state = ${input.state})
        OR ${trips.clinicId} IN (SELECT id FROM clinics WHERE address_state = ${input.state}))`
    );
  } else if (input.scope === "city" && input.city) {
    const cityId = parseInt(input.city);
    if (!isNaN(cityId)) scopeConditions.push(eq(trips.cityId, cityId));
  }

  const upcomingTrips = await db
    .select({
      id: trips.id,
      publicId: trips.publicId,
      scheduledDate: trips.scheduledDate,
      scheduledTime: trips.scheduledTime,
      pickupTime: trips.pickupTime,
      status: trips.status,
      driverId: trips.driverId,
      clinicId: trips.clinicId,
      cityId: trips.cityId,
      pickupLat: trips.pickupLat,
      pickupLng: trips.pickupLng,
      dropoffLat: trips.dropoffLat,
      dropoffLng: trips.dropoffLng,
    })
    .from(trips)
    .where(and(...scopeConditions));

  const allDrivers = await db
    .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName, status: drivers.status })
    .from(drivers)
    .where(eq(drivers.status, "ACTIVE"));

  const allClinics = await db
    .select({ id: clinics.id, name: clinics.name })
    .from(clinics);
  const clinicMap = new Map(allClinics.map((c) => [c.id, c.name]));

  const allCities = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities);
  const cityMap = new Map(allCities.map((c) => [c.id, c.name]));

  const driverMap = new Map(allDrivers.map((d) => [d.id, `${d.firstName} ${d.lastName}`]));

  const riskyTrips: LateRiskTrip[] = [];

  for (const t of upcomingTrips) {
    if (t.status === "COMPLETED" || t.status === "CANCELLED" || t.status === "NO_SHOW") continue;

    const reasons: string[] = [];
    let riskScore = 0;

    if (!t.driverId) {
      reasons.push("No driver assigned");
      riskScore += 40;
    }

    if (t.pickupLat && t.pickupLng && t.dropoffLat && t.dropoffLng) {
      const dist = haversineDistance(t.pickupLat, t.pickupLng, t.dropoffLat, t.dropoffLng);
      if (dist > 50) {
        reasons.push(`Long distance (${dist.toFixed(1)} mi)`);
        riskScore += 20;
      }
    }

    const timeStr = t.scheduledTime || t.pickupTime;
    if (timeStr) {
      const [h] = timeStr.split(":").map(Number);
      if (h < 7 || h > 18) {
        reasons.push("Off-peak hours");
        riskScore += 10;
      }
    }

    if (riskScore > 0) {
      const riskLabel: "green" | "yellow" | "red" = riskScore >= 50 ? "red" : riskScore >= 30 ? "yellow" : "green";
      riskyTrips.push({
        tripId: t.id,
        publicId: t.publicId,
        scheduledDate: t.scheduledDate,
        pickupTime: t.scheduledTime || t.pickupTime || "N/A",
        riskScore: Math.min(100, riskScore),
        riskLabel,
        reasons,
        clinicName: clinicMap.get(t.clinicId || 0) || "Unknown",
        driverName: t.driverId ? driverMap.get(t.driverId) || "Unknown" : "Unassigned",
        cityName: cityMap.get(t.cityId) || "Unknown",
      });
    }
  }

  riskyTrips.sort((a, b) => b.riskScore - a.riskScore);

  const tripsByDate = new Map<string, number>();
  for (const t of upcomingTrips) {
    if (t.status !== "COMPLETED" && t.status !== "CANCELLED" && t.status !== "NO_SHOW") {
      tripsByDate.set(t.scheduledDate, (tripsByDate.get(t.scheduledDate) || 0) + 1);
    }
  }

  const activeDriverCount = allDrivers.length;
  const days: StaffingDay[] = [];
  let shortageCount = 0;

  const sortedDates = Array.from(tripsByDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  for (const [date, tripCount] of sortedDates) {
    const ratio = activeDriverCount > 0 ? tripCount / activeDriverCount : tripCount;
    let riskLevel: StaffingDay["riskLevel"] = "low";
    let forecast = "Staffing adequate";

    if (ratio > 3) {
      riskLevel = "critical";
      forecast = "Critical understaffing - immediate attention needed";
      shortageCount++;
    } else if (ratio > 2) {
      riskLevel = "high";
      forecast = "High load - consider additional drivers";
      shortageCount++;
    } else if (ratio > 1.5) {
      riskLevel = "moderate";
      forecast = "Moderate load - monitor closely";
    }

    days.push({
      date,
      scheduledTrips: tripCount,
      availableDrivers: activeDriverCount,
      ratio: Math.round(ratio * 100) / 100,
      riskLevel,
      forecast,
    });
  }

  const overallRisk: StaffingDay["riskLevel"] = shortageCount > 2 ? "critical" : shortageCount > 0 ? "high" : days.some((d) => d.riskLevel === "moderate") ? "moderate" : "low";

  return {
    lateRisk: {
      summaryRed: riskyTrips.filter((t) => t.riskLabel === "red").length,
      summaryYellow: riskyTrips.filter((t) => t.riskLabel === "yellow").length,
      summaryGreen: riskyTrips.filter((t) => t.riskLabel === "green").length,
      riskyTrips: riskyTrips.slice(0, 20),
    },
    staffingRisk: {
      days: days.slice(0, 14),
      overallRisk,
      shortageCount,
      recommendation: shortageCount > 0 ? `${shortageCount} days with staffing concerns in the period` : "Staffing levels adequate for the forecast period",
    },
  };
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
