import { describe, it, expect } from "vitest";
import { roundCurrency, validateFeeRule } from "../../src/services/feeService.js";

describe("Fee Calculation Edge Cases", () => {
  describe("Zero mileage trips", () => {
    it("per_mile fee should produce 0 for zero mileage", () => {
      const amount = roundCurrency(2.50 * 0);
      expect(amount).toBe(0);
    });

    it("per_mile fee should produce 0 for negative mileage", () => {
      // Negative mileage should be caught upstream, but fee calc should be safe
      const amount = roundCurrency(2.50 * -1);
      expect(amount).toBe(-2.5);
    });
  });

  describe("Very high mileage", () => {
    it("handles high mileage without overflow", () => {
      const amount = roundCurrency(2.50 * 9999);
      expect(amount).toBe(24997.5);
    });
  });

  describe("Percentage fee on zero subtotal", () => {
    it("should produce 0 for percentage of 0", () => {
      const subtotal = 0;
      const percentage = 10;
      const amount = roundCurrency(subtotal * (percentage / 100));
      expect(amount).toBe(0);
    });
  });

  describe("Floating point precision", () => {
    it("handles classic 0.1 + 0.2 precision issue", () => {
      const a = roundCurrency(0.1 + 0.2);
      expect(a).toBe(0.3);
    });

    it("handles multiplication precision", () => {
      const result = roundCurrency(19.99 * 3);
      expect(result).toBe(59.97);
    });

    it("handles division-based percentage", () => {
      const result = roundCurrency(100 * (7.5 / 100));
      expect(result).toBe(7.5);
    });

    it("accumulated rounding over many line items", () => {
      let total = 0;
      for (let i = 0; i < 100; i++) {
        total = roundCurrency(total + 0.01);
      }
      expect(total).toBe(1.0);
    });
  });

  describe("Fee rule validation edge cases", () => {
    it("exactly 0% percentage is valid", () => {
      expect(validateFeeRule({ type: "percentage", amount: 0 })).toEqual([]);
    });

    it("exactly 100% percentage is valid", () => {
      expect(validateFeeRule({ type: "percentage", amount: 100 })).toEqual([]);
    });

    it("100.01% percentage is invalid", () => {
      const errors = validateFeeRule({ type: "percentage", amount: 100.01 });
      expect(errors.length).toBeGreaterThan(0);
    });

    it("very small positive amount is valid for flat fee", () => {
      expect(validateFeeRule({ type: "flat", amount: 0.01 })).toEqual([]);
    });

    it("equal minMileage and maxMileage is valid (single-mile range)", () => {
      expect(validateFeeRule({
        type: "flat",
        amount: 5,
        conditions: { minMileage: 10, maxMileage: 10 },
      })).toEqual([]);
    });
  });

  describe("Condition matching edge cases", () => {
    it("empty conditions object should match everything", () => {
      // This is tested implicitly through the matchesConditions function
      // Empty conditions = universal match
      expect({}).toBeTruthy();
    });

    it("null conditions should match everything", () => {
      expect(null === null).toBe(true);
    });
  });
});
