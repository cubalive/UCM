/**
 * Comprehensive billing and financial logic tests.
 * Tests pure functions and inline recreations of key billing algorithms.
 */

import { computeApplicationFee } from "../../server/services/platformFee";

// ── Inline business logic functions ──

interface EffectivePlatformFee {
  enabled: boolean;
  type: "PERCENT" | "FIXED";
  percent: number;
  cents: number;
}

function calculateFare(params: {
  baseFare: number;
  perMileRate: number;
  miles: number;
  waitTimeMinutes: number;
  waitTimeRate: number;
  stops?: number;
  stopCharge?: number;
}): number {
  const { baseFare, perMileRate, miles, waitTimeMinutes, waitTimeRate, stops = 0, stopCharge = 0 } = params;
  const mileageFee = perMileRate * miles;
  const waitFee = waitTimeRate * waitTimeMinutes;
  const stopFee = stops * stopCharge;
  return Math.round((baseFare + mileageFee + waitFee + stopFee) * 100) / 100;
}

const MEDICAID_RATES: Record<string, number> = {
  A0428: 25.00,
  T2003: 15.50,
  T2005: 12.00,
  S0215: 8.00,
};

function getMedicaidRate(hcpcsCode: string): number | null {
  return MEDICAID_RATES[hcpcsCode] ?? null;
}

function calculateMedicaidClaim(params: {
  hcpcsCode: string;
  units: number;
  modifiers?: string[];
}): { amount: number; valid: boolean; reason?: string } {
  const rate = getMedicaidRate(params.hcpcsCode);
  if (!rate) return { amount: 0, valid: false, reason: "Invalid HCPCS code" };
  if (params.units <= 0) return { amount: 0, valid: false, reason: "Invalid units" };
  return { amount: Math.round(rate * params.units * 100) / 100, valid: true };
}

function generateISASegment(params: {
  senderId: string;
  receiverId: string;
  controlNumber: string;
  date: string;
  time: string;
}): string {
  return `ISA*00*          *00*          *ZZ*${params.senderId.padEnd(15)}*ZZ*${params.receiverId.padEnd(15)}*${params.date}*${params.time}*^*00501*${params.controlNumber.padStart(9, "0")}*0*P*:~`;
}

function generateCLMSegment(params: {
  claimId: string;
  totalCharge: number;
  facilityCode: string;
  frequencyCode: string;
}): string {
  return `CLM*${params.claimId}*${params.totalCharge.toFixed(2)}***${params.facilityCode}:B:${params.frequencyCode}*Y*A*Y*Y~`;
}

interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface Invoice {
  lineItems: InvoiceLineItem[];
  subtotal: number;
  tax: number;
  total: number;
}

function createInvoice(items: Omit<InvoiceLineItem, "amount">[], taxRate: number): Invoice {
  const lineItems = items.map(item => ({
    ...item,
    amount: Math.round(item.quantity * item.unitPrice * 100) / 100,
  }));
  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  return { lineItems, subtotal, tax, total: Math.round((subtotal + tax) * 100) / 100 };
}

interface LedgerEntry {
  type: "PAYMENT" | "REFUND" | "CHARGE" | "ADJUSTMENT";
  amount: number;
  balance: number;
}

function processPayment(
  invoiceTotal: number,
  payments: { type: "PAYMENT" | "REFUND"; amount: number }[],
): {
  entries: LedgerEntry[];
  remainingBalance: number;
  fullyPaid: boolean;
} {
  const entries: LedgerEntry[] = [];
  let balance = invoiceTotal;

  for (const p of payments) {
    if (p.type === "PAYMENT") {
      balance = Math.round((balance - p.amount) * 100) / 100;
    } else {
      balance = Math.round((balance + p.amount) * 100) / 100;
    }
    entries.push({ type: p.type, amount: p.amount, balance });
  }

  return { entries, remainingBalance: balance, fullyPaid: balance <= 0 };
}

function calculateDriverPayout(
  tripFare: number,
  platformFeePercent: number,
): {
  platformFee: number;
  driverPayout: number;
} {
  const platformFee = Math.round((tripFare * platformFeePercent) / 100 * 100) / 100;
  const driverPayout = Math.round((tripFare - platformFee) * 100) / 100;
  return { platformFee, driverPayout };
}

