import { db } from "../db";
import { eq, and, lte, gte, isNull, desc, asc, or, sql } from "drizzle-orm";
import { feeRules, feeRuleAudit, type FeeRule, type InsertFeeRule } from "@shared/schema";

const SCOPE_RANK: Record<string, number> = {
  company_clinic: 4,
  clinic: 3,
  company: 2,
  global: 1,
};

export interface FeeResolutionInput {
  companyId: number;
  clinicId: number;
  amountCents: number;
  serviceLevel?: string | null;
  timestamp?: Date;
}

export interface FeeResolutionResult {
  rule: FeeRule | null;
  feeCents: number;
  source: "fee_rule" | "legacy" | "none";
  details: {
    ruleId?: number;
    scopeType?: string;
    feeType?: string;
    percentBps?: number;
    fixedFeeCents?: number;
    minFeeCents?: number | null;
    maxFeeCents?: number | null;
    rawFeeCents?: number;
    clampedFeeCents?: number;
  };
}

export function computeFeeFromRule(rule: FeeRule, amountCents: number): number {
  let fee = 0;

  if (rule.feeType === "percent") {
    fee = Math.round((amountCents * rule.percentBps) / 10000);
  } else if (rule.feeType === "fixed") {
    fee = rule.fixedFeeCents;
  } else if (rule.feeType === "percent_plus_fixed") {
    fee = Math.round((amountCents * rule.percentBps) / 10000) + rule.fixedFeeCents;
  }

  if (rule.minFeeCents != null && fee < rule.minFeeCents) {
    fee = rule.minFeeCents;
  }
  if (rule.maxFeeCents != null && fee > rule.maxFeeCents) {
    fee = rule.maxFeeCents;
  }

  fee = Math.max(0, Math.min(fee, amountCents));

  return fee;
}

export async function resolveFeeRule(input: FeeResolutionInput): Promise<FeeResolutionResult> {
  const { companyId, clinicId, amountCents, serviceLevel, timestamp } = input;
  const now = timestamp || new Date();

  const allRules = await db
    .select()
    .from(feeRules)
    .where(eq(feeRules.isEnabled, true));

  const candidates = allRules.filter((r) => {
    if (r.effectiveFrom && new Date(r.effectiveFrom) > now) return false;
    if (r.effectiveTo && new Date(r.effectiveTo) < now) return false;

    if (serviceLevel && r.serviceLevel && r.serviceLevel !== serviceLevel) return false;

    if (r.scopeType === "company_clinic") {
      return r.companyId === companyId && r.clinicId === clinicId;
    }
    if (r.scopeType === "clinic") {
      return r.clinicId === clinicId;
    }
    if (r.scopeType === "company") {
      return r.companyId === companyId;
    }
    if (r.scopeType === "global") {
      return true;
    }
    return false;
  });

  if (candidates.length === 0) {
    try {
      const { getEffectivePlatformFee, computeApplicationFee } = await import("./platformFee");
      const legacyFee = await getEffectivePlatformFee(companyId);
      if (legacyFee.enabled) {
        const feeCents = computeApplicationFee(amountCents, legacyFee);
        return {
          rule: null,
          feeCents,
          source: "legacy",
          details: {
            feeType: legacyFee.type.toLowerCase(),
            percentBps: legacyFee.type === "PERCENT" ? Math.round(legacyFee.percent * 100) : 0,
            fixedFeeCents: legacyFee.type === "FIXED" ? legacyFee.cents : 0,
            rawFeeCents: feeCents,
            clampedFeeCents: feeCents,
          },
        };
      }
    } catch {}

    return { rule: null, feeCents: 0, source: "none", details: {} };
  }

  candidates.sort((a, b) => {
    const scopeDiff = (SCOPE_RANK[b.scopeType] || 0) - (SCOPE_RANK[a.scopeType] || 0);
    if (scopeDiff !== 0) return scopeDiff;

    const svcA = a.serviceLevel && serviceLevel && a.serviceLevel === serviceLevel ? 1 : 0;
    const svcB = b.serviceLevel && serviceLevel && b.serviceLevel === serviceLevel ? 1 : 0;
    if (svcB !== svcA) return svcB - svcA;

    const priDiff = a.priority - b.priority;
    if (priDiff !== 0) return priDiff;

    const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return dateB - dateA;
  });

  const winner = candidates[0];
  const rawFee = computeFeeFromRule(winner, amountCents);

  return {
    rule: winner,
    feeCents: rawFee,
    source: "fee_rule",
    details: {
      ruleId: winner.id,
      scopeType: winner.scopeType,
      feeType: winner.feeType,
      percentBps: winner.percentBps,
      fixedFeeCents: winner.fixedFeeCents,
      minFeeCents: winner.minFeeCents,
      maxFeeCents: winner.maxFeeCents,
      rawFeeCents: rawFee,
      clampedFeeCents: rawFee,
    },
  };
}

