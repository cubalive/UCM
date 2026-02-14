import { etaMinutes } from "./googleMaps";

export interface PricingInput {
  pickupAddress: string;
  dropoffAddress: string;
  scheduledDate: string;
  scheduledTime: string;
  isWheelchair: boolean;
  roundTrip: boolean;
  passengers?: number;
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
}

const BASE_PER_MILE_CENTS = 250;
const MIN_FARE_CENTS = 3500;
const MAX_FARE_CENTS = 75000;
const BUFFER_PERCENT = 0.15;
const WAV_SURCHARGE_CENTS = 1500;
const ROUND_TRIP_MULTIPLIER = 1.85;

const PEAK_HOURS: [number, number][] = [
  [6, 9],
  [16, 19],
];
const PEAK_SURCHARGE_PERCENT = 0.15;

function isPeakHour(timeStr: string): boolean {
  const [hStr] = timeStr.split(":");
  const hour = parseInt(hStr, 10);
  if (isNaN(hour)) return false;
  return PEAK_HOURS.some(([start, end]) => hour >= start && hour < end);
}

function roundToNearest50(cents: number): number {
  return Math.round(cents / 50) * 50;
}

export async function calculatePrivateQuote(input: PricingInput): Promise<PricingResult> {
  const eta = await etaMinutes(input.pickupAddress, input.dropoffAddress);

  const baseMiles = eta.distanceMiles;
  const baseMinutes = eta.minutes;

  const mileChargeCents = Math.round(baseMiles * BASE_PER_MILE_CENTS);
  const bufferMileCents = Math.round(mileChargeCents * BUFFER_PERCENT);
  const peak = isPeakHour(input.scheduledTime);
  const peakSurchargeCents = peak
    ? Math.round((mileChargeCents + bufferMileCents) * PEAK_SURCHARGE_PERCENT)
    : 0;
  const wavSurchargeCents = input.isWheelchair ? WAV_SURCHARGE_CENTS : 0;

  let subtotalCents =
    mileChargeCents + bufferMileCents + peakSurchargeCents + wavSurchargeCents;

  const roundTripMultiplier = input.roundTrip ? ROUND_TRIP_MULTIPLIER : 1;
  subtotalCents = Math.round(subtotalCents * roundTripMultiplier);

  let totalCents = roundToNearest50(subtotalCents);
  totalCents = Math.max(MIN_FARE_CENTS, Math.min(MAX_FARE_CENTS, totalCents));

  const breakdown: string[] = [];
  breakdown.push(`${baseMiles} mi × $${(BASE_PER_MILE_CENTS / 100).toFixed(2)}/mi = $${(mileChargeCents / 100).toFixed(2)}`);
  breakdown.push(`+${(BUFFER_PERCENT * 100).toFixed(0)}% buffer = $${(bufferMileCents / 100).toFixed(2)}`);
  if (peak) {
    breakdown.push(`+${(PEAK_SURCHARGE_PERCENT * 100).toFixed(0)}% peak-hour surcharge = $${(peakSurchargeCents / 100).toFixed(2)}`);
  }
  if (input.isWheelchair) {
    breakdown.push(`+WAV surcharge = $${(wavSurchargeCents / 100).toFixed(2)}`);
  }
  if (input.roundTrip) {
    breakdown.push(`×${ROUND_TRIP_MULTIPLIER} round-trip multiplier`);
  }
  breakdown.push(`Total: $${(totalCents / 100).toFixed(2)} (min $${(MIN_FARE_CENTS / 100).toFixed(2)}, max $${(MAX_FARE_CENTS / 100).toFixed(2)})`);

  return {
    baseMiles,
    baseMinutes,
    perMileCents: BASE_PER_MILE_CENTS,
    mileChargeCents,
    bufferMileCents,
    peakSurchargeCents,
    wavSurchargeCents,
    roundTripMultiplier,
    subtotalCents,
    totalCents,
    breakdown,
  };
}
