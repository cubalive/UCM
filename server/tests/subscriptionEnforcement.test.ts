import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Redis to avoid external dependencies
vi.mock("../lib/redis", () => ({
  getJson: vi.fn().mockResolvedValue(null),
  setJson: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
  isRedisConnected: vi.fn().mockReturnValue(false),
}));

// Mock systemEvents to avoid DB dependency
vi.mock("../lib/systemEvents", () => ({
  logSystemEvent: vi.fn().mockResolvedValue(undefined),
}));

import {
  checkWriteAllowed,
  isStatusActive,
  isStatusGracePeriod,
  isWithinGrace,
  graceDaysRemaining,
  getUsageCounts,
  invalidateUsageCache,
  logEnforcementAction,
  DEFAULT_QUOTAS,
  type SubscriptionContext,
  type UsageCounts,
} from "../services/subscriptionEnforcement";

import { isRedisConnected, getJson, setJson } from "../lib/redis";
import { logSystemEvent } from "../lib/systemEvents";

const mockedIsRedisConnected = vi.mocked(isRedisConnected);
const mockedGetJson = vi.mocked(getJson);
const mockedSetJson = vi.mocked(setJson);
const mockedLogSystemEvent = vi.mocked(logSystemEvent);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<SubscriptionContext> = {}): SubscriptionContext {
  return {
    status: "active",
    currentPeriodEnd: null,
    quotas: { ...DEFAULT_QUOTAS },
    enabled: true,
    required: true,
    ...overrides,
  };
}