export async function listFeeRules(filters?: {
  scopeType?: string;
  companyId?: number;
  clinicId?: number;
  isEnabled?: boolean;
  serviceLevel?: string;
}): Promise<FeeRule[]> {
  const conditions: any[] = [];

  if (filters?.scopeType) {
    conditions.push(eq(feeRules.scopeType, filters.scopeType as any));
  }
  if (filters?.companyId) {
    conditions.push(eq(feeRules.companyId, filters.companyId));
  }
  if (filters?.clinicId) {
    conditions.push(eq(feeRules.clinicId, filters.clinicId));
  }
  if (filters?.isEnabled !== undefined) {
    conditions.push(eq(feeRules.isEnabled, filters.isEnabled));
  }
  if (filters?.serviceLevel) {
    conditions.push(eq(feeRules.serviceLevel, filters.serviceLevel));
  }

  const query = conditions.length > 0
    ? db.select().from(feeRules).where(and(...conditions)).orderBy(asc(feeRules.priority), desc(feeRules.updatedAt))
    : db.select().from(feeRules).orderBy(asc(feeRules.priority), desc(feeRules.updatedAt));

  return query;
}

export async function getFeeRule(id: number): Promise<FeeRule | null> {
  const [rule] = await db.select().from(feeRules).where(eq(feeRules.id, id));
  return rule || null;
}

export async function createFeeRule(
  data: Omit<InsertFeeRule, "createdAt" | "updatedAt">,
  actorUserId?: number,
  actorRole?: string
): Promise<FeeRule> {
  const [rule] = await db.insert(feeRules).values({
    ...data,
    updatedAt: new Date(),
  }).returning();

  await db.insert(feeRuleAudit).values({
    ruleId: rule.id,
    actorUserId: actorUserId || null,
    actorRole: actorRole || null,
    action: "CREATED",
    before: null,
    after: rule as any,
  });

  return rule;
}

export async function updateFeeRule(
  id: number,
  data: Partial<InsertFeeRule>,
  actorUserId?: number,
  actorRole?: string
): Promise<FeeRule | null> {
  const existing = await getFeeRule(id);
  if (!existing) return null;

  const [updated] = await db.update(feeRules).set({
    ...data,
    updatedAt: new Date(),
  }).where(eq(feeRules.id, id)).returning();

  await db.insert(feeRuleAudit).values({
    ruleId: id,
    actorUserId: actorUserId || null,
    actorRole: actorRole || null,
    action: "UPDATED",
    before: existing as any,
    after: updated as any,
  });

  return updated;
}

export async function disableFeeRule(
  id: number,
  actorUserId?: number,
  actorRole?: string
): Promise<FeeRule | null> {
  return updateFeeRule(id, { isEnabled: false }, actorUserId, actorRole);
}

export async function listFeeRuleAudit(ruleId?: number, limit = 100) {
  const conditions: any[] = [];
  if (ruleId) conditions.push(eq(feeRuleAudit.ruleId, ruleId));

  const query = conditions.length > 0
    ? db.select().from(feeRuleAudit).where(and(...conditions)).orderBy(desc(feeRuleAudit.createdAt)).limit(limit)
    : db.select().from(feeRuleAudit).orderBy(desc(feeRuleAudit.createdAt)).limit(limit);

  return query;
}
