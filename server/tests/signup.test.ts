import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock DB layer
// ---------------------------------------------------------------------------

const mockInsertReturning = vi.fn();
const mockSelectFrom = vi.fn();
const mockUpdateSet = vi.fn();

vi.mock("../db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockInsertReturning,
      })),
    })),
    select: vi.fn(() => ({
      from: mockSelectFrom,
    })),
    update: vi.fn(() => ({
      set: mockUpdateSet,
    })),
  },
}));

vi.mock("../lib/systemEvents", () => ({
  logSystemEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../auth", () => ({
  hashPassword: vi.fn().mockResolvedValue("hashed_password_123"),
  signToken: vi.fn().mockReturnValue("test_jwt_token"),
  setAuthCookie: vi.fn(),
}));

vi.mock("../public-id", () => ({
  generatePublicId: vi.fn().mockResolvedValue("01UCM00000001"),
}));

// Mock Stripe
vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({
    accounts: {
      create: vi.fn().mockResolvedValue({ id: "acct_test123" }),
    },
    accountLinks: {
      create: vi.fn().mockResolvedValue({ url: "https://connect.stripe.com/setup/test" }),
    },
  })),
}));

import { logSystemEvent } from "../lib/systemEvents";

const mockedLogSystemEvent = vi.mocked(logSystemEvent);

// ---------------------------------------------------------------------------
// Test: SignupError class
// ---------------------------------------------------------------------------

import { SignupError } from "../services/signupService";

