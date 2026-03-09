import rateLimit from "express-rate-limit";
import { Request } from "express";

function keyGenerator(req: Request): string {
  return req.tenantId || req.ip || "unknown";
}

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.ip || "unknown",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts" },
});

export const billingRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many billing requests, please try again later" },
});

export const webhookRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  keyGenerator: (req) => req.ip || "unknown",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many webhook requests" },
});

export const paymentRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many payment requests, please try again later" },
});

// Driver location updates are frequent but should still be bounded
export const locationRateLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?.id || req.ip || "unknown",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Location updates too frequent" },
});

// Strict rate limiter for dispatch override operations
export const overrideRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many override operations" },
});

// Tenant + user combined key for financial operations
function tenantUserKey(req: Request): string {
  return `${req.tenantId || "none"}:${req.user?.id || req.ip || "unknown"}`;
}

// Stricter per-tenant limit for Stripe Connect operations
export const stripeConnectRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: tenantUserKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many Stripe Connect requests, please try again later" },
});

// Import operations (heavy, limit per tenant)
export const importRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many import requests, please try again later" },
});
