import { describe, it, expect } from "vitest";

// =========================================================
// Billing Integration Tests — Pure Computation Logic
// =========================================================

// ─── Tariff Computation Engine ──────────────────────────────────────────────

interface Tariff {
  baseFeeCents: number;
  perMileCents: number;
  perMinuteCents: number;
  wheelchairExtraCents: number;
  stretcherExtraCents: number;
  minimumFareCents: number;
  noShowFeeCents: number;
  cancelFeeCents: number;
}

interface TripBillingInput {
  miles: number;
  minutes: number;
  isWheelchair: boolean;
  isStretcher: boolean;
  status: string;
  passengerCount: number;
  stops: number;
}

interface BillingResult {
  baseFeeCents: number;
  mileageCents: number;
  minutesCents: number;
  wheelchairCents: number;
  stretcherCents: number;
  subtotal: number;
  total: number;
  minimumApplied: boolean;
}

function computeTripBilling(tariff: Tariff, trip: TripBillingInput): BillingResult {
  // Cancelled trips get cancellation fee
  if (trip.status === "CANCELLED") {
    return {
      baseFeeCents: 0,
      mileageCents: 0,
      minutesCents: 0,
      wheelchairCents: 0,
      stretcherCents: 0,
      subtotal: tariff.cancelFeeCents,
      total: tariff.cancelFeeCents,
      minimumApplied: false,
    };
  }

  // No-show trips get no-show fee
  if (trip.status === "NO_SHOW") {
    return {
      baseFeeCents: 0,
      mileageCents: 0,
      minutesCents: 0,
      wheelchairCents: 0,
      stretcherCents: 0,
      subtotal: tariff.noShowFeeCents,
      total: tariff.noShowFeeCents,
      minimumApplied: false,
    };
  }

  const baseFeeCents = tariff.baseFeeCents;
  const mileageCents = Math.round(trip.miles * tariff.perMileCents);
  const minutesCents = Math.round(trip.minutes * tariff.perMinuteCents);
  const wheelchairCents = trip.isWheelchair ? tariff.wheelchairExtraCents : 0;
  const stretcherCents = trip.isStretcher ? tariff.stretcherExtraCents : 0;
  const subtotal = baseFeeCents + mileageCents + minutesCents + wheelchairCents + stretcherCents;
  const minimumApplied = subtotal < tariff.minimumFareCents;
  const total = Math.max(subtotal, tariff.minimumFareCents);

  return { baseFeeCents, mileageCents, minutesCents, wheelchairCents, stretcherCents, subtotal, total, minimumApplied };
}

// ─── Invoice Generation ──────────────────────────────────────────────────────

interface InvoiceLineItem {
  tripId: number;
  description: string;
  amountCents: number;
  status: string;
}

interface Invoice {
  lineItems: InvoiceLineItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  status: string;
}

function generateInvoice(lineItems: InvoiceLineItem[], taxRateBps: number): Invoice {
  const subtotalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);
  const taxCents = Math.round((subtotalCents * taxRateBps) / 10000);
  const totalCents = subtotalCents + taxCents;

  return {
    lineItems,
    subtotalCents,
    taxCents,
    totalCents,
    status: "draft",
  };
}

// ─── Fee Rules Engine ────────────────────────────────────────────────────────

interface FeeRule {
  type: "percent" | "fixed" | "hybrid";
  percentBps: number;
  fixedCents: number;
  minCents: number;
  maxCents: number;
}

function applyFeeRule(amountCents: number, rule: FeeRule): number {
  let fee = 0;
  if (rule.type === "percent" || rule.type === "hybrid") {
    fee += Math.round((amountCents * rule.percentBps) / 10000);
  }
  if (rule.type === "fixed" || rule.type === "hybrid") {
    fee += rule.fixedCents;
  }
  if (rule.minCents > 0) fee = Math.max(fee, rule.minCents);
  if (rule.maxCents > 0) fee = Math.min(fee, rule.maxCents);
  return fee;
}

// ─── Multi-Stop Cost Calculation ─────────────────────────────────────────────