function filterTripsInBillingPeriod(
  trips: { id: number; completedAt: Date | null }[],
  periodStart: Date,
  periodEnd: Date,
): { id: number; completedAt: Date | null }[] {
  return trips.filter(t => {
    if (!t.completedAt) return false;
    return t.completedAt >= periodStart && t.completedAt <= periodEnd;
  });
}

function checkIdempotency(existingKeys: Set<string>, key: string): { isDuplicate: boolean } {
  if (existingKeys.has(key)) return { isDuplicate: true };
  existingKeys.add(key);
  return { isDuplicate: false };
}

function checkGPSDiscrepancy(
  claimedMiles: number,
  gpsMiles: number,
  threshold: number = 0.1,
): {
  flagged: boolean;
  discrepancy: number;
} {
  if (gpsMiles === 0) return { flagged: claimedMiles > 0, discrepancy: 1 };
  const discrepancy = Math.abs(claimedMiles - gpsMiles) / gpsMiles;
  return { flagged: discrepancy > threshold, discrepancy };
}

function checkDuplicateTrip(
  existingTrips: { patientId: number; scheduledDate: string; pickupAddress: string; createdAt: Date }[],
  newTrip: { patientId: number; scheduledDate: string; pickupAddress: string; createdAt: Date },
  windowMinutes: number = 5,
): boolean {
  return existingTrips.some(
    t =>
      t.patientId === newTrip.patientId &&
      t.scheduledDate === newTrip.scheduledDate &&
      t.pickupAddress === newTrip.pickupAddress &&
      Math.abs(t.createdAt.getTime() - newTrip.createdAt.getTime()) < windowMinutes * 60 * 1000,
  );
}

function checkAnomalousVolume(tripsToday: number, historicalAvg: number, threshold: number = 3): boolean {
  return tripsToday > historicalAvg * threshold;
}

function checkSimultaneousTrips(
  trips: { driverId: number; cityId: number; startTime: Date; endTime: Date }[],
): { flagged: boolean; conflictingTrips: number[] } {
  for (let i = 0; i < trips.length; i++) {
    for (let j = i + 1; j < trips.length; j++) {
      if (
        trips[i].driverId === trips[j].driverId &&
        trips[i].cityId !== trips[j].cityId &&
        trips[i].startTime < trips[j].endTime &&
        trips[j].startTime < trips[i].endTime
      ) {
        return { flagged: true, conflictingTrips: [i, j] };
      }
    }
  }
  return { flagged: false, conflictingTrips: [] };
}

// ══════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════

describe("Platform Fee Calculation (computeApplicationFee)", () => {
  const pctFee = (percent: number): EffectivePlatformFee => ({
    enabled: true,
    type: "PERCENT",
    percent,
    cents: 0,
  });

  const fixedFee = (cents: number): EffectivePlatformFee => ({
    enabled: true,
    type: "FIXED",
    percent: 0,
    cents,
  });

  const disabled: EffectivePlatformFee = { enabled: false, type: "PERCENT", percent: 10, cents: 0 };

  it("returns 0 when fee is disabled", () => {
    expect(computeApplicationFee(10000, disabled)).toBe(0);
  });

  it("calculates 10% of $100 correctly", () => {
    expect(computeApplicationFee(10000, pctFee(10))).toBe(1000);
  });

  it("calculates 15% of $50 correctly", () => {
    expect(computeApplicationFee(5000, pctFee(15))).toBe(750);
  });

  it("calculates 2.5% of $200 correctly", () => {
    expect(computeApplicationFee(20000, pctFee(2.5))).toBe(500);
  });

  it("returns fixed fee regardless of total", () => {
    expect(computeApplicationFee(10000, fixedFee(500))).toBe(500);
    expect(computeApplicationFee(50000, fixedFee(500))).toBe(500);
  });

  it("caps fee at total amount", () => {
    // Fixed fee of $100 on a $5 total
    expect(computeApplicationFee(500, fixedFee(10000))).toBe(500);
  });

  it("returns 0 for zero total", () => {
    expect(computeApplicationFee(0, pctFee(10))).toBe(0);
  });

  it("100% fee equals total", () => {
    expect(computeApplicationFee(5000, pctFee(100))).toBe(5000);
  });

  it("returns 0 for negative total (clamped by max(0, ...))", () => {
    expect(computeApplicationFee(-1000, pctFee(10))).toBe(0);
  });

  it("handles large amounts ($10,000 trip)", () => {
    expect(computeApplicationFee(1000000, pctFee(5))).toBe(50000);
  });

  it("handles small amounts ($1 trip)", () => {
    expect(computeApplicationFee(100, pctFee(10))).toBe(10);
  });

  it("rounds correctly for 3% of $33.33", () => {
    // 3333 cents * 3 / 100 = 99.99 → rounds to 100
    expect(computeApplicationFee(3333, pctFee(3))).toBe(100);
  });

  it("handles 0% fee", () => {
    expect(computeApplicationFee(10000, pctFee(0))).toBe(0);
  });

  it("handles fixed fee of 0 cents", () => {
    expect(computeApplicationFee(10000, fixedFee(0))).toBe(0);
  });

  it("fixed fee equal to total returns total", () => {
    expect(computeApplicationFee(500, fixedFee(500))).toBe(500);
  });
});

