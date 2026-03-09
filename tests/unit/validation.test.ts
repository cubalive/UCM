import { describe, it, expect } from "vitest";
import { z } from "zod";

// Test the validation schemas used in billing routes
const generateInvoiceSchema = z.object({
  patientId: z.string().uuid().optional(),
  billingCycleId: z.string().uuid().optional(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
}).refine(data => data.periodStart < data.periodEnd, {
  message: "periodStart must be before periodEnd",
});

const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  stripePaymentIntentId: z.string().optional(),
});

const createFeeRuleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  type: z.enum(["flat", "per_mile", "per_trip", "surcharge", "percentage"]),
  amount: z.number().min(0),
  currency: z.string().length(3).default("usd"),
  conditions: z.record(z.unknown()).optional(),
  priority: z.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

describe("Zod Validation Schemas", () => {
  describe("generateInvoiceSchema", () => {
    it("accepts valid input", () => {
      const result = generateInvoiceSchema.safeParse({
        periodStart: "2024-01-01",
        periodEnd: "2024-01-31",
      });
      expect(result.success).toBe(true);
    });

    it("rejects periodEnd before periodStart", () => {
      const result = generateInvoiceSchema.safeParse({
        periodStart: "2024-01-31",
        periodEnd: "2024-01-01",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing periodStart", () => {
      const result = generateInvoiceSchema.safeParse({
        periodEnd: "2024-01-31",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid UUID for patientId", () => {
      const result = generateInvoiceSchema.safeParse({
        periodStart: "2024-01-01",
        periodEnd: "2024-01-31",
        patientId: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid UUID patientId", () => {
      const result = generateInvoiceSchema.safeParse({
        periodStart: "2024-01-01",
        periodEnd: "2024-01-31",
        patientId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("recordPaymentSchema", () => {
    it("accepts valid payment", () => {
      const result = recordPaymentSchema.safeParse({ amount: 100.50 });
      expect(result.success).toBe(true);
    });

    it("rejects zero amount", () => {
      const result = recordPaymentSchema.safeParse({ amount: 0 });
      expect(result.success).toBe(false);
    });

    it("rejects negative amount", () => {
      const result = recordPaymentSchema.safeParse({ amount: -10 });
      expect(result.success).toBe(false);
    });

    it("accepts with stripePaymentIntentId", () => {
      const result = recordPaymentSchema.safeParse({
        amount: 50,
        stripePaymentIntentId: "pi_123",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("createFeeRuleSchema", () => {
    it("accepts valid flat fee rule", () => {
      const result = createFeeRuleSchema.safeParse({
        name: "Base Fare",
        type: "flat",
        amount: 10,
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty name", () => {
      const result = createFeeRuleSchema.safeParse({
        name: "",
        type: "flat",
        amount: 10,
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid type", () => {
      const result = createFeeRuleSchema.safeParse({
        name: "Test",
        type: "invalid",
        amount: 10,
      });
      expect(result.success).toBe(false);
    });

    it("applies defaults", () => {
      const result = createFeeRuleSchema.safeParse({
        name: "Test",
        type: "flat",
        amount: 10,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.currency).toBe("usd");
        expect(result.data.priority).toBe(0);
        expect(result.data.active).toBe(true);
      }
    });

    it("rejects name over 200 chars", () => {
      const result = createFeeRuleSchema.safeParse({
        name: "A".repeat(201),
        type: "flat",
        amount: 10,
      });
      expect(result.success).toBe(false);
    });
  });
});