function computeMultiStopCost(
  tariff: Tariff,
  legs: Array<{ miles: number; minutes: number }>,
  perStopFeeCents: number,
): number {
  let total = tariff.baseFeeCents;
  for (const leg of legs) {
    total += Math.round(leg.miles * tariff.perMileCents);
    total += Math.round(leg.minutes * tariff.perMinuteCents);
  }
  // Additional stop fees (first stop is included in base)
  if (legs.length > 1) {
    total += (legs.length - 1) * perStopFeeCents;
  }
  return Math.max(total, tariff.minimumFareCents);
}

const standardTariff: Tariff = {
  baseFeeCents: 1500,
  perMileCents: 250,
  perMinuteCents: 50,
  wheelchairExtraCents: 2000,
  stretcherExtraCents: 3500,
  minimumFareCents: 2500,
  noShowFeeCents: 3500,
  cancelFeeCents: 1500,
};

// =========================================================
// Tests
// =========================================================

describe("Billing Integration — Trip Billing Computation", () => {
  it("computes standard ambulatory trip", () => {
    const result = computeTripBilling(standardTariff, {
      miles: 10, minutes: 20, isWheelchair: false, isStretcher: false,
      status: "COMPLETED", passengerCount: 1, stops: 1,
    });
    expect(result.baseFeeCents).toBe(1500);
    expect(result.mileageCents).toBe(2500);
    expect(result.minutesCents).toBe(1000);
    expect(result.wheelchairCents).toBe(0);
    expect(result.stretcherCents).toBe(0);
    expect(result.subtotal).toBe(5000);
    expect(result.total).toBe(5000);
    expect(result.minimumApplied).toBe(false);
  });

  it("adds wheelchair surcharge", () => {
    const result = computeTripBilling(standardTariff, {
      miles: 10, minutes: 20, isWheelchair: true, isStretcher: false,
      status: "COMPLETED", passengerCount: 1, stops: 1,
    });
    expect(result.wheelchairCents).toBe(2000);
    expect(result.total).toBe(7000);
  });

  it("adds stretcher surcharge", () => {
    const result = computeTripBilling(standardTariff, {
      miles: 10, minutes: 20, isWheelchair: false, isStretcher: true,
      status: "COMPLETED", passengerCount: 1, stops: 1,
    });
    expect(result.stretcherCents).toBe(3500);
    expect(result.total).toBe(8500);
  });

  it("enforces minimum fare for short trips", () => {
    const result = computeTripBilling(standardTariff, {
      miles: 1, minutes: 2, isWheelchair: false, isStretcher: false,
      status: "COMPLETED", passengerCount: 1, stops: 1,
    });
    expect(result.subtotal).toBe(1850); // 1500 + 250 + 100
    expect(result.total).toBe(2500);
    expect(result.minimumApplied).toBe(true);
  });

  it("handles zero-distance trips (base fee only, minimum fare applies)", () => {
    const result = computeTripBilling(standardTariff, {
      miles: 0, minutes: 0, isWheelchair: false, isStretcher: false,
      status: "COMPLETED", passengerCount: 1, stops: 1,
    });
    expect(result.mileageCents).toBe(0);
    expect(result.minutesCents).toBe(0);
    expect(result.subtotal).toBe(1500);
    expect(result.total).toBe(2500);
    expect(result.minimumApplied).toBe(true);
  });

  it("handles fractional miles correctly", () => {
    const result = computeTripBilling(standardTariff, {
      miles: 3.7, minutes: 0, isWheelchair: false, isStretcher: false,
      status: "COMPLETED", passengerCount: 1, stops: 1,
    });
    expect(result.mileageCents).toBe(925);
  });
});

