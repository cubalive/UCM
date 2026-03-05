import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external dependencies
vi.mock("../services/subscriptionService", () => ({
  checkCompanyAccess: vi.fn(),
  getCompanySubscription: vi.fn(),
  getCompanySubSettings: vi.fn(),
}));

vi.mock("../services/subscriptionEnforcement", () => ({
  checkWriteAllowed: vi.fn().mockReturnValue({ allowed: true }),
  getUsageCounts: vi.fn().mockResolvedValue({ driversCount: 0, activeTripsCount: 0, clinicsCount: 0 }),
  logEnforcementAction: vi.fn().mockResolvedValue(undefined),
  isWithinGrace: vi.fn().mockReturnValue(false),
  graceDaysRemaining: vi.fn().mockReturnValue(0),
  DEFAULT_QUOTAS: { maxDrivers: 50, maxActiveTrips: 200, maxClinics: 20 },
}));

vi.mock("../lib/systemEvents", () => ({
  logSystemEvent: vi.fn().mockResolvedValue(undefined),
}));

import { requireSubscription, enforceQuota } from "../middleware/requireSubscription";
import { checkCompanyAccess, getCompanySubscription, getCompanySubSettings } from "../services/subscriptionService";
import { checkWriteAllowed, getUsageCounts, logEnforcementAction } from "../services/subscriptionEnforcement";

