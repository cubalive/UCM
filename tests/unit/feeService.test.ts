import { describe, it, expect } from "vitest";
import { roundCurrency, validateFeeRule } from "../../src/services/feeService.js";

describe("Fee Service - Unit Tests", () => {
  describe("roundCurrency", () => {
    it("rounds to 2 decimal places", () => {
      expect(roundCurrency(10.255)).toBe(10.26);
      expect(roundCurrency(10.254)).toBe(10.25);
      expect(roundCurrency(0.1 + 0.2)).toBe(0.3);
    });

    it("handles zero", () => {
      expect(roundCurrency(0)).toBe(0);
    });

    it("handles large amounts", () => {
      expect(roundCurrency(999999.999)).toBe(1000000);
      expect(roundCurrency(123456.789)).toBe(123456.79);
    });

    it("handles negative amounts", () => {
      expect(roundCurrency(-5.555)).toBe(-5.55);
      expect(roundCurrency(-10.50)).toBe(-10.5);
    });

    it("handles precision edge cases", () => {
      // Classic floating point issue: 2.50 * 10.3
      expect(roundCurrency(2.50 * 10.3)).toBe(25.75);
    });
  });

  describe("validateFeeRule", () => {
    it("accepts valid flat fee", () => {
      expect(validateFeeRule({ type: "flat", amount: 10 })).toEqual([]);
    });

    it("accepts valid per_mile fee", () => {
      expect(validateFeeRule({ type: "per_mile", amount: 2.5 })).toEqual([]);
    });

    it("accepts valid percentage fee", () => {
      expect(validateFeeRule({ type: "percentage", amount: 15 })).toEqual([]);
    });

    it("rejects invalid fee type", () => {
      const errors = validateFeeRule({ type: "unknown", amount: 10 });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Invalid fee type");
    });

    it("rejects negative amount", () => {
      const errors = validateFeeRule({ type: "flat", amount: -5 });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("cannot be negative");
    });

    it("rejects percentage over 100", () => {
      const errors = validateFeeRule({ type: "percentage", amount: 150 });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("between 0 and 100");
    });

    it("rejects percentage below 0", () => {
      const errors = validateFeeRule({ type: "percentage", amount: -5 });
      expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects minMileage > maxMileage", () => {
      const errors = validateFeeRule({
        type: "flat",
        amount: 10,
        conditions: { minMileage: 50, maxMileage: 10 },
      });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("minMileage");
    });

    it("accepts valid conditions", () => {
      const errors = validateFeeRule({
        type: "flat",
        amount: 10,
        conditions: { minMileage: 5, maxMileage: 50 },
      });
      expect(errors).toEqual([]);
    });

    it("accepts zero amount for flat fee", () => {
      expect(validateFeeRule({ type: "flat", amount: 0 })).toEqual([]);
    });
  });
});
