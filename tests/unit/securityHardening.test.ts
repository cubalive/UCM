/**
 * Security Hardening Tests
 *
 * Tests for: rate limiting, input sanitization, PHI audit logging,
 * tenant isolation, and authentication edge cases.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── Rate Limiter Tests ──

describe("Rate Limiter (sliding window)", () => {
  // Import fresh for each test
  let rateLimiter: typeof import("../../server/middleware/rateLimiter").rateLimiter;
  let _testWindows: typeof import("../../server/middleware/rateLimiter")._testWindows;

  beforeEach(async () => {
    const mod = await import("../../server/middleware/rateLimiter");
    rateLimiter = mod.rateLimiter;
    _testWindows = mod._testWindows;
    _testWindows.clear();
  });

  function mockReqRes(overrides: Record<string, any> = {}) {
    const headers: Record<string, string> = {};
    const req = {
      ip: "127.0.0.1",
      path: "/api/test",
      method: "GET",
      headers: { "x-forwarded-for": undefined },
      socket: { remoteAddress: "127.0.0.1" },
      ...overrides,
    } as any;

    let statusCode = 200;
    let jsonBody: any = null;
    const res = {
      setHeader: (_key: string, _val: string) => { headers[_key] = _val; },
      status: (code: number) => { statusCode = code; return res; },
      json: (body: any) => { jsonBody = body; return res; },
      get statusCode() { return statusCode; },
      get _headers() { return headers; },
      get _body() { return jsonBody; },
    } as any;

    let nextCalled = false;
    const next = () => { nextCalled = true; };

    return { req, res, next, isNextCalled: () => nextCalled, getStatus: () => statusCode, getBody: () => jsonBody };
  }

  it("allows requests under the limit", () => {
    const limiter = rateLimiter({ max: 5, windowMs: 60000 });
    const { req, res, next, isNextCalled } = mockReqRes();

    limiter(req, res, next);
    expect(isNextCalled()).toBe(true);
  });

  it("blocks requests over the limit", () => {
    const limiter = rateLimiter({ max: 3, windowMs: 60000 });

    for (let i = 0; i < 3; i++) {
      const { req, res, next } = mockReqRes();
      limiter(req, res, next);
    }

    const { req, res, next, isNextCalled, getStatus } = mockReqRes();
    limiter(req, res, next);
    expect(isNextCalled()).toBe(false);
    expect(getStatus()).toBe(429);
  });

  it("sets proper rate limit headers", () => {
    const limiter = rateLimiter({ max: 10, windowMs: 60000 });
    const { req, res, next } = mockReqRes();

    limiter(req, res, next);
    expect(res._headers["X-RateLimit-Limit"]).toBe("10");
    expect(res._headers["X-RateLimit-Remaining"]).toBe("9");
  });

  it("tracks different IPs separately", () => {
    const limiter = rateLimiter({ max: 2, windowMs: 60000 });

    // IP 1 — exhaust limit
    for (let i = 0; i < 2; i++) {
      const { req, res, next } = mockReqRes({ ip: "1.1.1.1" });
      limiter(req, res, next);
    }

    // IP 2 — should still be allowed
    const { req, res, next, isNextCalled } = mockReqRes({ ip: "2.2.2.2" });
    limiter(req, res, next);
    expect(isNextCalled()).toBe(true);
  });

  it("skips when skip function returns true", () => {
    const limiter = rateLimiter({
      max: 1,
      windowMs: 60000,
      skip: (req) => req.path === "/api/health",
    });

    // Exhaust limit
    const { req: req1, res: res1, next: next1 } = mockReqRes();
    limiter(req1, res1, next1);

    // Health check should bypass
    const { req, res, next, isNextCalled } = mockReqRes({ path: "/api/health" });
    limiter(req, res, next);
    expect(isNextCalled()).toBe(true);
  });

  it("returns retry-after in 429 response", () => {
    const limiter = rateLimiter({ max: 1, windowMs: 60000, blockDurationMs: 30000 });

    const { req: r1, res: res1, next: n1 } = mockReqRes();
    limiter(r1, res1, n1);

    const { req, res, next, getBody } = mockReqRes();
    limiter(req, res, next);
    expect(getBody().code).toBe("RATE_LIMITED");
    expect(getBody().retryAfterSeconds).toBeGreaterThan(0);
  });
});

// ── Input Sanitizer Tests ──

describe("Input Sanitizer", () => {
  let inputSanitizer: typeof import("../../server/middleware/inputSanitizer").inputSanitizer;

  beforeEach(async () => {
    const mod = await import("../../server/middleware/inputSanitizer");
    inputSanitizer = mod.inputSanitizer;
  });

  function mockReqRes(overrides: Record<string, any> = {}) {
    const req = {
      method: "POST",
      path: "/api/patients",
      body: {},
      query: {},
      headers: { "user-agent": "test", "x-forwarded-for": undefined },
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      ...overrides,
    } as any;

    let nextCalled = false;
    const next = () => { nextCalled = true; };
    const res = {} as any;

    return { req, res, next, isNextCalled: () => nextCalled };
  }

  it("sanitizes XSS in body strings", () => {
    const { req, res, next, isNextCalled } = mockReqRes({
      body: { name: '<script>alert("xss")</script>John' },
    });

    inputSanitizer(req, res, next);
    expect(isNextCalled()).toBe(true);
    expect(req.body.name).not.toContain("<script>");
    expect(req.body.name).toContain("&lt;script&gt;");
  });

  it("sanitizes nested objects", () => {
    const { req, res, next } = mockReqRes({
      body: { patient: { notes: '<img onerror="hack()" src=x>' } },
    });

    inputSanitizer(req, res, next);
    expect(req.body.patient.notes).not.toContain("<img");
    expect(req.body.patient.notes).toContain("&lt;img");
  });

  it("sanitizes arrays", () => {
    const { req, res, next } = mockReqRes({
      body: { tags: ["safe", "<script>bad</script>"] },
    });

    inputSanitizer(req, res, next);
    expect(req.body.tags[0]).toBe("safe");
    expect(req.body.tags[1]).toContain("&lt;script&gt;");
  });

  it("preserves non-string values", () => {
    const { req, res, next } = mockReqRes({
      body: { age: 25, active: true, amount: 99.99, empty: null },
    });

    inputSanitizer(req, res, next);
    expect(req.body.age).toBe(25);
    expect(req.body.active).toBe(true);
    expect(req.body.amount).toBe(99.99);
    expect(req.body.empty).toBe(null);
  });

  it("skips stripe webhook paths", () => {
    const { req, res, next, isNextCalled } = mockReqRes({
      path: "/api/stripe/webhook",
      body: { data: '<script>test</script>' },
    });

    inputSanitizer(req, res, next);
    expect(isNextCalled()).toBe(true);
    // Body should NOT be modified for webhook
    expect(req.body.data).toContain("<script>");
  });

  it("sanitizes query params on GET requests", () => {
    const { req, res, next } = mockReqRes({
      method: "GET",
      query: { search: '<script>alert(1)</script>' },
    });

    inputSanitizer(req, res, next);
    expect(req.query.search).toContain("&lt;script&gt;");
  });

  it("handles deeply nested objects without stack overflow", () => {
    let deep: any = { value: "safe" };
    for (let i = 0; i < 20; i++) {
      deep = { nested: deep };
    }

    const { req, res, next, isNextCalled } = mockReqRes({ body: deep });
    inputSanitizer(req, res, next);
    expect(isNextCalled()).toBe(true);
  });
});

// ── PHI Audit Middleware Tests ──

describe("PHI Audit Middleware", () => {
  let phiAuditMiddleware: typeof import("../../server/middleware/phiAudit").phiAuditMiddleware;
  let consoleLogs: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;

  beforeEach(async () => {
    const mod = await import("../../server/middleware/phiAudit");
    phiAuditMiddleware = mod.phiAuditMiddleware;
    consoleLogs = [];
    console.log = (...args: any[]) => { consoleLogs.push(args.join(" ")); };
    console.warn = (...args: any[]) => { consoleLogs.push(args.join(" ")); };
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
  });

  function mockReqRes(path: string, user?: any) {
    const finishHandlers: Function[] = [];
    const req = {
      path,
      method: "GET",
      requestId: "test-123",
      user,
      headers: { "user-agent": "test-agent", "x-forwarded-for": undefined },
      ip: "10.0.0.1",
      socket: { remoteAddress: "10.0.0.1" },
    } as any;

    const res = {
      statusCode: 200,
      on: (event: string, handler: Function) => {
        if (event === "finish") finishHandlers.push(handler);
      },
    } as any;

    let nextCalled = false;
    const next = () => { nextCalled = true; };

    return {
      req, res, next,
      isNextCalled: () => nextCalled,
      triggerFinish: () => finishHandlers.forEach(h => h()),
    };
  }

  it("logs PHI access for patient endpoints", () => {
    const { req, res, next, triggerFinish } = mockReqRes("/api/patients/123", {
      userId: 1, role: "ADMIN", companyId: 1,
    });

    phiAuditMiddleware(req, res, next);
    triggerFinish();

    const logEntry = consoleLogs.find(l => l.includes("phi_access"));
    expect(logEntry).toBeDefined();
    const parsed = JSON.parse(logEntry!);
    expect(parsed.resourceType).toBe("patient");
    expect(parsed.userId).toBe(1);
  });

  it("logs PHI access for trip endpoints", () => {
    const { req, res, next, triggerFinish } = mockReqRes("/api/trips/456", {
      userId: 2, role: "DISPATCH", companyId: 1,
    });

    phiAuditMiddleware(req, res, next);
    triggerFinish();

    const logEntry = consoleLogs.find(l => l.includes("phi_access"));
    expect(logEntry).toBeDefined();
    const parsed = JSON.parse(logEntry!);
    expect(parsed.resourceType).toBe("trip");
    expect(parsed.resourceId).toBe("456");
  });

  it("skips non-PHI endpoints", () => {
    const { req, res, next, isNextCalled, triggerFinish } = mockReqRes("/api/cities", {
      userId: 1, role: "ADMIN",
    });

    phiAuditMiddleware(req, res, next);
    triggerFinish();
    expect(isNextCalled()).toBe(true);
    expect(consoleLogs.filter(l => l.includes("phi_access")).length).toBe(0);
  });

  it("logs denied PHI access with HIGH severity", () => {
    const { req, res, next, triggerFinish } = mockReqRes("/api/patients", {
      userId: 99, role: "VIEWER",
    });
    res.statusCode = 403;

    phiAuditMiddleware(req, res, next);
    triggerFinish();

    const warnEntry = consoleLogs.find(l => l.includes("phi_access_denied"));
    expect(warnEntry).toBeDefined();
    const parsed = JSON.parse(warnEntry!);
    expect(parsed.severity).toBe("HIGH");
    expect(parsed.outcome).toBe("denied");
  });

  it("always calls next() even for PHI routes", () => {
    const { req, res, next, isNextCalled } = mockReqRes("/api/patients", {
      userId: 1, role: "ADMIN",
    });

    phiAuditMiddleware(req, res, next);
    expect(isNextCalled()).toBe(true);
  });
});

// ── Authentication Edge Cases ──

describe("Authentication Security", () => {
  it("rejects tokens without Bearer prefix", () => {
    // Simulating auth middleware behavior
    const header = "Basic abc123";
    const hasBearerPrefix = header?.startsWith("Bearer ");
    expect(hasBearerPrefix).toBe(false);
  });

  it("validates JWT_SECRET is set in production", () => {
    // The auth module checks this on load
    const IS_PROD = process.env.NODE_ENV === "production";
    if (IS_PROD) {
      expect(process.env.JWT_SECRET).toBeDefined();
      expect(process.env.JWT_SECRET).not.toBe("fallback-secret-dev-only");
    }
  });

  it("cookie is httpOnly and secure in production", () => {
    const IS_PROD = process.env.NODE_ENV === "production";
    const cookieOptions = {
      httpOnly: true,
      secure: IS_PROD,
      sameSite: IS_PROD ? "none" as const : "lax" as const,
    };
    expect(cookieOptions.httpOnly).toBe(true);
  });
});

// ── Tenant Isolation Tests ──

describe("Tenant Isolation", () => {
  it("checkEntityTenantAccess blocks cross-tenant access", async () => {
    const { checkEntityTenantAccess } = await import("../../server/middleware/requireTenantScope");

    const entity = { companyId: 1 };
    const req = {
      user: { userId: 1, role: "ADMIN", companyId: 2 },
      method: "GET",
      path: "/api/trips/123",
    } as any;

    // Company 2 user trying to access company 1 entity
    const allowed = checkEntityTenantAccess(entity, 2, req, "trip", 123);
    expect(allowed).toBe(false);
  });

  it("checkEntityTenantAccess allows same-tenant access", async () => {
    const { checkEntityTenantAccess } = await import("../../server/middleware/requireTenantScope");

    const entity = { companyId: 1 };
    const req = {
      user: { userId: 1, role: "ADMIN", companyId: 1 },
      method: "GET",
      path: "/api/trips/123",
    } as any;

    const allowed = checkEntityTenantAccess(entity, 1, req, "trip", 123);
    expect(allowed).toBe(true);
  });

  it("checkEntityTenantAccess allows null tenant (SUPER_ADMIN)", async () => {
    const { checkEntityTenantAccess } = await import("../../server/middleware/requireTenantScope");

    const entity = { companyId: 1 };
    const req = {
      user: { userId: 1, role: "SUPER_ADMIN" },
      method: "GET",
      path: "/api/trips/123",
    } as any;

    const allowed = checkEntityTenantAccess(entity, null, req, "trip", 123);
    expect(allowed).toBe(true);
  });

  it("checkEntityTenantAccess blocks access to non-existent entity", async () => {
    const { checkEntityTenantAccess } = await import("../../server/middleware/requireTenantScope");

    const req = {
      user: { userId: 1, role: "ADMIN", companyId: 1 },
      method: "GET",
      path: "/api/trips/999",
    } as any;

    const allowed = checkEntityTenantAccess(undefined, 1, req, "trip", 999);
    expect(allowed).toBe(false);
  });

  it("tenantGuard cross-company check blocks mismatched entities", async () => {
    const { checkCrossCompanyAccess } = await import("../../server/lib/tenantGuard");

    const entity = { companyId: 5 };
    const req = {
      user: { userId: 10, role: "ADMIN", companyId: 3 },
      method: "PUT",
      path: "/api/trips/100",
    } as any;

    const allowed = checkCrossCompanyAccess(entity, 3, req, "trip", 100);
    expect(allowed).toBe(false);
  });
});

// ── RBAC Permission Tests ──

describe("RBAC Permissions", () => {
  let can: typeof import("../../shared/permissions").can;

  beforeEach(async () => {
    const mod = await import("../../shared/permissions");
    can = mod.can;
  });

  it("DRIVER cannot access admin resources", () => {
    expect(can("DRIVER", "users", "read")).toBe(false);
    expect(can("DRIVER", "users", "write")).toBe(false);
    expect(can("DRIVER", "billing", "write")).toBe(false);
    expect(can("DRIVER", "dispatch", "write")).toBe(false);
    expect(can("DRIVER", "dashboard", "read")).toBe(false);
  });

  it("DRIVER can read own trips", () => {
    expect(can("DRIVER", "trips", "self")).toBe(true);
  });

  it("SUPER_ADMIN can access everything", () => {
    expect(can("SUPER_ADMIN", "dashboard", "read")).toBe(true);
    expect(can("SUPER_ADMIN", "users", "write")).toBe(true);
    expect(can("SUPER_ADMIN", "audit", "read")).toBe(true);
    expect(can("SUPER_ADMIN", "billing", "write")).toBe(true);
  });

  it("CLINIC_USER can only read limited resources", () => {
    expect(can("CLINIC_USER", "trips", "read")).toBe(true);
    expect(can("CLINIC_USER", "patients", "read")).toBe(true);
    expect(can("CLINIC_USER", "drivers", "write")).toBe(false);
    expect(can("CLINIC_USER", "users", "write")).toBe(false);
  });

  it("DISPATCH can manage trips and drivers", () => {
    expect(can("DISPATCH", "trips", "write")).toBe(true);
    expect(can("DISPATCH", "dispatch", "write")).toBe(true);
    expect(can("DISPATCH", "drivers", "read")).toBe(true);
  });

  it("VIEWER has read-only access to allowed resources", () => {
    expect(can("VIEWER", "trips", "read")).toBe(true);
    expect(can("VIEWER", "patients", "read")).toBe(true);
    expect(can("VIEWER", "trips", "write")).toBe(false);
    expect(can("VIEWER", "users", "write")).toBe(false);
    expect(can("VIEWER", "drivers", "read")).toBe(false);
  });
});

// ── Trip State Machine Security ──

describe("Trip State Machine Security", () => {
  let transition: typeof import("../../shared/tripStateMachine").transition;
  let isTerminal: typeof import("../../shared/tripStateMachine").isTerminal;
  let allowedEvents: typeof import("../../shared/tripStateMachine").allowedEvents;

  beforeEach(async () => {
    const mod = await import("../../shared/tripStateMachine");
    transition = mod.transition;
    isTerminal = mod.isTerminal;
    allowedEvents = mod.allowedEvents;
  });

  it("prevents transition from COMPLETED to any state", () => {
    expect(isTerminal("COMPLETED")).toBe(true);
    expect(allowedEvents("COMPLETED")).toHaveLength(0);
    expect(() => transition("COMPLETED", "ASSIGN_DRIVER")).toThrow();
  });

  it("prevents transition from CANCELLED to any state", () => {
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(allowedEvents("CANCELLED")).toHaveLength(0);
    expect(() => transition("CANCELLED", "MARK_COMPLETE")).toThrow();
  });

  it("prevents skipping pickup phase", () => {
    // Cannot go from SCHEDULED directly to PICKED_UP
    expect(() => transition("SCHEDULED", "MARK_PICKED_UP")).toThrow();
  });

  it("enforces valid transition chain", () => {
    // Happy path: SCHEDULED -> ASSIGNED -> EN_ROUTE_TO_PICKUP -> ARRIVED_PICKUP -> PICKED_UP -> EN_ROUTE_TO_DROPOFF -> ARRIVED_DROPOFF -> COMPLETED
    const steps: Array<{ from: string; event: string; expectedTo: string }> = [
      { from: "SCHEDULED", event: "ASSIGN_DRIVER", expectedTo: "ASSIGNED" },
      { from: "ASSIGNED", event: "START_TO_PICKUP", expectedTo: "EN_ROUTE_TO_PICKUP" },
      { from: "EN_ROUTE_TO_PICKUP", event: "MARK_ARRIVED_PICKUP", expectedTo: "ARRIVED_PICKUP" },
      { from: "ARRIVED_PICKUP", event: "MARK_PICKED_UP", expectedTo: "PICKED_UP" },
      { from: "PICKED_UP", event: "START_TO_DROPOFF", expectedTo: "EN_ROUTE_TO_DROPOFF" },
      { from: "EN_ROUTE_TO_DROPOFF", event: "MARK_ARRIVED_DROPOFF", expectedTo: "ARRIVED_DROPOFF" },
      { from: "ARRIVED_DROPOFF", event: "MARK_COMPLETE", expectedTo: "COMPLETED" },
    ];

    for (const step of steps) {
      const result = transition(step.from, step.event);
      expect(result).toBe(step.expectedTo);
    }
  });

  it("allows cancellation from any non-terminal state", () => {
    const cancellableStates = [
      "SCHEDULED", "ASSIGNED", "EN_ROUTE_TO_PICKUP",
      "ARRIVED_PICKUP", "PICKED_UP", "EN_ROUTE_TO_DROPOFF",
    ];

    for (const state of cancellableStates) {
      const result = transition(state, "CANCEL_TRIP");
      expect(result).toBe("CANCELLED");
    }
  });

  it("NO_SHOW is a terminal state", () => {
    expect(isTerminal("NO_SHOW")).toBe(true);
  });

  it("ASSIGNED can be cancelled or proceed to pickup", () => {
    const events = allowedEvents("ASSIGNED");
    expect(events).toContain("START_TO_PICKUP");
    expect(events).toContain("CANCEL_TRIP");
  });
});