describe("Fare Calculation", () => {
  it("standard trip: base $5 + $2/mi * 10mi = $25", () => {
    expect(
      calculateFare({ baseFare: 5, perMileRate: 2, miles: 10, waitTimeMinutes: 0, waitTimeRate: 0 }),
    ).toBe(25);
  });

  it("trip with wait time: base $5 + $2/mi * 5mi + $0.50/min * 15min = $22.50", () => {
    expect(
      calculateFare({ baseFare: 5, perMileRate: 2, miles: 5, waitTimeMinutes: 15, waitTimeRate: 0.5 }),
    ).toBe(22.5);
  });

  it("multi-stop trip: base $5 + $2/mi * 8mi + 3 stops * $3 = $30", () => {
    expect(
      calculateFare({
        baseFare: 5,
        perMileRate: 2,
        miles: 8,
        waitTimeMinutes: 0,
        waitTimeRate: 0,
        stops: 3,
        stopCharge: 3,
      }),
    ).toBe(30);
  });

  it("zero miles returns just base fare", () => {
    expect(
      calculateFare({ baseFare: 5, perMileRate: 2, miles: 0, waitTimeMinutes: 0, waitTimeRate: 0 }),
    ).toBe(5);
  });

  it("zero base fare returns just mileage", () => {
    expect(
      calculateFare({ baseFare: 0, perMileRate: 2, miles: 10, waitTimeMinutes: 0, waitTimeRate: 0 }),
    ).toBe(20);
  });

  it("all zeros returns $0", () => {
    expect(
      calculateFare({ baseFare: 0, perMileRate: 0, miles: 0, waitTimeMinutes: 0, waitTimeRate: 0 }),
    ).toBe(0);
  });

  it("large distance: 100 miles", () => {
    expect(
      calculateFare({ baseFare: 10, perMileRate: 1.5, miles: 100, waitTimeMinutes: 0, waitTimeRate: 0 }),
    ).toBe(160);
  });

  it("fractional miles: 7.3 miles", () => {
    expect(
      calculateFare({ baseFare: 5, perMileRate: 2, miles: 7.3, waitTimeMinutes: 0, waitTimeRate: 0 }),
    ).toBe(19.6);
  });

  it("all components combined", () => {
    const result = calculateFare({
      baseFare: 5,
      perMileRate: 2,
      miles: 10,
      waitTimeMinutes: 20,
      waitTimeRate: 0.5,
      stops: 2,
      stopCharge: 3,
    });
    // 5 + 20 + 10 + 6 = 41
    expect(result).toBe(41);
  });
});