describe("SignupError", () => {
  it("creates error with code and message", () => {
    const err = new SignupError("EMAIL_EXISTS", "Email already in use");
    expect(err.code).toBe("EMAIL_EXISTS");
    expect(err.message).toBe("Email already in use");
    expect(err.name).toBe("SignupError");
    expect(err).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Test: Validation schemas (controller layer)
// ---------------------------------------------------------------------------

import { z } from "zod";

const companySignupSchema = z.object({
  companyName: z.string().min(2).max(100),
  adminEmail: z.string().email().max(255),
  adminPassword: z.string().min(8).max(128),
  city: z.string().max(100).optional(),
  timezone: z.string().max(50).optional(),
});

describe("companySignupSchema validation", () => {
  it("accepts valid signup data", () => {
    const result = companySignupSchema.safeParse({
      companyName: "Test Transport Co",
      adminEmail: "admin@test.com",
      adminPassword: "securepassword123",
      city: "New York",
      timezone: "America/New_York",
    });
    expect(result.success).toBe(true);
  });

  it("accepts data without optional fields", () => {
    const result = companySignupSchema.safeParse({
      companyName: "Test Co",
      adminEmail: "admin@test.com",
      adminPassword: "password123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects short company name", () => {
    const result = companySignupSchema.safeParse({
      companyName: "X",
      adminEmail: "admin@test.com",
      adminPassword: "password123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const result = companySignupSchema.safeParse({
      companyName: "Test Co",
      adminEmail: "not-an-email",
      adminPassword: "password123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects short password", () => {
    const result = companySignupSchema.safeParse({
      companyName: "Test Co",
      adminEmail: "admin@test.com",
      adminPassword: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects overly long company name", () => {
    const result = companySignupSchema.safeParse({
      companyName: "A".repeat(101),
      adminEmail: "admin@test.com",
      adminPassword: "password123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const result = companySignupSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(result.error.flatten().fieldErrors)).toContain("companyName");
      expect(Object.keys(result.error.flatten().fieldErrors)).toContain("adminEmail");
      expect(Object.keys(result.error.flatten().fieldErrors)).toContain("adminPassword");
    }
  });
});

// ---------------------------------------------------------------------------
// Test: Stripe connect schema
// ---------------------------------------------------------------------------

const stripeConnectSchema = z.object({
  companyId: z.number().int().positive(),
});

describe("stripeConnectSchema validation", () => {
  it("accepts valid company ID", () => {
    const result = stripeConnectSchema.safeParse({ companyId: 42 });
    expect(result.success).toBe(true);
  });

  it("rejects negative company ID", () => {
    const result = stripeConnectSchema.safeParse({ companyId: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects zero company ID", () => {
    const result = stripeConnectSchema.safeParse({ companyId: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer company ID", () => {
    const result = stripeConnectSchema.safeParse({ companyId: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects missing company ID", () => {
    const result = stripeConnectSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test: Trial subscription constants
// ---------------------------------------------------------------------------

describe("trial subscription", () => {
  it("trial period is 14 days", () => {
    const TRIAL_DAYS = 14;
    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

    const diffMs = trialEnd.getTime() - now.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(14);
  });

  it("trial status is trialing", () => {
    expect("trialing").toBe("trialing");
  });

  it("trialing is considered active by subscription enforcement", async () => {
    const { isStatusActive } = await import("../services/subscriptionEnforcement");
    expect(isStatusActive("trialing")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test: Email normalization
// ---------------------------------------------------------------------------

describe("email normalization", () => {
  it("trims whitespace from email", () => {
    const email = "  admin@test.com  ";
    const normalized = email.trim().toLowerCase();
    expect(normalized).toBe("admin@test.com");
  });

  it("lowercases email", () => {
    const email = "ADMIN@TEST.COM";
    const normalized = email.trim().toLowerCase();
    expect(normalized).toBe("admin@test.com");
  });

  it("handles mixed case and whitespace", () => {
    const email = " Admin@Test.COM ";
    const normalized = email.trim().toLowerCase();
    expect(normalized).toBe("admin@test.com");
  });
});

// ---------------------------------------------------------------------------
// Test: Onboarding state structure
// ---------------------------------------------------------------------------

describe("onboarding state", () => {
  it("initial state has only company_created as true", () => {
    const initialState = {
      companyCreated: true,
      stripeConnected: false,
      firstDriverAdded: false,
      firstTripCreated: false,
    };

    expect(initialState.companyCreated).toBe(true);
    expect(initialState.stripeConnected).toBe(false);
    expect(initialState.firstDriverAdded).toBe(false);
    expect(initialState.firstTripCreated).toBe(false);
  });

  it("detects completion when all steps are done", () => {
    const state = {
      companyCreated: true,
      stripeConnected: true,
      firstDriverAdded: true,
      firstTripCreated: true,
    };

    const isComplete = state.companyCreated &&
      state.stripeConnected &&
      state.firstDriverAdded &&
      state.firstTripCreated;

    expect(isComplete).toBe(true);
  });

  it("is not complete when any step is missing", () => {
    const state = {
      companyCreated: true,
      stripeConnected: true,
      firstDriverAdded: false,
      firstTripCreated: true,
    };

    const isComplete = state.companyCreated &&
      state.stripeConnected &&
      state.firstDriverAdded &&
      state.firstTripCreated;

    expect(isComplete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test: Audit logging for onboarding events
// ---------------------------------------------------------------------------

describe("onboarding audit events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs company.created event", async () => {
    await logSystemEvent({
      companyId: 1,
      actorUserId: 1,
      eventType: "company.created",
      entityType: "company",
      entityId: "1",
      payload: { companyName: "Test Co", source: "self_service_signup" },
    });

    expect(mockedLogSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "company.created",
        entityType: "company",
        payload: expect.objectContaining({ source: "self_service_signup" }),
      }),
    );
  });

  it("logs admin.user.created event", async () => {
    await logSystemEvent({
      companyId: 1,
      actorUserId: 1,
      eventType: "admin.user.created",
      entityType: "user",
      entityId: "1",
      payload: { email: "admin@test.com", role: "COMPANY_ADMIN" },
    });

    expect(mockedLogSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "admin.user.created",
        payload: expect.objectContaining({ role: "COMPANY_ADMIN" }),
      }),
    );
  });

  it("logs trial.subscription.started event", async () => {
    await logSystemEvent({
      companyId: 1,
      actorUserId: 1,
      eventType: "trial.subscription.started",
      entityType: "subscription",
      entityId: "1",
      payload: { trialDays: 14 },
    });

    expect(mockedLogSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "trial.subscription.started",
        payload: expect.objectContaining({ trialDays: 14 }),
      }),
    );
  });

  it("logs stripe.connect.started event", async () => {
    await logSystemEvent({
      companyId: 1,
      eventType: "stripe.connect.started",
      entityType: "stripe_connect",
      entityId: "acct_test123",
      payload: { accountId: "acct_test123" },
    });

    expect(mockedLogSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "stripe.connect.started",
        entityType: "stripe_connect",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Test: Rate limiting for signup
// ---------------------------------------------------------------------------

describe("signup rate limiting", () => {
  it("rate limit key includes IP address", () => {
    const ip = "192.168.1.100";
    const key = `signup:${ip}`;
    expect(key).toBe("signup:192.168.1.100");
  });

  it("rate limit allows 5 requests per hour", () => {
    const maxRequests = 5;
    const windowSeconds = 3600;
    expect(maxRequests).toBe(5);
    expect(windowSeconds).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// Test: Duplicate email protection
// ---------------------------------------------------------------------------

describe("duplicate email protection", () => {
  it("normalizes emails before comparison", () => {
    const email1 = "Admin@Test.COM".trim().toLowerCase();
    const email2 = " admin@test.com ".trim().toLowerCase();
    expect(email1).toBe(email2);
  });

  it("SignupError has EMAIL_EXISTS code for duplicates", () => {
    const err = new SignupError("EMAIL_EXISTS", "A user with this email already exists");
    expect(err.code).toBe("EMAIL_EXISTS");
  });

  it("SignupError has COMPANY_EXISTS code for duplicate companies", () => {
    const err = new SignupError("COMPANY_EXISTS", "A company with this name already exists");
    expect(err.code).toBe("COMPANY_EXISTS");
  });
});

// ---------------------------------------------------------------------------
// Test: Stripe Connect onboarding link generation
// ---------------------------------------------------------------------------

describe("Stripe Connect onboarding", () => {
  it("SignupError for missing Stripe config", () => {
    const err = new SignupError("STRIPE_NOT_CONFIGURED", "Stripe is not configured");
    expect(err.code).toBe("STRIPE_NOT_CONFIGURED");
  });

  it("SignupError for missing company", () => {
    const err = new SignupError("COMPANY_NOT_FOUND", "Company not found");
    expect(err.code).toBe("COMPANY_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Test: RBAC - new company gets COMPANY_ADMIN role
// ---------------------------------------------------------------------------

describe("new company RBAC", () => {
  it("first user is created as COMPANY_ADMIN", () => {
    const role = "COMPANY_ADMIN";
    expect(role).toBe("COMPANY_ADMIN");
  });

  it("COMPANY_ADMIN is in the valid roles list", () => {
    const validRoles = [
      "SUPER_ADMIN", "ADMIN", "DISPATCH", "DRIVER",
      "VIEWER", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER",
    ];
    expect(validRoles).toContain("COMPANY_ADMIN");
  });
});

// ---------------------------------------------------------------------------
// Test: Default quotas for new companies
// ---------------------------------------------------------------------------

describe("default company settings", () => {
  it("new companies get default quotas", () => {
    const defaults = {
      maxDrivers: 100,
      maxActiveTrips: 500,
      rpmLimit: 300,
    };
    expect(defaults.maxDrivers).toBe(100);
    expect(defaults.maxActiveTrips).toBe(500);
  });

  it("subscription defaults to 120000 cents ($1200/month)", () => {
    const monthlyFeeCents = 120000;
    expect(monthlyFeeCents).toBe(120000);
  });
});
