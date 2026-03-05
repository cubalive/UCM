import { describe, it, expect, vi } from "vitest";

/**
 * Tests for tenant isolation logic.
 *
 * We import the actual functions from tenantGuard.ts since they are exported.
 * For functions that need Express req/res mocks, we create minimal fakes.
 */

// Mock systemEvents to avoid DB dependency
vi.mock("../lib/systemEvents", () => ({
  logSystemEvent: vi.fn().mockResolvedValue(undefined),
}));

import { tenantGuard, getEffectiveCompanyId, requireCompanyId, checkCrossCompanyAccess, tenantRedisKey } from "../lib/tenantGuard";

function mockReq(overrides: any = {}) {
  return {
    path: "/api/trips",
    method: "GET",
    headers: {},
    user: null,
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

describe("tenantGuard middleware", () => {
  it("passes through exempt paths without auth", () => {
    const req = mockReq({ path: "/api/auth/login" });
    const next = vi.fn();
    tenantGuard(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("passes through /api/health", () => {
    const req = mockReq({ path: "/api/health" });
    const next = vi.fn();
    tenantGuard(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("passes through /api/public/* paths", () => {
    const req = mockReq({ path: "/api/public/booking" });
    const next = vi.fn();
    tenantGuard(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("passes through if no user", () => {
    const req = mockReq({ user: null });
    const next = vi.fn();
    tenantGuard(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("sets companyId from user for regular users", () => {
    const req = mockReq({ user: { userId: 1, role: "ADMIN", companyId: 42 } });
    const next = vi.fn();
    tenantGuard(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.companyId).toBe(42);
  });

  it("SUPER_ADMIN can override companyId via header", () => {
    const req = mockReq({
      user: { userId: 1, role: "SUPER_ADMIN", companyId: null },
      headers: { "x-ucm-company-id": "99" },
    });
    const next = vi.fn();
    tenantGuard(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.companyId).toBe(99);
  });

  it("SUPER_ADMIN without header passes through without companyId", () => {
    const req = mockReq({
      user: { userId: 1, role: "SUPER_ADMIN", companyId: null },
    });
    const next = vi.fn();
    tenantGuard(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.companyId).toBeUndefined();
  });
});

describe("getEffectiveCompanyId", () => {
  it("returns null for unauthenticated requests", () => {
    const req = mockReq({ user: null });
    expect(getEffectiveCompanyId(req)).toBeNull();
  });

  it("returns user companyId for regular users", () => {
    const req = mockReq({ user: { userId: 1, role: "ADMIN", companyId: 42 } });
    expect(getEffectiveCompanyId(req)).toBe(42);
  });

  it("returns header companyId for SUPER_ADMIN", () => {
    const req = mockReq({
      user: { userId: 1, role: "SUPER_ADMIN", companyId: null },
      headers: { "x-ucm-company-id": "99" },
    });
    expect(getEffectiveCompanyId(req)).toBe(99);
  });

  it("returns null for SUPER_ADMIN without header", () => {
    const req = mockReq({
      user: { userId: 1, role: "SUPER_ADMIN", companyId: null },
    });
    expect(getEffectiveCompanyId(req)).toBeNull();
  });

  it("ignores invalid header values", () => {
    const req = mockReq({
      user: { userId: 1, role: "SUPER_ADMIN", companyId: null },
      headers: { "x-ucm-company-id": "not-a-number" },
    });
    expect(getEffectiveCompanyId(req)).toBeNull();
  });

  it("ignores zero or negative header values", () => {
    const req = mockReq({
      user: { userId: 1, role: "SUPER_ADMIN", companyId: null },
      headers: { "x-ucm-company-id": "0" },
    });
    expect(getEffectiveCompanyId(req)).toBeNull();
  });
});

describe("requireCompanyId middleware", () => {
  it("returns 401 for unauthenticated requests", () => {
    const req = mockReq({ user: null });
    const res = mockRes();
    const next = vi.fn();
    requireCompanyId(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 for users without companyId", () => {
    const req = mockReq({ user: { userId: 1, role: "ADMIN", companyId: null } });
    const res = mockRes();
    const next = vi.fn();
    requireCompanyId(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("COMPANY_REQUIRED");
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through for users with companyId", () => {
    const req = mockReq({ user: { userId: 1, role: "ADMIN", companyId: 42 } });
    const res = mockRes();
    const next = vi.fn();
    requireCompanyId(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.companyId).toBe(42);
  });

  it("SUPER_ADMIN always passes", () => {
    const req = mockReq({ user: { userId: 1, role: "SUPER_ADMIN", companyId: null } });
    const res = mockRes();
    const next = vi.fn();
    requireCompanyId(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe("checkCrossCompanyAccess", () => {
  const req = mockReq({ user: { userId: 1, role: "ADMIN" } });

  it("allows access when no requestCompanyId (SUPER_ADMIN)", () => {
    expect(checkCrossCompanyAccess({ companyId: 42 }, null, req, "trip", 1)).toBe(true);
  });

  it("allows access when entity has no companyId", () => {
    expect(checkCrossCompanyAccess({ companyId: null }, 42, req, "trip", 1)).toBe(true);
  });

  it("allows access when companyIds match", () => {
    expect(checkCrossCompanyAccess({ companyId: 42 }, 42, req, "trip", 1)).toBe(true);
  });

  it("DENIES access when companyIds differ", () => {
    expect(checkCrossCompanyAccess({ companyId: 99 }, 42, req, "trip", 1)).toBe(false);
  });

  it("denies access when entity is undefined", () => {
    expect(checkCrossCompanyAccess(undefined, 42, req, "trip", 1)).toBe(false);
  });
});

describe("tenantRedisKey", () => {
  it("prefixes with company ID", () => {
    expect(tenantRedisKey(42, "trips", "count")).toBe("company:42:trips:count");
  });

  it("uses global prefix when no companyId", () => {
    expect(tenantRedisKey(null, "metrics")).toBe("global:metrics");
  });

  it("uses global prefix when companyId is undefined", () => {
    expect(tenantRedisKey(undefined, "cache", "key")).toBe("global:cache:key");
  });
});
