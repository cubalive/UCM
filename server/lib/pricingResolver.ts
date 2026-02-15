import { db } from "../db";
import { pricingProfiles, pricingRules } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface PricingRates {
  baseFareCents: number;
  perMileCents: number;
  minimumFareCents: number;
  maxFareCents: number;
  bufferPercent: number;
  peakSurchargePercent: number;
  wheelchairSurchargeCents: number;
  roundTripMultiplier: number;
  cancelFeeCents: number;
  noShowFeeCents: number;
  waitPerMinuteCents: number;
  peakStartHour1: number;
  peakEndHour1: number;
  peakStartHour2: number;
  peakEndHour2: number;
}

export const DEFAULT_RATES: PricingRates = {
  baseFareCents: 0,
  perMileCents: 250,
  minimumFareCents: 3500,
  maxFareCents: 75000,
  bufferPercent: 15,
  peakSurchargePercent: 15,
  wheelchairSurchargeCents: 1500,
  roundTripMultiplier: 1.85,
  cancelFeeCents: 2500,
  noShowFeeCents: 3500,
  waitPerMinuteCents: 50,
  peakStartHour1: 6,
  peakEndHour1: 9,
  peakStartHour2: 16,
  peakEndHour2: 19,
};

const RULE_KEY_MAP: Record<string, keyof PricingRates> = {
  base_fare_cents: "baseFareCents",
  per_mile_cents: "perMileCents",
  minimum_fare_cents: "minimumFareCents",
  max_fare_cents: "maxFareCents",
  buffer_percent: "bufferPercent",
  peak_surcharge_percent: "peakSurchargePercent",
  wheelchair_surcharge_cents: "wheelchairSurchargeCents",
  round_trip_multiplier: "roundTripMultiplier",
  cancel_fee_cents: "cancelFeeCents",
  no_show_fee_cents: "noShowFeeCents",
  wait_per_minute_cents: "waitPerMinuteCents",
  peak_start_hour_1: "peakStartHour1",
  peak_end_hour_1: "peakEndHour1",
  peak_start_hour_2: "peakStartHour2",
  peak_end_hour_2: "peakEndHour2",
};

export const ALL_RULE_KEYS = Object.keys(RULE_KEY_MAP);

export const RULE_LABELS: Record<string, string> = {
  base_fare_cents: "Base Fare (cents)",
  per_mile_cents: "Per Mile (cents)",
  minimum_fare_cents: "Minimum Fare (cents)",
  max_fare_cents: "Maximum Fare (cents)",
  buffer_percent: "Buffer %",
  peak_surcharge_percent: "Peak Surcharge %",
  wheelchair_surcharge_cents: "Wheelchair Surcharge (cents)",
  round_trip_multiplier: "Round Trip Multiplier",
  cancel_fee_cents: "Cancellation Fee (cents)",
  no_show_fee_cents: "No-Show Fee (cents)",
  wait_per_minute_cents: "Wait Time Per Minute (cents)",
  peak_start_hour_1: "Peak Window 1 Start Hour",
  peak_end_hour_1: "Peak Window 1 End Hour",
  peak_start_hour_2: "Peak Window 2 Start Hour",
  peak_end_hour_2: "Peak Window 2 End Hour",
};

function getDefaultForKey(key: string): number {
  const rateKey = RULE_KEY_MAP[key];
  if (rateKey && rateKey in DEFAULT_RATES) {
    return DEFAULT_RATES[rateKey];
  }
  return 0;
}

async function autoCreateDefaultProfile(cityName: string, userId?: number): Promise<number> {
  const [profile] = await db.insert(pricingProfiles).values({
    name: `Private Pay - ${cityName} Default`,
    city: cityName,
    isActive: true,
    appliesTo: "private",
    createdBy: userId || null,
    updatedBy: userId || null,
  }).returning();

  for (const key of ALL_RULE_KEYS) {
    await db.insert(pricingRules).values({
      profileId: profile.id,
      key,
      valueNumeric: String(getDefaultForKey(key)),
      enabled: true,
      updatedBy: userId || null,
    });
  }

  console.log(`[Pricing] Auto-created default profile for city=${cityName}, id=${profile.id}`);
  return profile.id;
}

export async function getActivePricingProfile(
  cityName: string,
  appliesTo: string = "private"
): Promise<{ profileId: number; profileName: string; rates: PricingRates; source: string }> {
  const profiles = await db.select().from(pricingProfiles)
    .where(and(
      eq(pricingProfiles.city, cityName),
      eq(pricingProfiles.appliesTo, appliesTo),
      eq(pricingProfiles.isActive, true)
    ));

  let profile = profiles[0];

  if (!profile) {
    const globalProfiles = await db.select().from(pricingProfiles)
      .where(and(
        eq(pricingProfiles.city, "ALL"),
        eq(pricingProfiles.appliesTo, appliesTo),
        eq(pricingProfiles.isActive, true)
      ));
    profile = globalProfiles[0];
  }

  if (!profile) {
    console.warn(`[Pricing] No profile found for city=${cityName}, appliesTo=${appliesTo}. Auto-creating default.`);
    const newId = await autoCreateDefaultProfile(cityName);
    const [created] = await db.select().from(pricingProfiles).where(eq(pricingProfiles.id, newId));
    profile = created;
  }

  const rules = await db.select().from(pricingRules)
    .where(and(eq(pricingRules.profileId, profile.id), eq(pricingRules.enabled, true)));

  const rates: PricingRates = { ...DEFAULT_RATES };

  for (const rule of rules) {
    const rateKey = RULE_KEY_MAP[rule.key];
    if (rateKey && rule.valueNumeric !== null && rule.valueNumeric !== undefined) {
      (rates as any)[rateKey] = parseFloat(String(rule.valueNumeric));
    }
  }

  return {
    profileId: profile.id,
    profileName: profile.name,
    rates,
    source: profile.city === "ALL" ? "global_default" : "city",
  };
}
