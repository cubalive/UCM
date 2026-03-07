import { etaMinutes } from "./googleMaps";
import { getActivePricingProfile, DEFAULT_RATES, type PricingRates } from "./pricingResolver";
import { getPricingSettings, resolveDiscountPercent, type DiscountResolution } from "./pricingSettings";

export interface PricingInput {
  pickupAddress: string;
  dropoffAddress: string;
  scheduledDate: string;
  scheduledTime: string;
  isWheelchair: boolean;
  roundTrip: boolean;
  passengers?: number;
  cityName?: string;
  clinicId?: number | null;
  superAdminDiscountOverride?: number;
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
  platformTariffsEnabled: boolean;
  discountPercent: number;
  discountSource: string;
  discountAmountCents: number;
  preDiscountTotalCents: number;
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

  const pricingSettings = await getPricingSettings();
  const platformTariffsEnabled = pricingSettings.platform_tariffs_enabled;

  if (platformTariffsEnabled) {
    try {
      const resolved = await getActivePricingProfile(cityName, "private");
      rates = resolved.rates;
      profileName = resolved.profileName;
      profileSource = resolved.source;
    } catch (err: any) {
      console.warn(`[Pricing] Failed to resolve DB tariffs for city=${cityName}, using hardcoded defaults:`, err.message);
      rates = { ...DEFAULT_RATES };
    }
  } else {
    rates = { ...DEFAULT_RATES };
    profileName = "Default Rates (tariffs disabled)";
    profileSource = "hardcoded";
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

  let preDiscountTotalCents = roundToNearest50(subtotalCents);
  preDiscountTotalCents = Math.max(rates.minimumFareCents, Math.min(rates.maxFareCents, preDiscountTotalCents));

  const discount: DiscountResolution = await resolveDiscountPercent(
    input.clinicId ?? null,
    input.superAdminDiscountOverride,
  );

  let discountAmountCents = 0;
  let totalCents = preDiscountTotalCents;
  if (discount.discountPercent > 0) {
    discountAmountCents = Math.round(preDiscountTotalCents * (discount.discountPercent / 100));
    totalCents = preDiscountTotalCents - discountAmountCents;
    totalCents = Math.max(0, totalCents);
  }

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
  if (discount.discountPercent > 0) {
    breakdown.push(`-${discount.discountPercent}% discount (${discount.source}) = -$${(discountAmountCents / 100).toFixed(2)}`);
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
    platformTariffsEnabled,
    discountPercent: discount.discountPercent,
    discountSource: discount.source,
    discountAmountCents,
    preDiscountTotalCents,
  };
}
