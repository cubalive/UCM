import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  trips,
  tripBilling,
  financialLedger,
  feeRules,
  type FinancialLedgerEntry,
} from "@shared/schema";
import { resolveFeeRule, computeFeeFromRule } from "./feeRules";

export interface TripFinancialBreakdown {
  tripId: number;
  companyId: number;
  clinicId: number | null;
  driverId: number | null;
  tripTotalCents: number;
  platformFeeCents: number;
  driverPayoutCents: number;
  netToCompanyCents: number;
  feeRuleId: number | null;
  feeRuleDetails: Record<string, any>;
  ledgerEntries: Omit<FinancialLedgerEntry, "id" | "createdAt">[];
  alreadyProcessed: boolean;
}

export async function processTripFinancials(tripId: number): Promise<TripFinancialBreakdown | null> {
  const existing = await db
    .select()
    .from(financialLedger)
    .where(
      and(
        eq(financialLedger.tripId, tripId),
        eq(financialLedger.entryType, "trip_revenue"),
        sql`${financialLedger.status} != 'voided'`
      )
    );

  if (existing.length > 0) {
    return buildBreakdownFromLedger(tripId, existing);
  }

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
  if (!trip || !trip.companyId) return null;

  const [billing] = await db.select().from(tripBilling).where(eq(tripBilling.tripId, tripId));
  const tripTotalCents = billing?.totalCents ?? 0;

  if (tripTotalCents <= 0) {
    return {
      tripId,
      companyId: trip.companyId,
      clinicId: trip.clinicId,
      driverId: trip.driverId,
      tripTotalCents: 0,
      platformFeeCents: 0,
      driverPayoutCents: 0,
      netToCompanyCents: 0,
      feeRuleId: null,
      feeRuleDetails: {},
      ledgerEntries: [],
      alreadyProcessed: false,
    };
  }

  const feeResult = await resolveFeeRule({
    companyId: trip.companyId,
    clinicId: trip.clinicId ?? 0,
    amountCents: tripTotalCents,
  });

  const platformFeeCents = feeResult.feeCents;
  const netToCompanyCents = tripTotalCents - platformFeeCents;

  const idempotencyBase = `trip_${tripId}`;
  const entries: Omit<FinancialLedgerEntry, "id" | "createdAt">[] = [];

  entries.push({
    companyId: trip.companyId,
    tripId,
    clinicId: trip.clinicId,
    driverId: trip.driverId,
    invoiceId: trip.invoiceId,
    feeRuleId: null,
    entryType: "clinic_charge",
    direction: "debit",
    amountCents: tripTotalCents,
    currency: "usd",
    counterpartyType: "clinic",
    counterpartyId: trip.clinicId,
    status: "pending",
    settlementStage: "invoice_generation",
    description: `Clinic charge for trip #${tripId}`,
    metadata: {
      billingId: billing?.id,
      pricingMode: billing?.pricingMode,
      serviceDate: billing?.serviceDate ?? trip.scheduledDate,
    },
    idempotencyKey: `${idempotencyBase}_clinic_charge`,
    settledAt: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  });

  entries.push({
    companyId: trip.companyId,
    tripId,
    clinicId: trip.clinicId,
    driverId: trip.driverId,
    invoiceId: trip.invoiceId,
    feeRuleId: feeResult.rule?.id ?? null,
    entryType: "trip_revenue",
    direction: "credit",
    amountCents: tripTotalCents,
    currency: "usd",
    counterpartyType: "company",
    counterpartyId: trip.companyId,
    status: "pending",
    settlementStage: "invoice_generation",
    description: `Trip #${tripId} revenue`,
    metadata: {
      billingId: billing?.id,
      pricingMode: billing?.pricingMode,
      serviceDate: billing?.serviceDate ?? trip.scheduledDate,
    },
    idempotencyKey: `${idempotencyBase}_revenue`,
    settledAt: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  });

  if (platformFeeCents > 0) {
    entries.push({
      companyId: trip.companyId,
      tripId,
      clinicId: trip.clinicId,
      driverId: null,
      invoiceId: trip.invoiceId,
      feeRuleId: feeResult.rule?.id ?? null,
      entryType: "platform_fee",
      direction: "debit",
      amountCents: platformFeeCents,
      currency: "usd",
      counterpartyType: "platform",
      counterpartyId: null,
      status: "pending",
      settlementStage: feeResult.rule?.settlementStage ?? "invoice_generation",
      description: `Platform fee for trip #${tripId}`,
      metadata: {
        feeType: feeResult.details.feeType,
        percentBps: feeResult.details.percentBps,
        fixedFeeCents: feeResult.details.fixedFeeCents,
        source: feeResult.source,
      },
      idempotencyKey: `${idempotencyBase}_platform_fee`,
      settledAt: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    });

    entries.push({
      companyId: trip.companyId,
      tripId,
      clinicId: trip.clinicId,
      driverId: null,
      invoiceId: trip.invoiceId,
      feeRuleId: feeResult.rule?.id ?? null,
      entryType: "platform_fee",
      direction: "credit",
      amountCents: platformFeeCents,
      currency: "usd",
      counterpartyType: "company",
      counterpartyId: trip.companyId,
      status: "pending",
      settlementStage: feeResult.rule?.settlementStage ?? "invoice_generation",
      description: `Platform fee credit (to platform) for trip #${tripId}`,
      metadata: {
        feeType: feeResult.details.feeType,
        source: feeResult.source,
      },
      idempotencyKey: `${idempotencyBase}_platform_fee_credit`,
      settledAt: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
    });
  }

  await db.transaction(async (tx) => {
    for (const entry of entries) {
      try {
        await tx.insert(financialLedger).values(entry as any).onConflictDoNothing();
      } catch (err: any) {
        if (err.code === "23505") continue;
        throw err;
      }
    }
  });

  return {
    tripId,
    companyId: trip.companyId,
    clinicId: trip.clinicId,
    driverId: trip.driverId,
    tripTotalCents,
    platformFeeCents,
    driverPayoutCents: 0,
    netToCompanyCents,
    feeRuleId: feeResult.rule?.id ?? null,
    feeRuleDetails: feeResult.details,
    ledgerEntries: entries,
    alreadyProcessed: false,
  };
}

