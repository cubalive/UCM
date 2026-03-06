import express, { type Request, Response, NextFunction, type Express } from "express";
import { authMiddleware } from "../auth";
import { checkRateLimitDistributed } from "../lib/rateLimiter";
import {
  signupCompanyHandler,
  stripeConnectHandler,
  onboardingStateHandler,
} from "../controllers/signup.controller";

async function signupRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const { allowed, retryAfterMs } = await checkRateLimitDistributed(`signup:${ip}`, 5, 3600);
  if (!allowed) {
    return res.status(429).json({
      message: "Too many signup attempts. Please try again later.",
      retryAfterMs,
    });
  }
  next();
}

const router = express.Router();

// Public endpoint — no auth required, rate-limited
router.post("/api/signup/company", signupRateLimit, signupCompanyHandler);

// Authenticated endpoints — require JWT
router.post("/api/signup/stripe-connect", authMiddleware, stripeConnectHandler as any);
router.get("/api/signup/onboarding-state", authMiddleware, onboardingStateHandler as any);

export function registerSignupRoutes(app: Express) {
  app.use(router);
}
