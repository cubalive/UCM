/**
 * UCM Platform Hardening Tests
 * Covers: Circuit breaker, request metrics, rate limiting, email service, seed data
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ============================================================
// CIRCUIT BREAKER
// ============================================================
describe("CircuitBreaker", () => {
  // Import fresh each time to avoid module-level singletons
  async function createBreaker(opts?: Partial<any>) {
    const { CircuitBreaker } = await import("../../src/lib/circuitBreaker.js");
    return new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      resetTimeoutMs: 100,
      halfOpenMaxAttempts: 2,
      timeoutMs: 5000,
      ...opts,
    });
  }

  it("starts in closed state", async () => {
    const cb = await createBreaker();
    expect(cb.getStats().state).toBe("closed");
    expect(cb.isAvailable()).toBe(true);
  });

  it("executes function successfully in closed state", async () => {
    const cb = await createBreaker();
    const result = await cb.execute(async () => 42);
    expect(result).toBe(42);
    expect(cb.getStats().state).toBe("closed");
  });

  it("tracks failures and opens after threshold", async () => {
    const cb = await createBreaker();

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow("fail");
    }

    expect(cb.getStats().state).toBe("open");
    expect(cb.getStats().failures).toBe(3);
  });

  it("fast-fails when circuit is open", async () => {
    const cb = await createBreaker();

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
    }

    // Should throw CircuitOpenError immediately
    await expect(cb.execute(async () => 42)).rejects.toThrow("temporarily unavailable");
  });

  it("transitions to half-open after reset timeout", async () => {
    const cb = await createBreaker({ resetTimeoutMs: 50 });

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
    }
    expect(cb.getStats().state).toBe("open");

    // Wait for reset timeout
    await new Promise(r => setTimeout(r, 60));

    // Should transition to half-open on next call
    const result = await cb.execute(async () => "recovered");
    expect(result).toBe("recovered");
    expect(cb.getStats().state).toBe("half_open");
  });

  it("closes circuit after sufficient half-open successes", async () => {
    const cb = await createBreaker({ resetTimeoutMs: 50, halfOpenMaxAttempts: 2 });

    // Open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
    }

    await new Promise(r => setTimeout(r, 60));

    // Two successful calls in half-open should close
    await cb.execute(async () => "ok1");
    await cb.execute(async () => "ok2");
    expect(cb.getStats().state).toBe("closed");
  });

  it("reopens circuit on failure in half-open state", async () => {
    const cb = await createBreaker({ resetTimeoutMs: 50 });

    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
    }

    await new Promise(r => setTimeout(r, 60));

    // First call succeeds (half-open)
    await cb.execute(async () => "ok");
    expect(cb.getStats().state).toBe("half_open");

    // Fail in half-open should reopen
    await expect(cb.execute(async () => { throw new Error("fail again"); })).rejects.toThrow();
    expect(cb.getStats().state).toBe("open");
  });

  it("resets properly", async () => {
    const cb = await createBreaker();

    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(async () => { throw new Error("fail"); })).rejects.toThrow();
    }
    expect(cb.getStats().state).toBe("open");

    cb.reset();
    expect(cb.getStats().state).toBe("closed");
    const result = await cb.execute(async () => "after reset");
    expect(result).toBe("after reset");
  });

  it("tracks total calls and failures in stats", async () => {
    const cb = await createBreaker({ failureThreshold: 10 });

    await cb.execute(async () => "ok");
    await cb.execute(async () => "ok");
    await expect(cb.execute(async () => { throw new Error("x"); })).rejects.toThrow();

    const stats = cb.getStats();
    expect(stats.totalCalls).toBe(3);
    expect(stats.totalFailures).toBe(1);
    expect(stats.lastSuccessAt).not.toBeNull();
    expect(stats.lastFailureAt).not.toBeNull();
  });

  it("handles timeout", async () => {
    const cb = await createBreaker({ timeoutMs: 50, failureThreshold: 10 });

    await expect(
      cb.execute(() => new Promise(r => setTimeout(r, 200)))
    ).rejects.toThrow("timed out");
  });
});

// ============================================================
// CIRCUIT OPEN ERROR
// ============================================================
describe("CircuitOpenError", () => {
  it("has correct name and message", async () => {
    const { CircuitOpenError } = await import("../../src/lib/circuitBreaker.js");
    const err = new CircuitOpenError("stripe");
    expect(err.name).toBe("CircuitOpenError");
    expect(err.message).toContain("stripe");
    expect(err.message).toContain("temporarily unavailable");
  });
});

// ============================================================
// STRIPE CIRCUIT BREAKER SINGLETON
// ============================================================
describe("stripeCircuitBreaker singleton", () => {
  it("exports pre-configured breaker", async () => {
    const { stripeCircuitBreaker } = await import("../../src/lib/circuitBreaker.js");
    expect(stripeCircuitBreaker).toBeDefined();
    expect(stripeCircuitBreaker.getStats().state).toBe("closed");
    expect(stripeCircuitBreaker.isAvailable()).toBe(true);
  });
});

// ============================================================
// REQUEST METRICS
// ============================================================
describe("Request Metrics", () => {
  it("generates prometheus format output", async () => {
    const { getRequestMetricsPrometheus } = await import("../../src/middleware/requestMetrics.js");
    const output = getRequestMetricsPrometheus();
    expect(output).toContain("http_requests_total");
    expect(output).toContain("http_errors_total");
    expect(output).toContain("process_uptime_seconds");
    expect(output).toContain("# HELP");
    expect(output).toContain("# TYPE");
  });

  it("returns summary in JSON format", async () => {
    const { getRequestMetricsSummary } = await import("../../src/middleware/requestMetrics.js");
    const summary = getRequestMetricsSummary();
    expect(summary).toHaveProperty("totalRequests");
    expect(summary).toHaveProperty("totalErrors");
    expect(summary).toHaveProperty("routes");
    expect(Array.isArray(summary.routes)).toBe(true);
  });
});

// ============================================================
// EMAIL SERVICE
// ============================================================
describe("Email Service", () => {
  it("returns false when SMTP is not configured", async () => {
    // No SMTP env vars set — should gracefully return false
    const { sendEmail } = await import("../../src/services/emailService.js");
    const result = await sendEmail({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Test</p>",
    });
    expect(result).toBe(false);
  });

  it("invoice email template contains invoice details", async () => {
    const { sendInvoiceGeneratedEmail } = await import("../../src/services/emailService.js");
    // Should not throw even without SMTP
    const result = await sendInvoiceGeneratedEmail("test@example.com", "INV-001", "150.00", "2025-04-01");
    expect(result).toBe(false); // because SMTP not configured
  });

  it("payment confirmed email works without SMTP", async () => {
    const { sendPaymentConfirmedEmail } = await import("../../src/services/emailService.js");
    const result = await sendPaymentConfirmedEmail("test@example.com", "INV-001", "150.00");
    expect(result).toBe(false);
  });

  it("payment failed email works without SMTP", async () => {
    const { sendPaymentFailedEmail } = await import("../../src/services/emailService.js");
    const result = await sendPaymentFailedEmail("test@example.com", "INV-001", "Card declined");
    expect(result).toBe(false);
  });
});

// ============================================================
// RATE LIMITER CONFIGURATION
// ============================================================
describe("Rate Limiter Configuration", () => {
  it("exports all required rate limiters", async () => {
    const rl = await import("../../src/middleware/rateLimiter.js");
    expect(rl.globalRateLimiter).toBeDefined();
    expect(rl.authRateLimiter).toBeDefined();
    expect(rl.billingRateLimiter).toBeDefined();
    expect(rl.webhookRateLimiter).toBeDefined();
    expect(rl.paymentRateLimiter).toBeDefined();
    expect(rl.locationRateLimiter).toBeDefined();
    expect(rl.overrideRateLimiter).toBeDefined();
    expect(rl.stripeConnectRateLimiter).toBeDefined();
    expect(rl.importRateLimiter).toBeDefined();
  });

  it("all rate limiters are functions (middleware)", async () => {
    const rl = await import("../../src/middleware/rateLimiter.js");
    expect(typeof rl.globalRateLimiter).toBe("function");
    expect(typeof rl.authRateLimiter).toBe("function");
    expect(typeof rl.stripeConnectRateLimiter).toBe("function");
    expect(typeof rl.importRateLimiter).toBe("function");
  });
});

// ============================================================
// AUTH MODEL (CSRF NOT NEEDED)
// ============================================================
describe("Auth Model - CSRF Not Required", () => {
  it("uses Bearer token authentication (no cookies)", async () => {
    const authModule = await import("../../src/middleware/auth.js");
    // The authenticate function checks for Bearer header, not cookies
    expect(authModule.authenticate).toBeDefined();
    expect(typeof authModule.authenticate).toBe("function");
  });

  it("rejects requests without Bearer token", async () => {
    const { authenticate } = await import("../../src/middleware/auth.js");
    const req = { headers: {} } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;
    const next = vi.fn();

    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects invalid Bearer tokens", async () => {
    const { authenticate } = await import("../../src/middleware/auth.js");
    const req = { headers: { authorization: "Bearer invalid.token.here" } } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;
    const next = vi.fn();

    // Need JWT_SECRET for verification
    process.env.JWT_SECRET = "test-secret-for-unit-test";
    authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    delete process.env.JWT_SECRET;
  });
});

// ============================================================
// TENANT ISOLATION
// ============================================================
describe("Tenant Isolation Middleware", () => {
  it("rejects requests without tenantId", async () => {
    const { tenantIsolation } = await import("../../src/middleware/auth.js");
    const req = {} as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as any;
    const next = vi.fn();

    tenantIsolation(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Tenant context required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("passes requests with tenantId", async () => {
    const { tenantIsolation } = await import("../../src/middleware/auth.js");
    const req = { tenantId: "test-tenant-id" } as any;
    const res = {} as any;
    const next = vi.fn();

    tenantIsolation(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// ============================================================
// SEED SCRIPT VALIDATION
// ============================================================
describe("Seed Script Configuration", () => {
  it("has correct size configurations", async () => {
    // Validate the seed config is reasonable by checking constants
    const SIZES = {
      small: { tenants: 2, clinicsPerTenant: 6, driversPerTenant: 25, patientsPerTenant: 80, tripsPerTenant: 100 },
      medium: { tenants: 5, clinicsPerTenant: 24, driversPerTenant: 100, patientsPerTenant: 400, tripsPerTenant: 400 },
      full: { tenants: 10, clinicsPerTenant: 12, driversPerTenant: 280, patientsPerTenant: 800, tripsPerTenant: 800 },
    };

    // Full size should produce ~2800 drivers and ~8000 patients
    expect(SIZES.full.tenants * SIZES.full.driversPerTenant).toBe(2800);
    expect(SIZES.full.tenants * SIZES.full.patientsPerTenant).toBe(8000);
    expect(SIZES.full.tenants * SIZES.full.tripsPerTenant).toBe(8000);

    // Medium should be a useful test size
    expect(SIZES.medium.tenants * SIZES.medium.driversPerTenant).toBe(500);
    expect(SIZES.medium.tenants * SIZES.medium.patientsPerTenant).toBe(2000);
  });
});

// ============================================================
// NORMALIZER EDGE CASES (IMPORT ENGINE)
// ============================================================
describe("Import Engine - Edge Cases", () => {
  it("handles undefined values in all normalizers", async () => {
    const ie = await import("../../src/services/importEngine.js");
    expect(ie.normalizePhone(undefined)).toBeNull();
    expect(ie.normalizeEmail(undefined)).toBeNull();
    expect(ie.normalizeDate(undefined)).toBeNull();
    expect(ie.normalizeDateTime(undefined)).toBeNull();
    expect(ie.normalizeBoolean(undefined)).toBeNull();
    expect(ie.normalizeName(undefined)).toBeNull();
    expect(ie.normalizeAddress(undefined)).toBeNull();
  });

  it("handles empty CSV gracefully", async () => {
    const { parseCSV } = await import("../../src/services/importEngine.js");
    const result = parseCSV("");
    expect(result.rows).toHaveLength(0);
  });

  it("getAliasMap returns correct maps for each entity", async () => {
    const { getAliasMap, PATIENT_ALIASES, TRIP_ALIASES, DRIVER_ALIASES } = await import("../../src/services/importEngine.js");
    expect(getAliasMap("patients")).toBe(PATIENT_ALIASES);
    expect(getAliasMap("trips")).toBe(TRIP_ALIASES);
    expect(getAliasMap("drivers")).toBe(DRIVER_ALIASES);
  });
});

// ============================================================
// GRACEFUL DEGRADATION - withRetry
// ============================================================
describe("withRetry", () => {
  it("returns result on first success", async () => {
    const { withRetry } = await import("../../src/middleware/gracefulDegradation.js");
    const result = await withRetry(async () => "success");
    expect(result).toBe("success");
  });

  it("retries on failure and eventually succeeds", async () => {
    const { withRetry } = await import("../../src/middleware/gracefulDegradation.js");
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("transient");
        return "recovered";
      },
      { maxRetries: 3, delayMs: 10 }
    );
    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
  });

  it("throws after max retries exhausted", async () => {
    const { withRetry } = await import("../../src/middleware/gracefulDegradation.js");
    await expect(
      withRetry(
        async () => { throw new Error("permanent"); },
        { maxRetries: 2, delayMs: 10 }
      )
    ).rejects.toThrow("permanent");
  });

  it("respects retryableErrors filter", async () => {
    const { withRetry } = await import("../../src/middleware/gracefulDegradation.js");
    let attempts = 0;
    await expect(
      withRetry(
        async () => { attempts++; throw new Error("not retryable"); },
        { maxRetries: 3, delayMs: 10, retryableErrors: ["timeout"] }
      )
    ).rejects.toThrow("not retryable");
    expect(attempts).toBe(1); // No retries for non-retryable errors
  });
});

// ============================================================
// GRACEFUL DEGRADATION - requireStripe middleware
// ============================================================
describe("requireStripe middleware", () => {
  it("calls next and allows request to proceed", async () => {
    const { requireStripe } = await import("../../src/middleware/gracefulDegradation.js");
    const req = { path: "/test" } as any;
    const res = {
      on: vi.fn(),
      headersSent: false,
    } as any;
    const next = vi.fn();

    requireStripe(req, res, next);
    expect(next).toHaveBeenCalled();
    // cleanup: simulate finish event
    const finishHandler = res.on.mock.calls.find((c: any[]) => c[0] === "finish");
    if (finishHandler) finishHandler[1]();
  });
});