describe("Medicaid Billing", () => {
  describe("getMedicaidRate", () => {
    it("returns correct rate for A0428", () => {
      expect(getMedicaidRate("A0428")).toBe(25.0);
    });

    it("returns correct rate for T2003", () => {
      expect(getMedicaidRate("T2003")).toBe(15.5);
    });

    it("returns correct rate for T2005", () => {
      expect(getMedicaidRate("T2005")).toBe(12.0);
    });

    it("returns correct rate for S0215 (mileage)", () => {
      expect(getMedicaidRate("S0215")).toBe(8.0);
    });

    it("returns null for invalid HCPCS code", () => {
      expect(getMedicaidRate("XXXXX")).toBeNull();
    });
  });

  describe("calculateMedicaidClaim", () => {
    it("calculates valid claim for A0428 with 1 unit", () => {
      const result = calculateMedicaidClaim({ hcpcsCode: "A0428", units: 1 });
      expect(result).toEqual({ amount: 25.0, valid: true });
    });

    it("calculates valid claim for T2003", () => {
      const result = calculateMedicaidClaim({ hcpcsCode: "T2003", units: 2 });
      expect(result).toEqual({ amount: 31.0, valid: true });
    });

    it("calculates mileage claim: 15 miles * $8/mi = $120", () => {
      const result = calculateMedicaidClaim({ hcpcsCode: "S0215", units: 15 });
      expect(result).toEqual({ amount: 120.0, valid: true });
    });

    it("returns invalid for unknown HCPCS code", () => {
      const result = calculateMedicaidClaim({ hcpcsCode: "ZZZZZ", units: 1 });
      expect(result).toEqual({ amount: 0, valid: false, reason: "Invalid HCPCS code" });
    });

    it("returns invalid for zero units", () => {
      const result = calculateMedicaidClaim({ hcpcsCode: "A0428", units: 0 });
      expect(result).toEqual({ amount: 0, valid: false, reason: "Invalid units" });
    });

    it("returns invalid for negative units", () => {
      const result = calculateMedicaidClaim({ hcpcsCode: "A0428", units: -1 });
      expect(result).toEqual({ amount: 0, valid: false, reason: "Invalid units" });
    });

    it("handles fractional units with rounding", () => {
      const result = calculateMedicaidClaim({ hcpcsCode: "S0215", units: 7.3 });
      expect(result.amount).toBe(58.4);
      expect(result.valid).toBe(true);
    });
  });
});

describe("EDI 837 Generation", () => {
  describe("ISA Segment", () => {
    it("generates correctly formatted ISA segment", () => {
      const isa = generateISASegment({
        senderId: "SENDER1",
        receiverId: "RECV1",
        controlNumber: "123",
        date: "230101",
        time: "1200",
      });
      expect(isa).toContain("ISA*00*");
      expect(isa).toContain("*ZZ*");
      expect(isa).toContain("*00501*");
      expect(isa.endsWith("~")).toBe(true);
    });

    it("pads sender ID to 15 characters", () => {
      const isa = generateISASegment({
        senderId: "AB",
        receiverId: "CD",
        controlNumber: "1",
        date: "230101",
        time: "1200",
      });
      expect(isa).toContain("*ZZ*AB             *");
    });

    it("zero-pads control number to 9 digits", () => {
      const isa = generateISASegment({
        senderId: "S",
        receiverId: "R",
        controlNumber: "42",
        date: "230101",
        time: "1200",
      });
      expect(isa).toContain("*000000042*");
    });

    it("handles already-9-digit control number", () => {
      const isa = generateISASegment({
        senderId: "S",
        receiverId: "R",
        controlNumber: "123456789",
        date: "230101",
        time: "1200",
      });
      expect(isa).toContain("*123456789*");
    });
  });

  describe("CLM Segment", () => {
    it("generates correct charge amount with 2 decimal places", () => {
      const clm = generateCLMSegment({
        claimId: "CLM001",
        totalCharge: 150.0,
        facilityCode: "11",
        frequencyCode: "1",
      });
      expect(clm).toContain("*150.00*");
    });

    it("includes claim ID", () => {
      const clm = generateCLMSegment({
        claimId: "TESTCLAIM",
        totalCharge: 99.99,
        facilityCode: "11",
        frequencyCode: "1",
      });
      expect(clm).toContain("CLM*TESTCLAIM*");
    });

    it("formats facility and frequency codes correctly", () => {
      const clm = generateCLMSegment({
        claimId: "C1",
        totalCharge: 50.0,
        facilityCode: "21",
        frequencyCode: "7",
      });
      expect(clm).toContain("21:B:7");
    });

    it("ends with tilde terminator", () => {
      const clm = generateCLMSegment({
        claimId: "C1",
        totalCharge: 10.0,
        facilityCode: "11",
        frequencyCode: "1",
      });
      expect(clm.endsWith("~")).toBe(true);
    });

    it("formats zero charge correctly", () => {
      const clm = generateCLMSegment({
        claimId: "C1",
        totalCharge: 0,
        facilityCode: "11",
        frequencyCode: "1",
      });
      expect(clm).toContain("*0.00*");
    });
  });
});

