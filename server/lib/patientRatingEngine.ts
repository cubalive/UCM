import crypto from "crypto";
import { db } from "../db";
import { patientRatings, trips, patients, drivers } from "@shared/schema";
import { eq, and, gte, lte, sql, desc, count } from "drizzle-orm";
import { sendSms } from "./twilioSms";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RatingData {
  overallRating: number;
  punctualityRating?: number | null;
  driverRating?: number | null;
  vehicleRating?: number | null;
  safetyRating?: number | null;
  comment?: string | null;
  tags?: string[] | null;
  anonymous?: boolean;
}

export interface DriverRatingSummary {
  driverId: number;
  averageOverall: number;
  averagePunctuality: number | null;
  averageDriver: number | null;
  averageVehicle: number | null;
  averageSafety: number | null;
  totalCount: number;
  distribution: Record<number, number>;
}

export interface CompanyRatingSummary {
  companyId: number;
  averageOverall: number;
  totalCount: number;
  distribution: Record<number, number>;
}

export interface CityRatingSummary {
  cityId: number;
  averageOverall: number;
  totalCount: number;
  distribution: Record<number, number>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  return (
    process.env.PUBLIC_BASE_URL_APP ||
    process.env.PUBLIC_BASE_URL ||
    (process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "https://app.unitedcaremobility.com")
  );
}

function validateRatingValue(value: number | null | undefined, field: string): void {
  if (value != null && (value < 1 || value > 5 || !Number.isInteger(value))) {
    throw new Error(`${field} must be an integer between 1 and 5`);
  }
}

function validateRatingData(data: RatingData): void {
  validateRatingValue(data.overallRating, "overallRating");
  validateRatingValue(data.punctualityRating, "punctualityRating");
  validateRatingValue(data.driverRating, "driverRating");
  validateRatingValue(data.vehicleRating, "vehicleRating");
  validateRatingValue(data.safetyRating, "safetyRating");

  if (data.comment && data.comment.length > 2000) {
    throw new Error("Comment must not exceed 2000 characters");
  }

  const validTags = ["friendly", "clean_vehicle", "helpful", "on_time", "comfortable"];
  if (data.tags) {
    for (const tag of data.tags) {
      if (!validTags.includes(tag)) {
        throw new Error(`Invalid tag: ${tag}. Valid tags: ${validTags.join(", ")}`);
      }
    }
  }
}

async function buildDistribution(
  condition: ReturnType<typeof eq> | ReturnType<typeof and>,
): Promise<Record<number, number>> {
  const rows = await db
    .select({
      rating: patientRatings.overallRating,
      cnt: count(),
    })
    .from(patientRatings)
    .where(condition)
    .groupBy(patientRatings.overallRating);

  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of rows) {
    dist[row.rating] = Number(row.cnt);
  }
  return dist;
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Generate a unique token-based rating link for a completed trip.
 * Token expires in 7 days.
 */
