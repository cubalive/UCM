import { doubleCsrf } from "csrf-csrf";
import { Request, Response, NextFunction } from "express";

const {
  generateToken,
  doubleCsrfProtection,
} = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET || process.env.JWT_SECRET || "csrf-dev-secret",
  cookieName: "__ucm_csrf",
  cookieOptions: {
    sameSite: "strict",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  },
  getTokenFromRequest: (req: Request) =>
    req.headers["x-csrf-token"] as string || null,
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
});

// Endpoint to get a CSRF token (sets cookie + returns token in body)
export function csrfTokenRoute(req: Request, res: Response) {
  const token = generateToken(req, res);
  res.json({ csrfToken: token });
}

// Middleware: skip CSRF for webhook endpoints (verified via Stripe signature)
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Skip for Stripe webhooks (use signature verification instead)
  if (req.path.startsWith("/api/webhooks/stripe")) {
    return next();
  }
  // Skip for auth routes (login/reset — no session yet)
  if (req.path.startsWith("/api/auth/")) {
    return next();
  }
  doubleCsrfProtection(req, res, next);
}

export { generateToken };