describe("Invoice Logic", () => {
  it("calculates single line item correctly", () => {
    const inv = createInvoice([{ description: "Trip A", quantity: 1, unitPrice: 25.0 }], 0);
    expect(inv.subtotal).toBe(25.0);
    expect(inv.total).toBe(25.0);
    expect(inv.lineItems).toHaveLength(1);
    expect(inv.lineItems[0].amount).toBe(25.0);
  });

  it("sums multiple line items", () => {
    const inv = createInvoice(
      [
        { description: "Trip A", quantity: 1, unitPrice: 25.0 },
        { description: "Trip B", quantity: 2, unitPrice: 15.0 },
        { description: "Trip C", quantity: 1, unitPrice: 10.0 },
      ],
      0,
    );
    expect(inv.subtotal).toBe(65.0);
    expect(inv.total).toBe(65.0);
  });

  it("calculates tax correctly", () => {
    const inv = createInvoice([{ description: "Trip", quantity: 1, unitPrice: 100.0 }], 0.08);
    expect(inv.subtotal).toBe(100.0);
    expect(inv.tax).toBe(8.0);
    expect(inv.total).toBe(108.0);
  });

  it("zero tax rate means total equals subtotal", () => {
    const inv = createInvoice([{ description: "Trip", quantity: 5, unitPrice: 20.0 }], 0);
    expect(inv.tax).toBe(0);
    expect(inv.total).toBe(inv.subtotal);
  });

  it("empty items produce zero total", () => {
    const inv = createInvoice([], 0.1);
    expect(inv.subtotal).toBe(0);
    expect(inv.tax).toBe(0);
    expect(inv.total).toBe(0);
    expect(inv.lineItems).toHaveLength(0);
  });

  it("handles fractional quantity * unitPrice", () => {
    const inv = createInvoice([{ description: "Mileage", quantity: 7.5, unitPrice: 2.0 }], 0);
    expect(inv.lineItems[0].amount).toBe(15.0);
    expect(inv.total).toBe(15.0);
  });

  it("handles tax rounding", () => {
    const inv = createInvoice([{ description: "Trip", quantity: 1, unitPrice: 33.33 }], 0.07);
    // 33.33 * 0.07 = 2.3331 → rounded to 2.33
    expect(inv.tax).toBe(2.33);
    expect(inv.total).toBe(35.66);
  });
});

describe("Payment & Ledger", () => {
  it("full payment results in zero balance and fullyPaid", () => {
    const result = processPayment(100, [{ type: "PAYMENT", amount: 100 }]);
    expect(result.remainingBalance).toBe(0);
    expect(result.fullyPaid).toBe(true);
    expect(result.entries).toHaveLength(1);
  });

  it("partial payment leaves remaining balance", () => {
    const result = processPayment(100, [{ type: "PAYMENT", amount: 60 }]);
    expect(result.remainingBalance).toBe(40);
    expect(result.fullyPaid).toBe(false);
  });

  it("overpayment results in negative balance (credit)", () => {
    const result = processPayment(100, [{ type: "PAYMENT", amount: 120 }]);
    expect(result.remainingBalance).toBe(-20);
    expect(result.fullyPaid).toBe(true);
  });

  it("refund increases balance", () => {
    const result = processPayment(100, [
      { type: "PAYMENT", amount: 100 },
      { type: "REFUND", amount: 30 },
    ]);
    expect(result.remainingBalance).toBe(30);
    expect(result.fullyPaid).toBe(false);
  });

  it("multiple partial payments track running balance", () => {
    const result = processPayment(100, [
      { type: "PAYMENT", amount: 30 },
      { type: "PAYMENT", amount: 30 },
      { type: "PAYMENT", amount: 40 },
    ]);
    expect(result.entries[0].balance).toBe(70);
    expect(result.entries[1].balance).toBe(40);
    expect(result.entries[2].balance).toBe(0);
    expect(result.fullyPaid).toBe(true);
  });

  it("payment then refund produces correct final balance", () => {
    const result = processPayment(200, [
      { type: "PAYMENT", amount: 200 },
      { type: "REFUND", amount: 50 },
    ]);
    expect(result.remainingBalance).toBe(50);
    expect(result.fullyPaid).toBe(false);
  });

  it("no payments leaves full balance", () => {
    const result = processPayment(100, []);
    expect(result.remainingBalance).toBe(100);
    expect(result.fullyPaid).toBe(false);
    expect(result.entries).toHaveLength(0);
  });

  it("handles floating point precision", () => {
    const result = processPayment(10.1, [
      { type: "PAYMENT", amount: 3.3 },
      { type: "PAYMENT", amount: 3.3 },
      { type: "PAYMENT", amount: 3.5 },
    ]);
    expect(result.remainingBalance).toBe(0);
    expect(result.fullyPaid).toBe(true);
  });
});

