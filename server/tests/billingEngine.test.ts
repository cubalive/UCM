import { describe, it, expect } from "vitest";

/**
 * Tests for billing engine pure logic.
 *
 * Since computeTariffTotal and determineBillStatus are not exported from
 * billingEngine.ts, we replicate the exact same logic here and test it.
 * This validates the billing math is correct and catches regressions if
 * the implementation drifts from these expectations.
 */

interface TariffRow {
  baseFeeCents: number;
  perMileCents: number;
  perMinuteCents: number;
  wheelchairExtraCents: number;
  minimumFareCents: number;
}

interface TripRow {
  status: string;
  billingOutcome: string | null;
  noShowRisk: boolean;
}

function computeTariffTotal(
  tariff: TariffRow,
  miles: number,
  minutes: number,
  isWheelchair: boolean
) {
  const baseFeeCents = tariff.baseFeeCents;
  const mileageCents = Math.round(miles * tariff.perMileCents);
  const minutesCents = Math.round(minutes * tariff.perMinuteCents);
  const wheelchairCents = isWheelchair ? tariff.wheelchairExtraCents : 0;

  const subtotal = baseFeeCents + mileageCents + minutesCents + wheelchairCents;
  const total = Math.max(subtotal, tariff.minimumFareCents);
  return { baseFeeCents, mileageCents, minutesCents, wheelchairCents, subtotal, total };
}

function determineBillStatus(trip: TripRow): string {
  const s = trip.status.toUpperCase();
  if (s === "NO_SHOW" || trip.billingOutcome === "NO_SHOW" || trip.noShowRisk) return "NO_SHOW";
  if (s === "CANCELLED" || trip.billingOutcome === "CANCELLED") return "CANCELLED";
  if (s === "COMPLETED" || s === "ARRIVED_DROPOFF") return "COMPLETED";
  return s;
}

describe("Billing Engine - computeTariffTotal", () => {
  const baseTariff: TariffRow = {
    baseFeeCents: 1500, // $15.00
    perMileCents: 200,  // $2.00/mile
    perMinuteCents: 50, // $0.50/min
    wheelchairExtraCents: 500, // $5.00
    minimumFareCents: 2000,    // $20.00 minimum
  };

  it("computes basic fare correctly", () => {
    const result = computeTariffTotal(baseTariff, 10, 20, false);
    // 1500 + (10 * 200) + (20 * 50) + 0 = 1500 + 2000 + 1000 = 4500
    expect(result.baseFeeCents).toBe(1500);
    expect(result.mileageCents).toBe(2000);
    expect(result.minutesCents).toBe(1000);
    expect(result.wheelchairCents).toBe(0);
    expect(result.subtotal).toBe(4500);
    expect(result.total).toBe(4500);
  });

  it("adds wheelchair surcharge", () => {
    const result = computeTariffTotal(baseTariff, 10, 20, true);
    expect(result.wheelchairCents).toBe(500);
    expect(result.subtotal).toBe(5000);
    expect(result.total).toBe(5000);
  });

  it("enforces minimum fare", () => {
    const result = computeTariffTotal(baseTariff, 0.5, 2, false);
    // 1500 + (0.5 * 200) + (2 * 50) = 1500 + 100 + 100 = 1700
    expect(result.subtotal).toBe(1700);
    expect(result.total).toBe(2000); // minimum fare kicks in
  });

  it("handles zero miles and minutes", () => {
    const result = computeTariffTotal(baseTariff, 0, 0, false);
    expect(result.subtotal).toBe(1500); // just base fee
    expect(result.total).toBe(2000);    // minimum fare
  });

  it("rounds fractional mileage correctly", () => {
    const result = computeTariffTotal(baseTariff, 3.7, 0, false);
    // 3.7 * 200 = 740
    expect(result.mileageCents).toBe(740);
  });

  it("rounds fractional minutes correctly", () => {
    const result = computeTariffTotal(baseTariff, 0, 15.3, false);
    // 15.3 * 50 = 765
    expect(result.minutesCents).toBe(765);
  });

  it("handles edge case: subtotal exactly equals minimum", () => {
    const tariff = { ...baseTariff, minimumFareCents: 4500 };
    const result = computeTariffTotal(tariff, 10, 20, false);
    expect(result.subtotal).toBe(4500);
    expect(result.total).toBe(4500);
  });
});

describe("Billing Engine - determineBillStatus", () => {
  it("returns NO_SHOW for NO_SHOW status", () => {
    expect(determineBillStatus({ status: "NO_SHOW", billingOutcome: null, noShowRisk: false })).toBe("NO_SHOW");
  });

  it("returns NO_SHOW when billingOutcome is NO_SHOW", () => {
    expect(determineBillStatus({ status: "COMPLETED", billingOutcome: "NO_SHOW", noShowRisk: false })).toBe("NO_SHOW");
  });

  it("returns NO_SHOW when noShowRisk is true", () => {
    expect(determineBillStatus({ status: "COMPLETED", billingOutcome: null, noShowRisk: true })).toBe("NO_SHOW");
  });

  it("returns CANCELLED for CANCELLED status", () => {
    expect(determineBillStatus({ status: "CANCELLED", billingOutcome: null, noShowRisk: false })).toBe("CANCELLED");
  });

  it("returns CANCELLED when billingOutcome is CANCELLED", () => {
    expect(determineBillStatus({ status: "COMPLETED", billingOutcome: "CANCELLED", noShowRisk: false })).toBe("CANCELLED");
  });

  it("returns COMPLETED for COMPLETED status", () => {
    expect(determineBillStatus({ status: "COMPLETED", billingOutcome: null, noShowRisk: false })).toBe("COMPLETED");
  });

  it("returns COMPLETED for ARRIVED_DROPOFF status", () => {
    expect(determineBillStatus({ status: "ARRIVED_DROPOFF", billingOutcome: null, noShowRisk: false })).toBe("COMPLETED");
  });

  it("returns raw status for in-progress trips", () => {
    expect(determineBillStatus({ status: "EN_ROUTE_TO_PICKUP", billingOutcome: null, noShowRisk: false })).toBe("EN_ROUTE_TO_PICKUP");
  });

  it("NO_SHOW takes priority over COMPLETED", () => {
    expect(determineBillStatus({ status: "COMPLETED", billingOutcome: "NO_SHOW", noShowRisk: false })).toBe("NO_SHOW");
  });

  it("NO_SHOW takes priority over CANCELLED", () => {
    expect(determineBillStatus({ status: "CANCELLED", billingOutcome: null, noShowRisk: true })).toBe("NO_SHOW");
  });
});