describe("Billing Integration — Cancelled Trip Billing", () => {
  it("charges cancellation fee only", () => {
    const result = computeTripBilling(standardTariff, {
      miles: 10, minutes: 20, isWheelchair: false, isStretcher: false,
      status: "CANCELLED", passengerCount: 1, stops: 1,
    });
    expect(result.baseFeeCents).toBe(0);
    expect(result.mileageCents).toBe(0);
    expect(result.total).toBe(1500);
  });

  it("does not apply minimum fare to cancellation fee", () => {
    const lowCancelTariff = { ...standardTariff, cancelFeeCents: 500 };
    const result = computeTripBilling(lowCancelTariff, {
      miles: 0, minutes: 0, isWheelchair: false, isStretcher: false,
      status: "CANCELLED", passengerCount: 1, stops: 1,
    });
    expect(result.total).toBe(500);
    expect(result.minimumApplied).toBe(false);
  });
});

describe("Billing Integration — No-Show Billing", () => {
  it("charges no-show fee only", () => {
    const result = computeTripBilling(standardTariff, {
      miles: 0, minutes: 0, isWheelchair: false, isStretcher: false,
      status: "NO_SHOW", passengerCount: 1, stops: 1,
    });
    expect(result.total).toBe(3500);
    expect(result.baseFeeCents).toBe(0);
  });
});

describe("Billing Integration — Invoice Generation", () => {
  it("generates invoice from completed trips", () => {
    const lineItems: InvoiceLineItem[] = [
      { tripId: 1, description: "Trip #1 — 10 mi", amountCents: 5000, status: "COMPLETED" },
      { tripId: 2, description: "Trip #2 — 5 mi", amountCents: 3500, status: "COMPLETED" },
      { tripId: 3, description: "Trip #3 — No Show", amountCents: 3500, status: "NO_SHOW" },
    ];

    const invoice = generateInvoice(lineItems, 0); // no tax
    expect(invoice.lineItems.length).toBe(3);
    expect(invoice.subtotalCents).toBe(12000);
    expect(invoice.taxCents).toBe(0);
    expect(invoice.totalCents).toBe(12000);
    expect(invoice.status).toBe("draft");
  });

  it("applies tax correctly", () => {
    const lineItems: InvoiceLineItem[] = [
      { tripId: 1, description: "Trip", amountCents: 10000, status: "COMPLETED" },
    ];

    const invoice = generateInvoice(lineItems, 825); // 8.25% tax
    expect(invoice.subtotalCents).toBe(10000);
    expect(invoice.taxCents).toBe(825);
    expect(invoice.totalCents).toBe(10825);
  });

  it("handles empty line items", () => {
    const invoice = generateInvoice([], 0);
    expect(invoice.subtotalCents).toBe(0);
    expect(invoice.totalCents).toBe(0);
    expect(invoice.lineItems.length).toBe(0);
  });

  it("handles single cancelled trip invoice", () => {
    const lineItems: InvoiceLineItem[] = [
      { tripId: 1, description: "Cancelled Trip", amountCents: 1500, status: "CANCELLED" },
    ];

    const invoice = generateInvoice(lineItems, 0);
    expect(invoice.totalCents).toBe(1500);
  });
});

describe("Billing Integration — Fee Rules", () => {
  it("applies percent-only rule", () => {
    const rule: FeeRule = { type: "percent", percentBps: 500, fixedCents: 0, minCents: 0, maxCents: 0 };
    expect(applyFeeRule(10000, rule)).toBe(500); // 5% of $100
  });

  it("applies fixed-only rule", () => {
    const rule: FeeRule = { type: "fixed", percentBps: 0, fixedCents: 200, minCents: 0, maxCents: 0 };
    expect(applyFeeRule(10000, rule)).toBe(200);
  });

  it("applies hybrid rule (percent + fixed)", () => {
    const rule: FeeRule = { type: "hybrid", percentBps: 300, fixedCents: 150, minCents: 0, maxCents: 0 };
    expect(applyFeeRule(10000, rule)).toBe(450); // 3% of $100 + $1.50
  });

  it("enforces minimum fee", () => {
    const rule: FeeRule = { type: "percent", percentBps: 100, fixedCents: 0, minCents: 100, maxCents: 0 };
    expect(applyFeeRule(500, rule)).toBe(100); // 1% of $5 = $0.05, min $1.00
  });

  it("enforces maximum fee", () => {
    const rule: FeeRule = { type: "percent", percentBps: 1000, fixedCents: 0, minCents: 0, maxCents: 5000 };
    expect(applyFeeRule(100000, rule)).toBe(5000); // 10% of $1000 = $100, max $50
  });

  it("handles zero amount", () => {
    const rule: FeeRule = { type: "percent", percentBps: 500, fixedCents: 0, minCents: 0, maxCents: 0 };
    expect(applyFeeRule(0, rule)).toBe(0);
  });

  it("min overrides percent when both set", () => {
    const rule: FeeRule = { type: "hybrid", percentBps: 100, fixedCents: 50, minCents: 200, maxCents: 0 };
    // 1% of $10 = $0.10 + $0.50 fixed = $0.60, min $2.00
    expect(applyFeeRule(1000, rule)).toBe(200);
  });
});