describe("Driver Payout", () => {
  it("$100 fare, 20% fee → $20 fee, $80 payout", () => {
    const result = calculateDriverPayout(100, 20);
    expect(result.platformFee).toBe(20);
    expect(result.driverPayout).toBe(80);
  });

  it("$0 fare → $0 everything", () => {
    const result = calculateDriverPayout(0, 20);
    expect(result.platformFee).toBe(0);
    expect(result.driverPayout).toBe(0);
  });

  it("0% fee → full fare goes to driver", () => {
    const result = calculateDriverPayout(100, 0);
    expect(result.platformFee).toBe(0);
    expect(result.driverPayout).toBe(100);
  });

  it("100% fee → driver gets $0", () => {
    const result = calculateDriverPayout(100, 100);
    expect(result.platformFee).toBe(100);
    expect(result.driverPayout).toBe(0);
  });

  it("handles fractional fare with rounding", () => {
    const result = calculateDriverPayout(33.33, 15);
    expect(result.platformFee).toBe(5);
    expect(result.driverPayout).toBe(28.33);
  });

  it("large fare", () => {
    const result = calculateDriverPayout(5000, 10);
    expect(result.platformFee).toBe(500);
    expect(result.driverPayout).toBe(4500);
  });
});

describe("Billing Cycle - filterTripsInBillingPeriod", () => {
  const periodStart = new Date("2026-03-01T00:00:00Z");
  const periodEnd = new Date("2026-03-31T23:59:59Z");

  it("includes trips within period", () => {
    const trips = [{ id: 1, completedAt: new Date("2026-03-15T12:00:00Z") }];
    const result = filterTripsInBillingPeriod(trips, periodStart, periodEnd);
    expect(result).toHaveLength(1);
  });

  it("excludes trips before period", () => {
    const trips = [{ id: 1, completedAt: new Date("2026-02-28T23:59:59Z") }];
    const result = filterTripsInBillingPeriod(trips, periodStart, periodEnd);
    expect(result).toHaveLength(0);
  });

  it("excludes trips after period", () => {
    const trips = [{ id: 1, completedAt: new Date("2026-04-01T00:00:01Z") }];
    const result = filterTripsInBillingPeriod(trips, periodStart, periodEnd);
    expect(result).toHaveLength(0);
  });

  it("excludes incomplete trips (no completedAt)", () => {
    const trips = [{ id: 1, completedAt: null }];
    const result = filterTripsInBillingPeriod(trips, periodStart, periodEnd);
    expect(result).toHaveLength(0);
  });

  it("includes trips at exact boundary start", () => {
    const trips = [{ id: 1, completedAt: new Date("2026-03-01T00:00:00Z") }];
    const result = filterTripsInBillingPeriod(trips, periodStart, periodEnd);
    expect(result).toHaveLength(1);
  });

  it("includes trips at exact boundary end", () => {
    const trips = [{ id: 1, completedAt: new Date("2026-03-31T23:59:59Z") }];
    const result = filterTripsInBillingPeriod(trips, periodStart, periodEnd);
    expect(result).toHaveLength(1);
  });

  it("filters mixed trips correctly", () => {
    const trips = [
      { id: 1, completedAt: new Date("2026-02-15T12:00:00Z") },
      { id: 2, completedAt: new Date("2026-03-10T12:00:00Z") },
      { id: 3, completedAt: null },
      { id: 4, completedAt: new Date("2026-03-20T12:00:00Z") },
      { id: 5, completedAt: new Date("2026-04-05T12:00:00Z") },
    ];
    const result = filterTripsInBillingPeriod(trips, periodStart, periodEnd);
    expect(result).toHaveLength(2);
    expect(result.map(t => t.id)).toEqual([2, 4]);
  });
});

