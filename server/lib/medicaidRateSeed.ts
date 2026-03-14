import { db } from "../db";
import { medicaidBillingCodes } from "@shared/schema";
import { sql } from "drizzle-orm";

interface RateEntry {
  code: string;
  description: string;
  serviceType: "ambulatory" | "wheelchair" | "stretcher" | "ambulance_bls";
  baseRateCents: number;
  perMileRateCents: number;
  modifiers: string[] | null;
  state: string | null;
}

const CODE_MAP: Record<string, { description: string; serviceType: RateEntry["serviceType"]; modifiers: string[] | null }> = {
  A0130: { description: "Non-emergency transportation: ambulatory", serviceType: "ambulatory", modifiers: null },
  T2003: { description: "Non-emergency transportation: wheelchair van", serviceType: "wheelchair", modifiers: ["U1"] },
  T2005: { description: "Non-emergency transportation: stretcher van", serviceType: "stretcher", modifiers: ["U2"] },
  A0428: { description: "Ambulance service: basic life support, non-emergency", serviceType: "ambulance_bls", modifiers: ["QN"] },
};

interface StateRates {
  state: string | null;
  rates: Record<string, { baseCents: number; perMileCents: number }>;
}

const STATE_RATES: StateRates[] = [
  {
    state: "FL",
    rates: {
      A0130: { baseCents: 3200, perMileCents: 189 },
      T2003: { baseCents: 5400, perMileCents: 215 },
      T2005: { baseCents: 9800, perMileCents: 320 },
      A0428: { baseCents: 22500, perMileCents: 850 },
    },
  },
  {
    state: "TX",
    rates: {
      A0130: { baseCents: 2850, perMileCents: 165 },
      T2003: { baseCents: 4800, perMileCents: 195 },
      T2005: { baseCents: 8500, perMileCents: 285 },
      A0428: { baseCents: 21000, perMileCents: 780 },
    },
  },
  {
    state: "CA",
    rates: {
      A0130: { baseCents: 3500, perMileCents: 210 },
      T2003: { baseCents: 5800, perMileCents: 240 },
      T2005: { baseCents: 10500, perMileCents: 350 },
      A0428: { baseCents: 24500, perMileCents: 925 },
    },
  },
  {
    state: "NY",
    rates: {
      A0130: { baseCents: 3800, perMileCents: 225 },
      T2003: { baseCents: 6200, perMileCents: 260 },
      T2005: { baseCents: 11500, perMileCents: 375 },
      A0428: { baseCents: 26000, perMileCents: 975 },
    },
  },
  {
    state: "GA",
    rates: {
      A0130: { baseCents: 2600, perMileCents: 155 },
      T2003: { baseCents: 4500, perMileCents: 185 },
      T2005: { baseCents: 8200, perMileCents: 275 },
      A0428: { baseCents: 19500, perMileCents: 750 },
    },
  },
  {
    state: "OH",
    rates: {
      A0130: { baseCents: 3000, perMileCents: 175 },
      T2003: { baseCents: 5000, perMileCents: 205 },
      T2005: { baseCents: 9200, perMileCents: 310 },
      A0428: { baseCents: 22000, perMileCents: 825 },
    },
  },
  {
    state: null,
    rates: {
      A0130: { baseCents: 3000, perMileCents: 180 },
      T2003: { baseCents: 5000, perMileCents: 200 },
      T2005: { baseCents: 9000, perMileCents: 300 },
      A0428: { baseCents: 21500, perMileCents: 800 },
    },
  },
];

export async function seedMedicaidRates(): Promise<number> {
  // Check if rates already exist
  const existing = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(medicaidBillingCodes);

  if (existing[0].count > 0) {
    console.log(`[MedicaidRateSeed] Skipping — ${existing[0].count} billing codes already exist`);
    return 0;
  }

  const effectiveFrom = new Date("2024-01-01T00:00:00Z");

  const rows: (typeof medicaidBillingCodes.$inferInsert)[] = [];

  for (const stateEntry of STATE_RATES) {
    for (const [code, rate] of Object.entries(stateEntry.rates)) {
      const meta = CODE_MAP[code];
      rows.push({
        code,
        description: meta.description,
        serviceType: meta.serviceType,
        baseRateCents: rate.baseCents,
        perMileRateCents: rate.perMileCents,
        modifiers: meta.modifiers,
        state: stateEntry.state,
        effectiveFrom,
        effectiveTo: null,
        active: true,
      });
    }
  }

  await db.insert(medicaidBillingCodes).values(rows);

  const stateLabel = (s: string | null) => s ?? "DEFAULT";
  for (const stateEntry of STATE_RATES) {
    const codes = Object.keys(stateEntry.rates).join(", ");
    console.log(`[MedicaidRateSeed] Inserted ${stateLabel(stateEntry.state)}: ${codes}`);
  }

  console.log(`[MedicaidRateSeed] Seeded ${rows.length} Medicaid NEMT billing codes`);
  return rows.length;
}
