import { z } from "zod";

/**
 * H-7: Universal money validation for all financial amount fields.
 * Amounts are in cents (integer) to avoid floating point issues.
 */
export const moneySchema = z.number()
  .int("Amount must be an integer (cents)")
  .min(1, "Amount must be greater than zero")
  .max(10_000_000, "Amount exceeds maximum ($100,000)");

export const optionalMoneySchema = moneySchema.optional();

/**
 * For amounts that can be zero (e.g., free trips, discounts applied).
 */
export const moneySchemaAllowZero = z.number()
  .int("Amount must be an integer (cents)")
  .min(0, "Amount cannot be negative")
  .max(10_000_000, "Amount exceeds maximum ($100,000)");

/**
 * For decimal dollar amounts (legacy fields using numeric type).
 */
export const dollarAmountSchema = z.string()
  .regex(/^\d+(\.\d{1,2})?$/, "Invalid dollar amount format")
  .refine((val) => parseFloat(val) >= 0, "Amount cannot be negative")
  .refine((val) => parseFloat(val) <= 100_000, "Amount exceeds maximum ($100,000)");