describe("Idempotency", () => {
  it("first creation is not a duplicate", () => {
    const keys = new Set<string>();
    expect(checkIdempotency(keys, "inv-001").isDuplicate).toBe(false);
  });

  it("second creation with same key is a duplicate", () => {
    const keys = new Set<string>();
    checkIdempotency(keys, "inv-001");
    expect(checkIdempotency(keys, "inv-001").isDuplicate).toBe(true);
  });

  it("different keys are both allowed", () => {
    const keys = new Set<string>();
    expect(checkIdempotency(keys, "inv-001").isDuplicate).toBe(false);
    expect(checkIdempotency(keys, "inv-002").isDuplicate).toBe(false);
  });

  it("tracks multiple keys independently", () => {
    const keys = new Set<string>();
    checkIdempotency(keys, "a");
    checkIdempotency(keys, "b");
    checkIdempotency(keys, "c");
    expect(checkIdempotency(keys, "a").isDuplicate).toBe(true);
    expect(checkIdempotency(keys, "d").isDuplicate).toBe(false);
  });
});

describe("Fraud Detection", () => {
  describe("GPS Discrepancy", () => {
    it("flags >10% discrepancy (claimed 20, GPS 10)", () => {
      const result = checkGPSDiscrepancy(20, 10);
      expect(result.flagged).toBe(true);
      expect(result.discrepancy).toBe(1); // 100% off
    });

    it("does not flag within 10% tolerance", () => {
      const result = checkGPSDiscrepancy(10.5, 10);
      expect(result.flagged).toBe(false);
      expect(result.discrepancy).toBe(0.05);
    });

    it("exact match is not flagged", () => {
      const result = checkGPSDiscrepancy(15, 15);
      expect(result.flagged).toBe(false);
      expect(result.discrepancy).toBe(0);
    });

    it("zero GPS miles with positive claimed → flagged", () => {
      const result = checkGPSDiscrepancy(5, 0);
      expect(result.flagged).toBe(true);
      expect(result.discrepancy).toBe(1);
    });

    it("zero GPS miles with zero claimed → not flagged", () => {
      const result = checkGPSDiscrepancy(0, 0);
      expect(result.flagged).toBe(false);
    });

    it("claimed less than GPS (under-reporting) still flags if >10%", () => {
      const result = checkGPSDiscrepancy(8, 10);
      expect(result.flagged).toBe(true);
      expect(result.discrepancy).toBe(0.2);
    });

    it("custom threshold works", () => {
      const result = checkGPSDiscrepancy(11, 10, 0.2);
      expect(result.flagged).toBe(false); // 10% < 20% threshold
    });
  });

  describe("Duplicate Trip Detection", () => {
    const now = new Date("2026-03-14T10:00:00Z");

    it("detects duplicate trip within 5 minutes", () => {
      const existing = [
        { patientId: 1, scheduledDate: "2026-03-15", pickupAddress: "123 Main St", createdAt: now },
      ];
      const newTrip = {
        patientId: 1,
        scheduledDate: "2026-03-15",
        pickupAddress: "123 Main St",
        createdAt: new Date(now.getTime() + 2 * 60 * 1000), // 2 min later
      };
      expect(checkDuplicateTrip(existing, newTrip)).toBe(true);
    });

    it("does not flag same patient, different day", () => {
      const existing = [
        { patientId: 1, scheduledDate: "2026-03-15", pickupAddress: "123 Main St", createdAt: now },
      ];
      const newTrip = {
        patientId: 1,
        scheduledDate: "2026-03-16",
        pickupAddress: "123 Main St",
        createdAt: new Date(now.getTime() + 60 * 1000),
      };
      expect(checkDuplicateTrip(existing, newTrip)).toBe(false);
    });

    it("does not flag different patient, same details", () => {
      const existing = [
        { patientId: 1, scheduledDate: "2026-03-15", pickupAddress: "123 Main St", createdAt: now },
      ];
      const newTrip = {
        patientId: 2,
        scheduledDate: "2026-03-15",
        pickupAddress: "123 Main St",
        createdAt: new Date(now.getTime() + 60 * 1000),
      };
      expect(checkDuplicateTrip(existing, newTrip)).toBe(false);
    });

    it("does not flag if outside time window", () => {
      const existing = [
        { patientId: 1, scheduledDate: "2026-03-15", pickupAddress: "123 Main St", createdAt: now },
      ];
      const newTrip = {
        patientId: 1,
        scheduledDate: "2026-03-15",
        pickupAddress: "123 Main St",
        createdAt: new Date(now.getTime() + 10 * 60 * 1000), // 10 min later
      };
      expect(checkDuplicateTrip(existing, newTrip)).toBe(false);
    });

    it("different address is not a duplicate", () => {
      const existing = [
        { patientId: 1, scheduledDate: "2026-03-15", pickupAddress: "123 Main St", createdAt: now },
      ];
      const newTrip = {
        patientId: 1,
        scheduledDate: "2026-03-15",
        pickupAddress: "456 Oak Ave",
        createdAt: new Date(now.getTime() + 60 * 1000),
      };
      expect(checkDuplicateTrip(existing, newTrip)).toBe(false);
    });
  });

  describe("Anomalous Volume", () => {
    it("flags when trips today exceeds 3x historical avg", () => {
      expect(checkAnomalousVolume(20, 5)).toBe(true); // 20 > 15
    });

    it("does not flag within normal range", () => {
      expect(checkAnomalousVolume(10, 5)).toBe(false); // 10 <= 15
    });

    it("does not flag at exact threshold", () => {
      expect(checkAnomalousVolume(15, 5)).toBe(false); // 15 is not > 15
    });

    it("patient with 0 history, 20 trips today → flagged", () => {
      expect(checkAnomalousVolume(20, 0)).toBe(true); // 20 > 0
    });

    it("custom threshold works", () => {
      expect(checkAnomalousVolume(10, 5, 1.5)).toBe(true); // 10 > 7.5
    });
  });

  describe("Simultaneous Trips (cross-city)", () => {
    const baseTime = new Date("2026-03-14T10:00:00Z");

    it("flags driver trips in two different cities at the same time", () => {
      const trips = [
        {
          driverId: 1,
          cityId: 1,
          startTime: baseTime,
          endTime: new Date(baseTime.getTime() + 60 * 60 * 1000),
        },
        {
          driverId: 1,
          cityId: 2,
          startTime: new Date(baseTime.getTime() + 30 * 60 * 1000),
          endTime: new Date(baseTime.getTime() + 90 * 60 * 1000),
        },
      ];
      const result = checkSimultaneousTrips(trips);
      expect(result.flagged).toBe(true);
      expect(result.conflictingTrips).toEqual([0, 1]);
    });

    it("does not flag driver trips in same city at same time", () => {
      const trips = [
        {
          driverId: 1,
          cityId: 1,
          startTime: baseTime,
          endTime: new Date(baseTime.getTime() + 60 * 60 * 1000),
        },
        {
          driverId: 1,
          cityId: 1,
          startTime: new Date(baseTime.getTime() + 30 * 60 * 1000),
          endTime: new Date(baseTime.getTime() + 90 * 60 * 1000),
        },
      ];
      const result = checkSimultaneousTrips(trips);
      expect(result.flagged).toBe(false);
    });

    it("does not flag different drivers in different cities", () => {
      const trips = [
        {
          driverId: 1,
          cityId: 1,
          startTime: baseTime,
          endTime: new Date(baseTime.getTime() + 60 * 60 * 1000),
        },
        {
          driverId: 2,
          cityId: 2,
          startTime: baseTime,
          endTime: new Date(baseTime.getTime() + 60 * 60 * 1000),
        },
      ];
      const result = checkSimultaneousTrips(trips);
      expect(result.flagged).toBe(false);
    });

    it("does not flag non-overlapping trips in different cities", () => {
      const trips = [
        {
          driverId: 1,
          cityId: 1,
          startTime: baseTime,
          endTime: new Date(baseTime.getTime() + 60 * 60 * 1000),
        },
        {
          driverId: 1,
          cityId: 2,
          startTime: new Date(baseTime.getTime() + 120 * 60 * 1000),
          endTime: new Date(baseTime.getTime() + 180 * 60 * 1000),
        },
      ];
      const result = checkSimultaneousTrips(trips);
      expect(result.flagged).toBe(false);
    });

    it("empty trips list → not flagged", () => {
      const result = checkSimultaneousTrips([]);
      expect(result.flagged).toBe(false);
      expect(result.conflictingTrips).toEqual([]);
    });

    it("single trip → not flagged", () => {
      const trips = [
        {
          driverId: 1,
          cityId: 1,
          startTime: baseTime,
          endTime: new Date(baseTime.getTime() + 60 * 60 * 1000),
        },
      ];
      const result = checkSimultaneousTrips(trips);
      expect(result.flagged).toBe(false);
    });
  });
});