describe("Billing Integration — Multi-Stop Trips", () => {
  const perStopFee = 500; // $5.00 per additional stop

  it("single-leg trip has no extra stop fees", () => {
    const total = computeMultiStopCost(standardTariff, [{ miles: 10, minutes: 20 }], perStopFee);
    // 1500 base + 2500 mileage + 1000 minutes = 5000
    expect(total).toBe(5000);
  });

  it("two-leg trip adds one extra stop fee", () => {
    const total = computeMultiStopCost(
      standardTariff,
      [{ miles: 5, minutes: 10 }, { miles: 5, minutes: 10 }],
      perStopFee,
    );
    // 1500 base + 1250*2 mileage + 500*2 minutes + 500 extra stop = 5500
    expect(total).toBe(5500);
  });

  it("three-leg trip adds two extra stop fees", () => {
    const total = computeMultiStopCost(
      standardTariff,
      [{ miles: 3, minutes: 5 }, { miles: 3, minutes: 5 }, { miles: 3, minutes: 5 }],
      perStopFee,
    );
    // 1500 base + 750*3 mileage + 250*3 minutes + 2*500 stop fees = 1500 + 2250 + 750 + 1000 = 5500
    expect(total).toBe(5500);
  });

  it("enforces minimum fare for short multi-stop trips", () => {
    const total = computeMultiStopCost(
      standardTariff,
      [{ miles: 0.5, minutes: 1 }, { miles: 0.5, minutes: 1 }],
      perStopFee,
    );
    // 1500 base + 125*2 mileage + 50*2 minutes + 500 stop = 2350, min 2500
    expect(total).toBe(2500);
  });

  it("handles zero-distance multi-stop", () => {
    const total = computeMultiStopCost(
      standardTariff,
      [{ miles: 0, minutes: 0 }, { miles: 0, minutes: 0 }],
      perStopFee,
    );
    // 1500 base + 500 stop fee = 2000, min 2500
    expect(total).toBe(2500);
  });
});

describe("Billing Integration — Split Pricing", () => {
  function splitBilling(totalCents: number, passengerCount: number): number[] {
    if (passengerCount <= 0) return [];
    if (passengerCount === 1) return [totalCents];
    const splitBase = Math.floor(totalCents / passengerCount);
    const remainder = totalCents - splitBase * passengerCount;
    const splits: number[] = [];
    for (let i = 0; i < passengerCount; i++) {
      splits.push(splitBase + (i === 0 ? remainder : 0));
    }
    return splits;
  }

  it("single passenger gets full amount", () => {
    expect(splitBilling(5000, 1)).toEqual([5000]);
  });

  it("even split between passengers", () => {
    expect(splitBilling(6000, 3)).toEqual([2000, 2000, 2000]);
  });

  it("uneven split gives remainder to first passenger", () => {
    const splits = splitBilling(5000, 3);
    expect(splits).toEqual([1668, 1666, 1666]);
    expect(splits.reduce((a, b) => a + b, 0)).toBe(5000);
  });

  it("two-way split", () => {
    const splits = splitBilling(5001, 2);
    expect(splits).toEqual([2501, 2500]);
    expect(splits.reduce((a, b) => a + b, 0)).toBe(5001);
  });

  it("zero passengers returns empty", () => {
    expect(splitBilling(5000, 0)).toEqual([]);
  });
});
