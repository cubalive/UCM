/**
 * H-3: Single source of truth for trip pricing.
 *
 * All billing engines, invoice workers, and financial reports
 * MUST call this function instead of recalculating prices.
 *
 * The price is locked at trip creation time in priceTotalCents.
 * If a billing override exists, that takes precedence.
 */
export function getTripAmount(trip: {
  priceTotalCents?: number | null;
  billingOverride?: boolean;
  cancelFeeOverride?: string | null;
  cancelFee?: string | null;
  status?: string;
}): number | null {
  // Billing override takes precedence
  if (trip.billingOverride && trip.cancelFeeOverride) {
    return Math.round(parseFloat(trip.cancelFeeOverride) * 100);
  }

  // Cancelled trips may have a cancel fee
  if (trip.status === "CANCELLED" && trip.cancelFee) {
    return Math.round(parseFloat(trip.cancelFee) * 100);
  }

  // Normal case: use the locked price from trip creation
  return trip.priceTotalCents ?? null;
}

/**
 * Check if trip has a locked price.
 */
export function hasPriceLocked(trip: {
  priceTotalCents?: number | null;
  pricingSnapshot?: unknown;
}): boolean {
  return trip.priceTotalCents != null && trip.priceTotalCents > 0;
}
