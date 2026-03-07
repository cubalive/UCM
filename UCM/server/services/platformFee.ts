import { db } from "../db";
import { eq } from "drizzle-orm";
import { platformBillingSettings, companyPlatformFees } from "@shared/schema";

export interface EffectivePlatformFee {
  enabled: boolean;
  type: "PERCENT" | "FIXED";
  percent: number;
  cents: number;
}

export async function ensureGlobalSettingsRow(): Promise<void> {
  const existing = await db.select().from(platformBillingSettings).where(eq(platformBillingSettings.id, 1));
  if (existing.length === 0) {
    await db.insert(platformBillingSettings).values({
      id: 1,
      enabled: false,
      defaultFeeType: "PERCENT",
      defaultFeePercent: "0",
      defaultFeeCents: 0,
    }).onConflictDoNothing();
  }
}

export async function getGlobalSettings() {
  await ensureGlobalSettingsRow();
  const [row] = await db.select().from(platformBillingSettings).where(eq(platformBillingSettings.id, 1));
  return row;
}

export async function updateGlobalSettings(data: {
  enabled?: boolean;
  defaultFeeType?: "PERCENT" | "FIXED";
  defaultFeePercent?: string;
  defaultFeeCents?: number;
}) {
  await ensureGlobalSettingsRow();
  await db.update(platformBillingSettings).set({
    ...data,
    updatedAt: new Date(),
  }).where(eq(platformBillingSettings.id, 1));
  return getGlobalSettings();
}

export async function getCompanyOverride(companyId: number) {
  const [row] = await db.select().from(companyPlatformFees).where(eq(companyPlatformFees.companyId, companyId));
  return row || null;
}

export async function upsertCompanyOverride(companyId: number, data: {
  enabled?: boolean | null;
  feeType?: "PERCENT" | "FIXED" | null;
  feePercent?: string | null;
  feeCents?: number | null;
}) {
  const existing = await getCompanyOverride(companyId);
  if (existing) {
    await db.update(companyPlatformFees).set({
      enabled: data.enabled ?? null,
      feeType: data.feeType ?? null,
      feePercent: data.feePercent ?? null,
      feeCents: data.feeCents ?? null,
      updatedAt: new Date(),
    }).where(eq(companyPlatformFees.companyId, companyId));
  } else {
    await db.insert(companyPlatformFees).values({
      companyId,
      enabled: data.enabled ?? null,
      feeType: data.feeType ?? null,
      feePercent: data.feePercent ?? null,
      feeCents: data.feeCents ?? null,
    });
  }
  return getCompanyOverride(companyId);
}

export async function deleteCompanyOverride(companyId: number) {
  await db.delete(companyPlatformFees).where(eq(companyPlatformFees.companyId, companyId));
}

export async function getAllCompanyOverrides() {
  return db.select().from(companyPlatformFees);
}

export async function getEffectivePlatformFee(companyId: number): Promise<EffectivePlatformFee> {
  const global = await getGlobalSettings();
  const override = await getCompanyOverride(companyId);

  const enabled = override?.enabled ?? global.enabled;
  const type = (override?.feeType ?? global.defaultFeeType) as "PERCENT" | "FIXED";
  const percent = parseFloat(String(override?.feePercent ?? global.defaultFeePercent)) || 0;
  const cents = override?.feeCents ?? global.defaultFeeCents;

  return { enabled, type, percent, cents };
}

export function computeApplicationFee(totalAmountCents: number, fee: EffectivePlatformFee): number {
  if (!fee.enabled) return 0;

  let feeAmount: number;
  if (fee.type === "PERCENT") {
    feeAmount = Math.round(totalAmountCents * fee.percent / 100);
  } else {
    feeAmount = fee.cents;
  }

  return Math.max(0, Math.min(feeAmount, totalAmountCents));
}
