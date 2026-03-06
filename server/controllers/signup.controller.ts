import type { Request, Response } from "express";
import { z } from "zod";
import {
  signupCompany,
  createStripeConnectOnboardingLink,
  getOnboardingState,
  SignupError,
} from "../services/signupService";
import { signToken, setAuthCookie } from "../auth";
import type { AuthRequest } from "../auth";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const companySignupSchema = z.object({
  companyName: z.string().min(2).max(100),
  adminEmail: z.string().email().max(255),
  adminPassword: z.string().min(8).max(128),
  city: z.string().max(100).optional(),
  timezone: z.string().max(50).optional(),
});

const stripeConnectSchema = z.object({
  companyId: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// POST /api/signup/company
// ---------------------------------------------------------------------------

export async function signupCompanyHandler(req: Request, res: Response) {
  try {
    const parsed = companySignupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid signup data",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const result = await signupCompany(parsed.data);

    // Auto-login: issue JWT for the new admin
    const token = signToken({
      userId: result.user.id,
      role: result.user.role,
      companyId: result.company.id,
    });

    setAuthCookie(res, token, req);

    return res.status(201).json({
      ...result,
      token,
    });
  } catch (err: any) {
    if (err instanceof SignupError) {
      const statusMap: Record<string, number> = {
        EMAIL_EXISTS: 409,
        COMPANY_EXISTS: 409,
      };
      return res.status(statusMap[err.code] || 400).json({
        message: err.message,
        code: err.code,
      });
    }
    console.error("[SIGNUP] Company signup failed:", err.message);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// ---------------------------------------------------------------------------
// POST /api/signup/stripe-connect
// ---------------------------------------------------------------------------

export async function stripeConnectHandler(req: AuthRequest, res: Response) {
  try {
    const parsed = stripeConnectSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid request",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    // Only allow the company's own admin or SUPER_ADMIN
    if (req.user?.role !== "SUPER_ADMIN" && req.user?.companyId !== parsed.data.companyId) {
      return res.status(403).json({ message: "Forbidden", code: "FORBIDDEN" });
    }

    const url = await createStripeConnectOnboardingLink(parsed.data.companyId);
    return res.json({ url });
  } catch (err: any) {
    if (err instanceof SignupError) {
      const statusMap: Record<string, number> = {
        STRIPE_NOT_CONFIGURED: 503,
        COMPANY_NOT_FOUND: 404,
      };
      return res.status(statusMap[err.code] || 400).json({
        message: err.message,
        code: err.code,
      });
    }
    console.error("[SIGNUP] Stripe connect failed:", err.message);
    return res.status(500).json({ message: "Internal server error" });
  }
}

// ---------------------------------------------------------------------------
// GET /api/signup/onboarding-state
// ---------------------------------------------------------------------------

export async function onboardingStateHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(400).json({ message: "No company context" });
    }

    const state = await getOnboardingState(companyId);
    if (!state) {
      return res.status(404).json({ message: "No onboarding state found" });
    }

    return res.json({
      companyId: state.companyId,
      steps: {
        company_created: state.companyCreated,
        stripe_connected: state.stripeConnected,
        first_driver_added: state.firstDriverAdded,
        first_trip_created: state.firstTripCreated,
      },
      completedAt: state.completedAt,
    });
  } catch (err: any) {
    console.error("[SIGNUP] Onboarding state fetch failed:", err.message);
    return res.status(500).json({ message: "Internal server error" });
  }
}
