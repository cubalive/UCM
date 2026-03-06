import { db } from "../db";
import { eq } from "drizzle-orm";
import {
  companies,
  users,
  companySettings,
  companySubscriptions,
  companySubscriptionSettings,
  onboardingState,
  companyStripeAccounts,
} from "@shared/schema";
import { hashPassword } from "../auth";
import { generatePublicId } from "../public-id";
import { logSystemEvent } from "../lib/systemEvents";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignupInput {
  companyName: string;
  adminEmail: string;
  adminPassword: string;
  city?: string;
  timezone?: string;
}

export interface SignupResult {
  company: { id: number; name: string };
  user: { id: number; email: string; role: string };
  subscription: { status: string; trialEndsAt: string };
  onboarding: { companyCreated: boolean; stripeConnected: boolean; firstDriverAdded: boolean; firstTripCreated: boolean };
}

const TRIAL_DAYS = 14;

// ---------------------------------------------------------------------------
// Signup flow
// ---------------------------------------------------------------------------

export async function signupCompany(input: SignupInput): Promise<SignupResult> {
  const normalizedEmail = input.adminEmail.trim().toLowerCase();

  // Check for duplicate email
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalizedEmail));
  if (existingUser) {
    throw new SignupError("EMAIL_EXISTS", "A user with this email already exists");
  }

  // Check for duplicate company name
  const [existingCompany] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.name, input.companyName.trim()));
  if (existingCompany) {
    throw new SignupError("COMPANY_EXISTS", "A company with this name already exists");
  }

  // 1) Create company
  const [company] = await db
    .insert(companies)
    .values({
      name: input.companyName.trim(),
      timezone: input.timezone || "America/New_York",
    })
    .returning();

  // 2) Create admin user
  const hashedPw = await hashPassword(input.adminPassword);
  const publicId = await generatePublicId();

  const [user] = await db
    .insert(users)
    .values({
      publicId,
      email: normalizedEmail,
      password: hashedPw,
      firstName: "Admin",
      lastName: input.companyName.trim(),
      role: "COMPANY_ADMIN",
      companyId: company.id,
      active: true,
    })
    .returning();

  // 3) Create default company_settings
  await db.insert(companySettings).values({
    companyId: company.id,
  });

  // 4) Create trial subscription
  const trialEnd = new Date();
  trialEnd.setDate(trialEnd.getDate() + TRIAL_DAYS);

  await db.insert(companySubscriptions).values({
    companyId: company.id,
    stripePriceId: "trial",
    status: "trialing",
    currentPeriodStart: new Date(),
    currentPeriodEnd: trialEnd,
  });

  // 5) Enable subscription enforcement
  await db.insert(companySubscriptionSettings).values({
    companyId: company.id,
    subscriptionEnabled: true,
    subscriptionRequiredForAccess: true,
    monthlyFeeCents: 120000,
  });

  // 6) Create onboarding state
  const [onboarding] = await db
    .insert(onboardingState)
    .values({
      companyId: company.id,
      companyCreated: true,
    })
    .returning();

  // 7) Audit logs
  await Promise.all([
    logSystemEvent({
      companyId: company.id,
      actorUserId: user.id,
      eventType: "company.created",
      entityType: "company",
      entityId: String(company.id),
      payload: { companyName: company.name, source: "self_service_signup" },
    }),
    logSystemEvent({
      companyId: company.id,
      actorUserId: user.id,
      eventType: "admin.user.created",
      entityType: "user",
      entityId: String(user.id),
      payload: { email: normalizedEmail, role: "COMPANY_ADMIN" },
    }),
    logSystemEvent({
      companyId: company.id,
      actorUserId: user.id,
      eventType: "trial.subscription.started",
      entityType: "subscription",
      entityId: String(company.id),
      payload: { trialDays: TRIAL_DAYS, trialEndsAt: trialEnd.toISOString() },
    }),
  ]);

  return {
    company: { id: company.id, name: company.name },
    user: { id: user.id, email: normalizedEmail, role: "COMPANY_ADMIN" },
    subscription: { status: "trialing", trialEndsAt: trialEnd.toISOString() },
    onboarding: {
      companyCreated: true,
      stripeConnected: false,
      firstDriverAdded: false,
      firstTripCreated: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Stripe Connect onboarding link
// ---------------------------------------------------------------------------

export async function createStripeConnectOnboardingLink(companyId: number): Promise<string> {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new SignupError("STRIPE_NOT_CONFIGURED", "Stripe is not configured");
  }

  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) {
    throw new SignupError("COMPANY_NOT_FOUND", "Company not found");
  }

  const Stripe = require("stripe").default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  // Check if account already exists
  const [existing] = await db
    .select()
    .from(companyStripeAccounts)
    .where(eq(companyStripeAccounts.companyId, companyId));

  let accountId: string;

  if (existing) {
    accountId = existing.stripeAccountId;
  } else {
    const account = await stripe.accounts.create({
      type: "express",
      metadata: { ucm_company_id: String(companyId) },
      business_profile: { name: company.name },
    });
    accountId = account.id;

    await db.insert(companyStripeAccounts).values({
      companyId,
      stripeAccountId: accountId,
    });
  }

  const APP_URL =
    process.env.APP_BASE_URL ||
    process.env.APP_PUBLIC_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://app.unitedcaremobility.com";

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${APP_URL}/onboarding?step=stripe&refresh=true`,
    return_url: `${APP_URL}/onboarding?step=stripe&success=true`,
    type: "account_onboarding",
  });

  // Update onboarding state
  await db
    .update(onboardingState)
    .set({ updatedAt: new Date() })
    .where(eq(onboardingState.companyId, companyId));

  await logSystemEvent({
    companyId,
    eventType: "stripe.connect.started",
    entityType: "stripe_connect",
    entityId: accountId,
    payload: { accountId },
  });

  return accountLink.url;
}

// ---------------------------------------------------------------------------
// Onboarding state helpers
// ---------------------------------------------------------------------------

export async function getOnboardingState(companyId: number) {
  const [state] = await db
    .select()
    .from(onboardingState)
    .where(eq(onboardingState.companyId, companyId));
  return state || null;
}

export async function updateOnboardingStep(
  companyId: number,
  step: "stripeConnected" | "firstDriverAdded" | "firstTripCreated"
) {
  const updates: Record<string, unknown> = { [step]: true, updatedAt: new Date() };

  // Check if all steps complete
  const current = await getOnboardingState(companyId);
  if (current) {
    const merged = { ...current, [step]: true };
    if (merged.companyCreated && merged.stripeConnected && merged.firstDriverAdded && merged.firstTripCreated) {
      updates.completedAt = new Date();
    }
  }

  await db
    .update(onboardingState)
    .set(updates)
    .where(eq(onboardingState.companyId, companyId));
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class SignupError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SignupError";
  }
}