const mockedCheckAccess = vi.mocked(checkCompanyAccess);
const mockedGetSub = vi.mocked(getCompanySubscription);
const mockedGetSettings = vi.mocked(getCompanySubSettings);
const mockedCheckWrite = vi.mocked(checkWriteAllowed);
const mockedGetUsage = vi.mocked(getUsageCounts);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function mockReq(overrides: any = {}) {
  return {
    path: "/api/trips",
    method: "GET",
    user: { userId: 1, role: "ADMIN", companyId: 42 },
    ...overrides,
  } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: any) {
      res.body = data;
      return res;
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// requireSubscription middleware
// ---------------------------------------------------------------------------

describe("requireSubscription middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("SUPER_ADMIN always bypasses", async () => {
    const req = mockReq({ user: { userId: 1, role: "SUPER_ADMIN", companyId: null } });
    const next = vi.fn();
    await requireSubscription(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(mockedCheckAccess).not.toHaveBeenCalled();
  });

  it("allows when subscription is active", async () => {
    mockedCheckAccess.mockResolvedValue({ allowed: true });
    const req = mockReq();
    const next = vi.fn();
    await requireSubscription(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks when subscription is inactive", async () => {
    mockedCheckAccess.mockResolvedValue({
      allowed: false,
      reason: "subscription_canceled",
      subscription: { status: "canceled", currentPeriodEnd: null } as any,
    });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    await requireSubscription(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("SUBSCRIPTION_INACTIVE");
  });

  it("allows unauthenticated requests to pass (caught by auth middleware)", async () => {
    const req = mockReq({ user: null });
    const res = mockRes();
    const next = vi.fn();
    await requireSubscription(req, res, next);
    expect(res.statusCode).toBe(401);
  });

  it("allows exempt paths", async () => {
    const req = mockReq({ path: "/health" });
    const next = vi.fn();
    await requireSubscription(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(mockedCheckAccess).not.toHaveBeenCalled();
  });

  it("allows /api/auth paths", async () => {
    const req = mockReq({ path: "/api/auth/login" });
    const next = vi.fn();
    await requireSubscription(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("allows trip completion even when inactive", async () => {
    mockedCheckAccess.mockResolvedValue({
      allowed: false,
      reason: "subscription_canceled",
      subscription: { status: "canceled", currentPeriodEnd: null } as any,
    });
    const req = mockReq({ path: "/api/trips/123/status", method: "POST" });
    const next = vi.fn();
    await requireSubscription(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("allows trip completion /complete path", async () => {
    mockedCheckAccess.mockResolvedValue({
      allowed: false,
      reason: "subscription_canceled",
      subscription: { status: "canceled", currentPeriodEnd: null } as any,
    });
    const req = mockReq({ path: "/api/trips/456/complete", method: "POST" });
    const next = vi.fn();
    await requireSubscription(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("fails open on error", async () => {
    mockedCheckAccess.mockRejectedValue(new Error("DB down"));
    const req = mockReq();
    const next = vi.fn();
    await requireSubscription(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("allows users without companyId (no company context)", async () => {
    const req = mockReq({ user: { userId: 1, role: "ADMIN", companyId: null } });
    const next = vi.fn();
    await requireSubscription(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// enforceQuota middleware
// ---------------------------------------------------------------------------

describe("enforceQuota middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetSub.mockResolvedValue(null);
    mockedGetSettings.mockResolvedValue(null);
    mockedCheckWrite.mockReturnValue({ allowed: true });
    mockedGetUsage.mockResolvedValue({ driversCount: 0, activeTripsCount: 0, clinicsCount: 0 });
  });

  it("SUPER_ADMIN always bypasses quota", async () => {
    const req = mockReq({ user: { userId: 1, role: "SUPER_ADMIN", companyId: null }, method: "POST", path: "/api/drivers" });
    const next = vi.fn();
    await enforceQuota(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(mockedCheckWrite).not.toHaveBeenCalled();
  });

  it("allows GET requests without checking quotas", async () => {
    const req = mockReq({ method: "GET", path: "/api/drivers" });
    const next = vi.fn();
    await enforceQuota(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(mockedCheckWrite).not.toHaveBeenCalled();
  });

  it("checks quota on POST /api/drivers", async () => {
    mockedGetSub.mockResolvedValue({ status: "active", currentPeriodEnd: null } as any);
    mockedGetSettings.mockResolvedValue({ subscriptionEnabled: true, subscriptionRequiredForAccess: true } as any);
    mockedCheckWrite.mockReturnValue({ allowed: true });

    const req = mockReq({ method: "POST", path: "/api/drivers" });
    const next = vi.fn();
    await enforceQuota(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(mockedCheckWrite).toHaveBeenCalled();
  });

  it("blocks when quota exceeded", async () => {
    mockedGetSub.mockResolvedValue({ status: "active", currentPeriodEnd: null } as any);
    mockedGetSettings.mockResolvedValue({ subscriptionEnabled: true, subscriptionRequiredForAccess: true } as any);
    mockedCheckWrite.mockReturnValue({
      allowed: false,
      code: "QUOTA_EXCEEDED",
      reason: "max_drivers exceeded (50/50)",
      metadata: { companyId: 42, limitName: "max_drivers", currentUsage: 50, limitValue: 50 },
    });

    const req = mockReq({ method: "POST", path: "/api/drivers" });
    const res = mockRes();
    const next = vi.fn();
    await enforceQuota(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("QUOTA_EXCEEDED");
    expect(res.body.metadata.limitName).toBe("max_drivers");
  });

  it("allows trip completion even with inactive subscription", async () => {
    const req = mockReq({ method: "POST", path: "/api/trips/123/status" });
    const next = vi.fn();
    await enforceQuota(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(mockedCheckWrite).not.toHaveBeenCalled();
  });

  it("allows POST /api/trips/123/arrive (trip completion)", async () => {
    const req = mockReq({ method: "POST", path: "/api/trips/123/arrive" });
    const next = vi.fn();
    await enforceQuota(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("checks quota on POST /api/trips (new trip creation)", async () => {
    mockedGetSub.mockResolvedValue({ status: "active", currentPeriodEnd: null } as any);
    mockedGetSettings.mockResolvedValue({ subscriptionEnabled: true, subscriptionRequiredForAccess: true } as any);
    mockedCheckWrite.mockReturnValue({ allowed: true });

    const req = mockReq({ method: "POST", path: "/api/trips" });
    const next = vi.fn();
    await enforceQuota(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(mockedCheckWrite).toHaveBeenCalled();
  });

  it("checks quota on POST /api/clinics", async () => {
    mockedGetSub.mockResolvedValue({ status: "active", currentPeriodEnd: null } as any);
    mockedGetSettings.mockResolvedValue({ subscriptionEnabled: true, subscriptionRequiredForAccess: true } as any);
    mockedCheckWrite.mockReturnValue({ allowed: true });

    const req = mockReq({ method: "POST", path: "/api/clinics" });
    const next = vi.fn();
    await enforceQuota(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(mockedCheckWrite).toHaveBeenCalled();
  });

  it("fails open on error", async () => {
    mockedGetSub.mockRejectedValue(new Error("DB down"));
    const req = mockReq({ method: "POST", path: "/api/drivers" });
    const next = vi.fn();
    await enforceQuota(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("logs enforcement when blocking", async () => {
    const mockedLog = vi.mocked(logEnforcementAction);
    mockedGetSub.mockResolvedValue({ status: "active", currentPeriodEnd: null } as any);
    mockedGetSettings.mockResolvedValue({ subscriptionEnabled: true, subscriptionRequiredForAccess: true } as any);
    mockedCheckWrite.mockReturnValue({
      allowed: false,
      code: "QUOTA_EXCEEDED",
      reason: "max_drivers exceeded",
      metadata: { companyId: 42, limitName: "max_drivers", currentUsage: 50, limitValue: 50 },
    });

    const req = mockReq({ method: "POST", path: "/api/drivers" });
    await enforceQuota(req, mockRes(), vi.fn());
    expect(mockedLog).toHaveBeenCalled();
  });
});