async function buildBreakdownFromLedger(
  tripId: number,
  existingEntries: FinancialLedgerEntry[]
): Promise<TripFinancialBreakdown> {
  const allEntries = await db
    .select()
    .from(financialLedger)
    .where(
      and(
        eq(financialLedger.tripId, tripId),
        sql`${financialLedger.status} != 'voided'`
      )
    );

  const revenueEntry = allEntries.find((e) => e.entryType === "trip_revenue");
  const feeEntry = allEntries.find((e) => e.entryType === "platform_fee");
  const payoutEntry = allEntries.find((e) => e.entryType === "driver_payout");

  const tripTotalCents = revenueEntry?.amountCents ?? 0;
  const platformFeeCents = feeEntry?.amountCents ?? 0;
  const driverPayoutCents = payoutEntry?.amountCents ?? 0;

  return {
    tripId,
    companyId: revenueEntry?.companyId ?? 0,
    clinicId: revenueEntry?.clinicId ?? null,
    driverId: revenueEntry?.driverId ?? null,
    tripTotalCents,
    platformFeeCents,
    driverPayoutCents,
    netToCompanyCents: tripTotalCents - platformFeeCents,
    feeRuleId: feeEntry?.feeRuleId ?? null,
    feeRuleDetails: (feeEntry?.metadata as Record<string, any>) ?? {},
    ledgerEntries: allEntries as any,
    alreadyProcessed: true,
  };
}

export async function getTripFinancialBreakdown(
  tripId: number
): Promise<TripFinancialBreakdown | null> {
  const entries = await db
    .select()
    .from(financialLedger)
    .where(
      and(
        eq(financialLedger.tripId, tripId),
        sql`${financialLedger.status} != 'voided'`
      )
    );

  if (entries.length === 0) {
    return processTripFinancials(tripId);
  }

  return buildBreakdownFromLedger(tripId, entries);
}

export async function voidTripLedgerEntries(
  tripId: number,
  actorUserId: number,
  reason: string
): Promise<number> {
  const result = await db
    .update(financialLedger)
    .set({
      status: "voided",
      voidedAt: new Date(),
      voidedBy: actorUserId,
      voidReason: reason,
    })
    .where(
      and(
        eq(financialLedger.tripId, tripId),
        sql`${financialLedger.status} = 'pending'`
      )
    )
    .returning();

  return result.length;
}

export async function getCompanyLedgerSummary(
  companyId: number,
  dateFrom?: string,
  dateTo?: string
): Promise<{
  totalRevenueCents: number;
  totalPlatformFeesCents: number;
  totalDriverPayoutsCents: number;
  totalNetCents: number;
  entryCount: number;
}> {
  const conditions: any[] = [
    eq(financialLedger.companyId, companyId),
    sql`${financialLedger.status} != 'voided'`,
  ];

  if (dateFrom) {
    conditions.push(sql`${financialLedger.createdAt} >= ${dateFrom}::timestamp`);
  }
  if (dateTo) {
    conditions.push(sql`${financialLedger.createdAt} <= ${dateTo}::timestamp`);
  }

  const entries = await db
    .select()
    .from(financialLedger)
    .where(and(...conditions));

  let totalRevenueCents = 0;
  let totalPlatformFeesCents = 0;
  let totalDriverPayoutsCents = 0;

  for (const entry of entries) {
    if (entry.entryType === "trip_revenue") totalRevenueCents += entry.amountCents;
    if (entry.entryType === "platform_fee") totalPlatformFeesCents += entry.amountCents;
    if (entry.entryType === "driver_payout") totalDriverPayoutsCents += entry.amountCents;
  }

  return {
    totalRevenueCents,
    totalPlatformFeesCents,
    totalDriverPayoutsCents,
    totalNetCents: totalRevenueCents - totalPlatformFeesCents - totalDriverPayoutsCents,
    entryCount: entries.length,
  };
}