function makeUsage(overrides: Partial<UsageCounts> = {}): UsageCounts {
  return {
    driversCount: 5,
    activeTripsCount: 10,
    clinicsCount: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

describe("isStatusActive", () => {
  it("returns true for active", () => {
    expect(isStatusActive("active")).toBe(true);
  });

  it("returns true for trialing", () => {
    expect(isStatusActive("trialing")).toBe(true);
  });

  it("returns false for canceled", () => {
    expect(isStatusActive("canceled")).toBe(false);
  });

  it("returns false for past_due", () => {
    expect(isStatusActive("past_due")).toBe(false);
  });

  it("returns false for paused", () => {
    expect(isStatusActive("paused")).toBe(false);
  });
});

describe("isStatusGracePeriod", () => {
  it("returns true for past_due", () => {
    expect(isStatusGracePeriod("past_due")).toBe(true);
  });

  it("returns false for active", () => {
    expect(isStatusGracePeriod("active")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Grace period
// ---------------------------------------------------------------------------

describe("graceDaysRemaining", () => {
  it("returns 0 for non-past_due statuses", () => {
    expect(graceDaysRemaining("active", new Date())).toBe(0);
    expect(graceDaysRemaining("canceled", new Date())).toBe(0);
  });

  it("returns full grace when no period end", () => {
    expect(graceDaysRemaining("past_due", null, 7)).toBe(7);
  });

  it("returns positive days when within grace", () => {
    const periodEnd = new Date(); // just ended
    const days = graceDaysRemaining("past_due", periodEnd, 7);
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(7);
  });

  it("returns 0 when grace has expired", () => {
    const periodEnd = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    expect(graceDaysRemaining("past_due", periodEnd, 7)).toBe(0);
  });
});

describe("isWithinGrace", () => {
  it("returns true for past_due within grace", () => {
    const periodEnd = new Date(); // just ended
    expect(isWithinGrace("past_due", periodEnd, 7)).toBe(true);
  });

  it("returns false for past_due beyond grace", () => {
    const periodEnd = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    expect(isWithinGrace("past_due", periodEnd, 7)).toBe(false);
  });

  it("returns false for active status", () => {
    expect(isWithinGrace("active", new Date(), 7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkWriteAllowed
// ---------------------------------------------------------------------------

describe("checkWriteAllowed", () => {
  describe("enforcement disabled", () => {
    it("allows everything when enforcement is not enabled", () => {
      const ctx = makeContext({ enabled: false });
      const result = checkWriteAllowed("driver", ctx, makeUsage(), 1);
      expect(result.allowed).toBe(true);
    });

    it("allows everything when subscription not required", () => {
      const ctx = makeContext({ required: false });
      const result = checkWriteAllowed("trip", ctx, makeUsage(), 1);
      expect(result.allowed).toBe(true);
    });
  });

  describe("active subscription", () => {
    it("allows driver creation within quota", () => {
      const ctx = makeContext({ status: "active" });
      const usage = makeUsage({ driversCount: 10 });
      const result = checkWriteAllowed("driver", ctx, usage, 1);
      expect(result.allowed).toBe(true);
    });

    it("allows trip creation within quota", () => {
      const ctx = makeContext({ status: "active" });
      const usage = makeUsage({ activeTripsCount: 50 });
      const result = checkWriteAllowed("trip", ctx, usage, 1);
      expect(result.allowed).toBe(true);
    });

    it("allows clinic creation within quota", () => {
      const ctx = makeContext({ status: "active" });
      const usage = makeUsage({ clinicsCount: 5 });
      const result = checkWriteAllowed("clinic", ctx, usage, 1);
      expect(result.allowed).toBe(true);
    });
  });

  describe("trialing subscription", () => {
    it("allows writes within quota", () => {
      const ctx = makeContext({ status: "trialing" });
      const usage = makeUsage({ driversCount: 1 });
      const result = checkWriteAllowed("driver", ctx, usage, 1);
      expect(result.allowed).toBe(true);
    });
  });

  describe("quota exceeded", () => {
    it("blocks driver creation when at max", () => {
      const ctx = makeContext({ quotas: { ...DEFAULT_QUOTAS, maxDrivers: 10 } });
      const usage = makeUsage({ driversCount: 10 });
      const result = checkWriteAllowed("driver", ctx, usage, 42);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe("QUOTA_EXCEEDED");
      expect(result.metadata?.limitName).toBe("max_drivers");
      expect(result.metadata?.currentUsage).toBe(10);
      expect(result.metadata?.limitValue).toBe(10);
      expect(result.metadata?.companyId).toBe(42);
    });

    it("blocks trip creation when at max", () => {
      const ctx = makeContext({ quotas: { ...DEFAULT_QUOTAS, maxActiveTrips: 5 } });
      const usage = makeUsage({ activeTripsCount: 5 });
      const result = checkWriteAllowed("trip", ctx, usage, 1);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe("QUOTA_EXCEEDED");
      expect(result.metadata?.limitName).toBe("max_active_trips");
    });

    it("blocks clinic creation when at max", () => {
      const ctx = makeContext({ quotas: { ...DEFAULT_QUOTAS, maxClinics: 3 } });
      const usage = makeUsage({ clinicsCount: 3 });
      const result = checkWriteAllowed("clinic", ctx, usage, 1);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe("QUOTA_EXCEEDED");
      expect(result.metadata?.limitName).toBe("max_clinics");
    });

    it("allows when under quota", () => {
      const ctx = makeContext({ quotas: { ...DEFAULT_QUOTAS, maxDrivers: 10 } });
      const usage = makeUsage({ driversCount: 9 });
      const result = checkWriteAllowed("driver", ctx, usage, 1);
      expect(result.allowed).toBe(true);
    });
  });

  describe("inactive subscription", () => {
    it("blocks writes when canceled", () => {
      const ctx = makeContext({ status: "canceled" });
      const result = checkWriteAllowed("driver", ctx, makeUsage(), 1);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe("SUBSCRIPTION_INACTIVE");
      expect(result.metadata?.status).toBe("canceled");
    });

    it("blocks writes when paused", () => {
      const ctx = makeContext({ status: "paused" });
      const result = checkWriteAllowed("trip", ctx, makeUsage(), 1);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe("SUBSCRIPTION_INACTIVE");
    });
  });

  describe("past_due within grace", () => {
    it("allows writes within grace period", () => {
      const periodEnd = new Date(); // just ended, grace still active
      const ctx = makeContext({ status: "past_due", currentPeriodEnd: periodEnd });
      const usage = makeUsage({ driversCount: 5 });
      const result = checkWriteAllowed("driver", ctx, usage, 1);
      expect(result.allowed).toBe(true);
    });

    it("still enforces quotas within grace", () => {
      const periodEnd = new Date();
      const ctx = makeContext({
        status: "past_due",
        currentPeriodEnd: periodEnd,
        quotas: { ...DEFAULT_QUOTAS, maxDrivers: 5 },
      });
      const usage = makeUsage({ driversCount: 5 });
      const result = checkWriteAllowed("driver", ctx, usage, 1);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe("QUOTA_EXCEEDED");
    });
  });

  describe("past_due beyond grace", () => {
    it("blocks writes after grace expires", () => {
      const periodEnd = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      const ctx = makeContext({ status: "past_due", currentPeriodEnd: periodEnd });
      const result = checkWriteAllowed("trip", ctx, makeUsage(), 1);
      expect(result.allowed).toBe(false);
      expect(result.code).toBe("SUBSCRIPTION_INACTIVE");
      expect(result.metadata?.graceDaysRemaining).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Redis caching for usage counts
// ---------------------------------------------------------------------------

describe("getUsageCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls DB function when Redis is not connected", async () => {
    mockedIsRedisConnected.mockReturnValue(false);
    const dbFn = vi.fn().mockResolvedValue({ driversCount: 5, activeTripsCount: 10, clinicsCount: 2 });
    const result = await getUsageCounts(42, dbFn);
    expect(result.driversCount).toBe(5);
    expect(dbFn).toHaveBeenCalledWith(42);
  });

  it("returns cached value when available", async () => {
    mockedIsRedisConnected.mockReturnValue(true);
    mockedGetJson.mockResolvedValue({ driversCount: 3, activeTripsCount: 7, clinicsCount: 1 });
    const dbFn = vi.fn();
    const result = await getUsageCounts(42, dbFn);
    expect(result.driversCount).toBe(3);
    expect(dbFn).not.toHaveBeenCalled();
  });

  it("queries DB and caches when cache miss", async () => {
    mockedIsRedisConnected.mockReturnValue(true);
    mockedGetJson.mockResolvedValue(null);
    const dbFn = vi.fn().mockResolvedValue({ driversCount: 8, activeTripsCount: 20, clinicsCount: 4 });
    const result = await getUsageCounts(42, dbFn);
    expect(result.driversCount).toBe(8);
    expect(dbFn).toHaveBeenCalledWith(42);
    expect(mockedSetJson).toHaveBeenCalledWith(
      "company:42:usage_counts",
      expect.objectContaining({ driversCount: 8 }),
      30,
    );
  });
});

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

describe("logEnforcementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs enforcement event to system events", async () => {
    const result = {
      allowed: false as const,
      code: "QUOTA_EXCEEDED" as const,
      reason: "max_drivers exceeded",
      metadata: { companyId: 42, limitName: "max_drivers", currentUsage: 50, limitValue: 50 },
    };
    await logEnforcementAction(42, 1, "/api/drivers", result);
    expect(mockedLogSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 42,
        actorUserId: 1,
        eventType: "subscription_enforcement",
        entityType: "QUOTA_EXCEEDED",
        entityId: "/api/drivers",
      }),
    );
  });

  it("does not throw on logging failure", async () => {
    mockedLogSystemEvent.mockRejectedValue(new Error("DB down"));
    await expect(
      logEnforcementAction(42, 1, "/api/drivers", { allowed: false, code: "SUBSCRIPTION_INACTIVE" }),
    ).resolves.not.toThrow();
  });
});