export async function generateRatingLink(tripId: number): Promise<{ token: string; url: string }> {
  const trip = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  if (!trip.length) {
    throw new Error(`Trip ${tripId} not found`);
  }
  const t = trip[0];

  if (t.status !== "COMPLETED") {
    throw new Error(`Trip ${tripId} is not completed (status: ${t.status})`);
  }

  if (!t.driverId) {
    throw new Error(`Trip ${tripId} has no driver assigned`);
  }

  // Check if a rating already exists for this trip
  const existing = await db
    .select({ id: patientRatings.id })
    .from(patientRatings)
    .where(eq(patientRatings.tripId, tripId))
    .limit(1);
  if (existing.length) {
    throw new Error(`Rating already exists for trip ${tripId}`);
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Pre-insert a placeholder row with the token so we can validate on submit
  await db.insert(patientRatings).values({
    tripId: t.id,
    patientId: t.patientId,
    driverId: t.driverId,
    companyId: t.companyId,
    cityId: t.cityId,
    overallRating: 0, // placeholder - will be updated on submit
    source: "sms_link",
    ratingToken: token,
    tokenExpiresAt,
  });

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/rate/${token}`;

  console.log(`[RATING] Generated rating link for trip ${tripId}: token=${token.slice(0, 8)}...`);
  return { token, url };
}

/**
 * Submit a rating via a public token (no auth required).
 */
export async function submitRating(
  token: string,
  ratingData: RatingData,
): Promise<{ success: boolean; ratingId: number }> {
  validateRatingData(ratingData);

  const rows = await db
    .select()
    .from(patientRatings)
    .where(eq(patientRatings.ratingToken, token))
    .limit(1);

  if (!rows.length) {
    throw new Error("Invalid or expired rating token");
  }

  const rating = rows[0];

  if (rating.tokenExpiresAt && rating.tokenExpiresAt < new Date()) {
    throw new Error("Rating token has expired");
  }

  // If overallRating is non-zero, rating was already submitted
  if (rating.overallRating > 0) {
    throw new Error("Rating has already been submitted for this trip");
  }

  const [updated] = await db
    .update(patientRatings)
    .set({
      overallRating: ratingData.overallRating,
      punctualityRating: ratingData.punctualityRating ?? null,
      driverRating: ratingData.driverRating ?? null,
      vehicleRating: ratingData.vehicleRating ?? null,
      safetyRating: ratingData.safetyRating ?? null,
      comment: ratingData.comment ?? null,
      tags: ratingData.tags ?? null,
      anonymous: ratingData.anonymous ?? false,
      ratingToken: null, // Clear the token after use
      tokenExpiresAt: null,
    })
    .where(eq(patientRatings.id, rating.id))
    .returning({ id: patientRatings.id });

  console.log(`[RATING] Token-based rating submitted for trip ${rating.tripId}, ratingId=${updated.id}`);
  return { success: true, ratingId: updated.id };
}

/**
 * Submit a rating via authenticated portal (requires tripId + patientId).
 */
export async function submitRatingAuthenticated(
  tripId: number,
  patientId: number,
  ratingData: RatingData,
  source: "app" | "portal" | "phone" = "portal",
): Promise<{ success: boolean; ratingId: number }> {
  validateRatingData(ratingData);

  const trip = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  if (!trip.length) {
    throw new Error(`Trip ${tripId} not found`);
  }
  const t = trip[0];

  if (t.status !== "COMPLETED") {
    throw new Error(`Trip ${tripId} is not completed`);
  }

  if (t.patientId !== patientId) {
    throw new Error("Patient does not match this trip");
  }

  if (!t.driverId) {
    throw new Error(`Trip ${tripId} has no driver assigned`);
  }

  // Check if rating already exists (might be a placeholder from token generation)
  const existing = await db
    .select()
    .from(patientRatings)
    .where(eq(patientRatings.tripId, tripId))
    .limit(1);

  if (existing.length) {
    // If already submitted (overallRating > 0), reject
    if (existing[0].overallRating > 0) {
      throw new Error("Rating already submitted for this trip");
    }
    // Update the placeholder
    const [updated] = await db
      .update(patientRatings)
      .set({
        overallRating: ratingData.overallRating,
        punctualityRating: ratingData.punctualityRating ?? null,
        driverRating: ratingData.driverRating ?? null,
        vehicleRating: ratingData.vehicleRating ?? null,
        safetyRating: ratingData.safetyRating ?? null,
        comment: ratingData.comment ?? null,
        tags: ratingData.tags ?? null,
        anonymous: ratingData.anonymous ?? false,
        source,
        ratingToken: null,
        tokenExpiresAt: null,
      })
      .where(eq(patientRatings.id, existing[0].id))
      .returning({ id: patientRatings.id });

    console.log(`[RATING] Authenticated rating submitted for trip ${tripId}, ratingId=${updated.id}`);
    return { success: true, ratingId: updated.id };
  }

  // Insert new rating
  const [inserted] = await db
    .insert(patientRatings)
    .values({
      tripId: t.id,
      patientId: t.patientId,
      driverId: t.driverId,
      companyId: t.companyId,
      cityId: t.cityId,
      overallRating: ratingData.overallRating,
      punctualityRating: ratingData.punctualityRating ?? null,
      driverRating: ratingData.driverRating ?? null,
      vehicleRating: ratingData.vehicleRating ?? null,
      safetyRating: ratingData.safetyRating ?? null,
      comment: ratingData.comment ?? null,
      tags: ratingData.tags ?? null,
      anonymous: ratingData.anonymous ?? false,
      source,
    })
    .returning({ id: patientRatings.id });

  console.log(`[RATING] Authenticated rating inserted for trip ${tripId}, ratingId=${inserted.id}`);
  return { success: true, ratingId: inserted.id };
}

/**
 * Get aggregated rating summary for a driver.
 */
export async function getDriverRatingSummary(driverId: number): Promise<DriverRatingSummary> {
  const condition = and(
    eq(patientRatings.driverId, driverId),
    sql`${patientRatings.overallRating} > 0`,
  );

  const [agg] = await db
    .select({
      avgOverall: sql<number>`coalesce(avg(${patientRatings.overallRating}), 0)`,
      avgPunctuality: sql<number | null>`avg(${patientRatings.punctualityRating})`,
      avgDriver: sql<number | null>`avg(${patientRatings.driverRating})`,
      avgVehicle: sql<number | null>`avg(${patientRatings.vehicleRating})`,
      avgSafety: sql<number | null>`avg(${patientRatings.safetyRating})`,
      totalCount: count(),
    })
    .from(patientRatings)
    .where(condition);

  const distribution = await buildDistribution(condition!);

  return {
    driverId,
    averageOverall: Math.round(Number(agg.avgOverall) * 100) / 100,
    averagePunctuality: agg.avgPunctuality ? Math.round(Number(agg.avgPunctuality) * 100) / 100 : null,
    averageDriver: agg.avgDriver ? Math.round(Number(agg.avgDriver) * 100) / 100 : null,
    averageVehicle: agg.avgVehicle ? Math.round(Number(agg.avgVehicle) * 100) / 100 : null,
    averageSafety: agg.avgSafety ? Math.round(Number(agg.avgSafety) * 100) / 100 : null,
    totalCount: Number(agg.totalCount),
    distribution,
  };
}

/**
 * Get aggregated rating summary for a company.
 */
export async function getCompanyRatingSummary(companyId: number): Promise<CompanyRatingSummary> {
  const condition = and(
    eq(patientRatings.companyId, companyId),
    sql`${patientRatings.overallRating} > 0`,
  );

  const [agg] = await db
    .select({
      avgOverall: sql<number>`coalesce(avg(${patientRatings.overallRating}), 0)`,
      totalCount: count(),
    })
    .from(patientRatings)
    .where(condition);

  const distribution = await buildDistribution(condition!);

  return {
    companyId,
    averageOverall: Math.round(Number(agg.avgOverall) * 100) / 100,
    totalCount: Number(agg.totalCount),
    distribution,
  };
}

/**
 * Get aggregated rating summary for a city.
 */
export async function getCityRatingSummary(cityId: number): Promise<CityRatingSummary> {
  const condition = and(
    eq(patientRatings.cityId, cityId),
    sql`${patientRatings.overallRating} > 0`,
  );

  const [agg] = await db
    .select({
      avgOverall: sql<number>`coalesce(avg(${patientRatings.overallRating}), 0)`,
      totalCount: count(),
    })
    .from(patientRatings)
    .where(condition);

  const distribution = await buildDistribution(condition!);

  return {
    cityId,
    averageOverall: Math.round(Number(agg.avgOverall) * 100) / 100,
    totalCount: Number(agg.totalCount),
    distribution,
  };
}

/**
 * Auto-send a rating request SMS to the patient after trip completion.
 * Should be called when trip status transitions to COMPLETED.
 */
export async function autoSendRatingRequest(tripId: number): Promise<void> {
  try {
    const trip = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
    if (!trip.length) {
      console.warn(`[RATING] autoSend: trip ${tripId} not found`);
      return;
    }
    const t = trip[0];

    if (t.status !== "COMPLETED") {
      console.warn(`[RATING] autoSend: trip ${tripId} not completed, skipping`);
      return;
    }

    if (!t.driverId) {
      console.warn(`[RATING] autoSend: trip ${tripId} has no driver, skipping`);
      return;
    }

    const patient = await db.select().from(patients).where(eq(patients.id, t.patientId)).limit(1);
    if (!patient.length || !patient[0].phone) {
      console.warn(`[RATING] autoSend: trip ${tripId} patient has no phone, skipping`);
      return;
    }

    // Check if a rating already exists (with submitted data)
    const existingRating = await db
      .select({ id: patientRatings.id, overallRating: patientRatings.overallRating })
      .from(patientRatings)
      .where(eq(patientRatings.tripId, tripId))
      .limit(1);

    if (existingRating.length && existingRating[0].overallRating > 0) {
      console.log(`[RATING] autoSend: trip ${tripId} already has a rating, skipping`);
      return;
    }

    // Generate the rating link (this creates a placeholder row if not already present)
    let url: string;
    if (existingRating.length && existingRating[0].overallRating === 0) {
      // Placeholder already exists (e.g., link generated before), retrieve its token
      const row = await db
        .select({ ratingToken: patientRatings.ratingToken })
        .from(patientRatings)
        .where(eq(patientRatings.tripId, tripId))
        .limit(1);
      if (row[0]?.ratingToken) {
        url = `${getBaseUrl()}/rate/${row[0].ratingToken}`;
      } else {
        console.warn(`[RATING] autoSend: trip ${tripId} placeholder has no token, skipping`);
        return;
      }
    } else {
      const link = await generateRatingLink(tripId);
      url = link.url;
    }

    const message = `United Care Mobility: How was your ride? We'd love your feedback! Rate your trip: ${url}\nReply STOP to opt out.`;

    const result = await sendSms(patient[0].phone, message);
    if (result.success) {
      console.log(`[RATING] SMS rating request sent for trip ${tripId} to ***${patient[0].phone.slice(-4)}`);
    } else {
      console.warn(`[RATING] SMS rating request failed for trip ${tripId}: ${result.error}`);
    }
  } catch (err: any) {
    console.error(`[RATING] autoSendRatingRequest error for trip ${tripId}: ${err.message}`);
  }
}
