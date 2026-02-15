import { etaMinutes } from "./googleMaps";
import { getActivePricingProfile, DEFAULT_RATES, type PricingRates } from "./pricingResolver";

export interface PricingInput {
  pickupAddress: string;
  dropoffAddress: string;
  scheduledDate: string;
  scheduledTime: string;
  isWheelchair: boolean;
  roundTrip: boolean;
  passengers?: number;
  cityName?: string;
}

export interface PricingResult {
  baseMiles: number;
  baseMinutes: number;
  perMileCents: number;
  mileChargeCents: number;
  bufferMileCents: number;
  peakSurchargeCents: number;
  wavSurchargeCents: number;
  roundTripMultiplier: number;
  subtotalCents: number;
  totalCents: number;
  breakdown: string[];
  ratesUsed: Record<string, number>;
  profileName: string;
  profileSource: string;
}

function isPeakHour(timeStr: string, rates: PricingRates): boolean {
  const [hStr] = timeStr.split(":");
  const hour = parseInt(hStr, 10);
  if (isNaN(hour)) return false;
  if (hour >= rates.peakStartHour1 && hour < rates.peakEndHour1) return true;
  if (hour >= rates.peakStartHour2 && hour < rates.peakEndHour2) return true;
  return false;
}

function roundToNearest50(cents: number): number {
  return Math.round(cents / 50) * 50;
}

export async function calculatePrivateQuote(input: PricingInput): Promise<PricingResult> {
  const cityName = input.cityName || "ALL";
  let rates: PricingRates;
  let profileName = "Hardcoded Fallback";
  let profileSource = "hardcoded";

  try {
    const resolved = await getActivePricingProfile(cityName, "private");
    rates = resolved.rates;
    profileName = resolved.profileName;
    profileSource = resolved.source;
  } catch (err: any) {
    console.warn(`[Pricing] Failed to resolve DB tariffs for city=${cityName}, using hardcoded defaults:`, err.message);
    rates = { ...DEFAULT_RATES };
  }

  const eta = await etaMinutes(input.pickupAddress, input.dropoffAddress);
  const baseMiles = eta.distanceMiles;
  const baseMinutes = eta.minutes;

  const mileChargeCents = Math.round(baseMiles * rates.perMileCents);
  const bufferMileCents = Math.round(mileChargeCents * (rates.bufferPercent / 100));
  const peak = isPeakHour(input.scheduledTime, rates);
  const peakSurchargeCents = peak
    ? Math.round((mileChargeCents + bufferMileCents) * (rates.peakSurchargePercent / 100))
    : 0;
  const wavSurchargeCents = input.isWheelchair ? rates.wheelchairSurchargeCents : 0;

  let subtotalCents =
    rates.baseFareCents + mileChargeCents + bufferMileCents + peakSurchargeCents + wavSurchargeCents;

  const roundTripMultiplier = input.roundTrip ? rates.roundTripMultiplier : 1;
  subtotalCents = Math.round(subtotalCents * roundTripMultiplier);

  let totalCents = roundToNearest50(subtotalCents);
  totalCents = Math.max(rates.minimumFareCents, Math.min(rates.maxFareCents, totalCents));

  const breakdown: string[] = [];
  if (rates.baseFareCents > 0) {
    breakdown.push(`Base fare = $${(rates.baseFareCents / 100).toFixed(2)}`);
  }
  breakdown.push(`${baseMiles} mi × $${(rates.perMileCents / 100).toFixed(2)}/mi = $${(mileChargeCents / 100).toFixed(2)}`);
  breakdown.push(`+${rates.bufferPercent.toFixed(0)}% buffer = $${(bufferMileCents / 100).toFixed(2)}`);
  if (peak) {
    breakdown.push(`+${rates.peakSurchargePercent.toFixed(0)}% peak-hour surcharge = $${(peakSurchargeCents / 100).toFixed(2)}`);
  }
  if (input.isWheelchair) {
    breakdown.push(`+WAV surcharge = $${(wavSurchargeCents / 100).toFixed(2)}`);
  }
  if (input.roundTrip) {
    breakdown.push(`×${roundTripMultiplier} round-trip multiplier`);
  }
  breakdown.push(`Total: $${(totalCents / 100).toFixed(2)} (min $${(rates.minimumFareCents / 100).toFixed(2)}, max $${(rates.maxFareCents / 100).toFixed(2)})`);

  const ratesUsed: Record<string, number> = {
    base_fare_cents: rates.baseFareCents,
    per_mile_cents: rates.perMileCents,
    minimum_fare_cents: rates.minimumFareCents,
    max_fare_cents: rates.maxFareCents,
    buffer_percent: rates.bufferPercent,
    peak_surcharge_percent: rates.peakSurchargePercent,
    wheelchair_surcharge_cents: rates.wheelchairSurchargeCents,
    round_trip_multiplier: rates.roundTripMultiplier,
  };

  return {
    baseMiles,
    baseMinutes,
    perMileCents: rates.perMileCents,
    mileChargeCents,
    bufferMileCents,
    peakSurchargeCents,
    wavSurchargeCents,
    roundTripMultiplier,
    subtotalCents,
    totalCents,
    breakdown,
    ratesUsed,
    profileName,
    profileSource,
  };
}
