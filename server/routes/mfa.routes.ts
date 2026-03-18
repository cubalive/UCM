/**
 * S1 FIX: MFA Routes
 * Register MFA endpoints for TOTP setup, verification, challenge, and disable.
 */
import { Router } from "express";
import { authMiddleware } from "../auth";
import { mfaRateLimiter } from "../middleware/rateLimiter";
import {
  mfaSetupHandler,
  mfaVerifySetupHandler,
  mfaChallengeHandler,
  mfaDisableHandler,
  mfaStatusHandler,
} from "../controllers/mfa.controller";

export function registerMfaRoutes(router: Router): void {
  // All MFA routes require authentication (even mfa_pending tokens can access /mfa/*)
  // Rate-limited to prevent brute-force
  router.post("/auth/mfa/setup", authMiddleware, mfaRateLimiter, mfaSetupHandler);
  router.post("/auth/mfa/verify", authMiddleware, mfaRateLimiter, mfaVerifySetupHandler);
  router.post("/auth/mfa/challenge", authMiddleware, mfaRateLimiter, mfaChallengeHandler);
  router.post("/auth/mfa/disable", authMiddleware, mfaRateLimiter, mfaDisableHandler);
  router.get("/auth/mfa/status", authMiddleware, mfaStatusHandler);
}
