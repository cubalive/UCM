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
