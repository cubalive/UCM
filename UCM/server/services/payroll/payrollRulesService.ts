import { db } from "../../db";
import { driverPayRules, type DriverPayRules } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function getCompanyPayRules(companyId: number): Promise<DriverPayRules | null> {
  const [rules] = await db.select().from(driverPayRules).where(eq(driverPayRules.companyId, companyId));
  return rules || null;
}

export async function upsertCompanyPayRules(
  companyId: number,
  payload: {
    dailyMinEnabled?: boolean;
    dailyMinCents?: number | null;
    dailyMinAppliesDays?: string[] | null;
    onTimeBonusEnabled?: boolean;
    onTimeBonusMode?: "PER_TRIP" | "WEEKLY" | null;
    onTimeBonusCents?: number | null;
    onTimeThresholdMinutes?: number | null;
    onTimeRequiresConfirmedPickup?: boolean;
    noShowPenaltyEnabled?: boolean;
    noShowPenaltyCents?: number | null;
    noShowPenaltyReasonCodes?: string[] | null;
  }
): Promise<DriverPayRules> {
  const [existing] = await db.select().from(driverPayRules).where(eq(driverPayRules.companyId, companyId));

  const values = {
    companyId,
    dailyMinEnabled: payload.dailyMinEnabled ?? false,
    dailyMinCents: payload.dailyMinCents ?? null,
    dailyMinAppliesDays: payload.dailyMinAppliesDays ?? null,
    onTimeBonusEnabled: payload.onTimeBonusEnabled ?? false,
    onTimeBonusMode: payload.onTimeBonusMode ?? null,
    onTimeBonusCents: payload.onTimeBonusCents ?? null,
    onTimeThresholdMinutes: payload.onTimeThresholdMinutes ?? 5,
    onTimeRequiresConfirmedPickup: payload.onTimeRequiresConfirmedPickup ?? true,
    noShowPenaltyEnabled: payload.noShowPenaltyEnabled ?? false,
    noShowPenaltyCents: payload.noShowPenaltyCents ?? null,
    noShowPenaltyReasonCodes: payload.noShowPenaltyReasonCodes ?? null,
    updatedAt: new Date(),
  };

  if (existing) {
    const [updated] = await db.update(driverPayRules)
      .set(values)
      .where(eq(driverPayRules.companyId, companyId))
      .returning();
    return updated;
  } else {
    const [created] = await db.insert(driverPayRules)
      .values(values)
      .returning();
    return created;
  }
}
