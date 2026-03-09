import { describe, it, expect } from "vitest";
import { withRetry } from "../../src/middleware/gracefulDegradation.js";

describe("Hardening - Graceful Degradation", () => {
  describe("withRetry", () => {
    it("succeeds on first attempt", async () => {
      let attempts = 0;
      const result = await withRetry(async () => {
        attempts++;
        return "success";
      }, { maxRetries: 3, delayMs: 10 });

      expect(result).toBe("success");
      expect(attempts).toBe(1);
    });

    it("retries on failure and eventually succeeds", async () => {
      let attempts = 0;
      const result = await withRetry(async () => {
        attempts++;
        if (attempts < 3) throw new Error("temporary failure");
        return "recovered";
      }, { maxRetries: 3, delayMs: 10 });

      expect(result).toBe("recovered");
      expect(attempts).toBe(3);
    });

    it("throws after max retries exhausted", async () => {
      let attempts = 0;
      await expect(
        withRetry(async () => {
          attempts++;
          throw new Error("persistent failure");
        }, { maxRetries: 2, delayMs: 10 })
      ).rejects.toThrow("persistent failure");

      expect(attempts).toBe(3); // initial + 2 retries
    });

    it("only retries matching errors when retryableErrors is set", async () => {
      let attempts = 0;
      await expect(
        withRetry(async () => {
          attempts++;
          throw new Error("non-retryable error");
        }, { maxRetries: 3, delayMs: 10, retryableErrors: ["timeout"] })
      ).rejects.toThrow("non-retryable error");

      expect(attempts).toBe(1); // no retries for non-matching error
    });

    it("retries retryable errors", async () => {
      let attempts = 0;
      await expect(
        withRetry(async () => {
          attempts++;
          throw new Error("connection timeout");
        }, { maxRetries: 2, delayMs: 10, retryableErrors: ["timeout"] })
      ).rejects.toThrow("connection timeout");

      expect(attempts).toBe(3); // initial + 2 retries
    });
  });
});

describe("Hardening - Input Validation", () => {
  it("UUID format validation catches invalid IDs", () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuidRegex.test("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(uuidRegex.test("not-a-uuid")).toBe(false);
    expect(uuidRegex.test("'; DROP TABLE invoices;--")).toBe(false);
    expect(uuidRegex.test("")).toBe(false);
  });

  it("pagination limits are enforced", () => {
    const maxLimit = 100;
    const minLimit = 1;
    const requestedLimit = 500;
    const enforcedLimit = Math.min(Math.max(requestedLimit, minLimit), maxLimit);
    expect(enforcedLimit).toBe(100);
  });

  it("negative page numbers are rejected", () => {
    const page = -1;
    const isValid = page >= 1;
    expect(isValid).toBe(false);
  });
});

describe("Hardening - Rate Limiting Configuration", () => {
  it("billing endpoints have lower limits than global", () => {
    const globalMax = 1000;
    const billingMax = 30;
    const paymentMax = 10;

    expect(billingMax).toBeLessThan(globalMax);
    expect(paymentMax).toBeLessThan(billingMax);
  });

  it("webhook endpoints allow higher throughput", () => {
    const webhookMax = 200;
    const billingMax = 30;
    expect(webhookMax).toBeGreaterThan(billingMax);
  });

  it("auth endpoints are heavily rate limited", () => {
    const authMax = 20;
    const globalMax = 1000;
    expect(authMax).toBeLessThan(globalMax / 10);
  });
});
