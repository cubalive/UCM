import { getDb } from "../db/index.js";
import { feeRules } from "../db/schema.js";
import { eq, and, lte, gte, or, isNull } from "drizzle-orm";
import logger from "../lib/logger.js";
import { getDayInTimezone, getHourInTimezone, DEFAULT_TIMEZONE } from "../lib/timezone.js";

export interface FeeCalculationInput {
  tenantId: string;
  tripId: string;
  mileage: number;
  scheduledAt: Date;
  timezone?: string;
  metadata?: Record<string, unknown>;
}

export interface FeeLineItem {
  feeRuleId: string;
  name: string;
  type: string;
  amount: number;
  description: string;
}

export interface FeeCalculationResult {
  lineItems: FeeLineItem[];
  subtotal: number;
  currency: string;
}

export async function calculateFees(input: FeeCalculationInput): Promise<FeeCalculationResult> {
  const db = getDb();
  const now = input.scheduledAt;

  const rules = await db
    .select()
    .from(feeRules)
    .where(
      and(
        eq(feeRules.tenantId, input.tenantId),
        eq(feeRules.active, true),
        or(isNull(feeRules.effectiveFrom), lte(feeRules.effectiveFrom, now)),
        or(isNull(feeRules.effectiveTo), gte(feeRules.effectiveTo, now))
      )
    )
    .orderBy(feeRules.priority);

  const lineItems: FeeLineItem[] = [];
  let subtotal = 0;

  for (const rule of rules) {
    const ruleAmount = Number(rule.amount);
    let calculatedAmount = 0;

    if (!matchesConditions(rule.conditions as Record<string, unknown>, input)) {
      continue;
    }

    switch (rule.type) {
      case "flat":
        calculatedAmount = ruleAmount;
        break;
      case "per_mile":
        if (input.mileage <= 0) continue;
        calculatedAmount = roundCurrency(ruleAmount * input.mileage);
        break;
      case "per_trip":
        calculatedAmount = ruleAmount;
        break;
      case "surcharge":
        calculatedAmount = ruleAmount;
        break;
      case "percentage":
        calculatedAmount = roundCurrency(subtotal * (ruleAmount / 100));
        break;
      default:
        logger.warn("Unknown fee rule type", { type: rule.type, ruleId: rule.id });
        continue;
    }

    if (calculatedAmount === 0) continue;

    lineItems.push({
      feeRuleId: rule.id,
      name: rule.name,
      type: rule.type,
      amount: calculatedAmount,
      description: `${rule.name}: ${formatFeeDescription(rule.type, ruleAmount, input.mileage)}`,
    });

    subtotal = roundCurrency(subtotal + calculatedAmount);
  }

  return {
    lineItems,
    subtotal,
    currency: "usd",
  };
}

function matchesConditions(conditions: Record<string, unknown> | null, input: FeeCalculationInput): boolean {
  if (!conditions || Object.keys(conditions).length === 0) return true;

  if (conditions.minMileage && input.mileage < Number(conditions.minMileage)) return false;
  if (conditions.maxMileage && input.mileage > Number(conditions.maxMileage)) return false;

  if (conditions.dayOfWeek) {
    const tz = input.timezone || DEFAULT_TIMEZONE;
    const day = getDayInTimezone(input.scheduledAt, tz);
    const allowedDays = conditions.dayOfWeek as number[];
    if (Array.isArray(allowedDays) && !allowedDays.includes(day)) return false;
  }

  if (conditions.afterHour || conditions.beforeHour) {
    const tz = input.timezone || DEFAULT_TIMEZONE;
    const hour = getHourInTimezone(input.scheduledAt, tz);
    if (conditions.afterHour && hour < Number(conditions.afterHour)) return false;
    if (conditions.beforeHour && hour >= Number(conditions.beforeHour)) return false;
  }

  return true;
}

function formatFeeDescription(type: string, amount: number, mileage: number): string {
  switch (type) {
    case "flat":
      return `$${amount.toFixed(2)} flat fee`;
    case "per_mile":
      return `$${amount.toFixed(2)}/mile x ${mileage.toFixed(1)} miles`;
    case "per_trip":
      return `$${amount.toFixed(2)} per trip`;
    case "surcharge":
      return `$${amount.toFixed(2)} surcharge`;
    case "percentage":
      return `${amount}% of subtotal`;
    default:
      return `$${amount.toFixed(2)}`;
  }
}

export function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function validateFeeRule(rule: {
  type: string;
  amount: number;
  conditions?: Record<string, unknown>;
}): string[] {
  const errors: string[] = [];

  const validTypes = ["flat", "per_mile", "per_trip", "surcharge", "percentage"];
  if (!validTypes.includes(rule.type)) {
    errors.push(`Invalid fee type: ${rule.type}. Valid types: ${validTypes.join(", ")}`);
  }

  if (rule.type === "percentage" && (rule.amount < 0 || rule.amount > 100)) {
    errors.push("Percentage fee must be between 0 and 100");
  }

  if (rule.amount < 0) {
    errors.push("Fee amount cannot be negative");
  }

  if (rule.conditions) {
    if (rule.conditions.minMileage !== undefined && rule.conditions.maxMileage !== undefined) {
      if (Number(rule.conditions.minMileage) > Number(rule.conditions.maxMileage)) {
        errors.push("minMileage cannot be greater than maxMileage");
      }
    }
  }

  return errors;
}
