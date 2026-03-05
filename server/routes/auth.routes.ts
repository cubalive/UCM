import express, { type Request, Response, NextFunction, type Express } from "express";
import { authMiddleware, type AuthRequest } from "../auth";
import { checkRateLimitDistributed } from "../lib/rateLimiter";
import { loginHandler, loginJwtHandler, devSessionHandler, authMeHandler, meHandler, changePasswordHandler, setWorkingCityHandler, authHealthHandler, forgotPasswordHandler, tokenLoginHandler } from "../controllers/auth.controller";

async function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const { allowed, retryAfterMs } = await checkRateLimitDistributed(`login:${ip}`, 10, 300);
  if (!allowed) {
    return res.status(429).json({
      message: "Too many login attempts. Please try again later.",
      retryAfterMs,
    });
  }
  next();
}

const router = express.Router();

router.post("/api/auth/login", loginRateLimit, loginHandler);
router.post("/api/auth/login-jwt", loginRateLimit, loginJwtHandler);

if (process.env.NODE_ENV === "development") {
  router.get("/api/auth/dev-session", devSessionHandler);
}

router.get("/api/auth/me", authMiddleware, authMeHandler as any);
router.get("/api/me", meHandler);
router.post("/api/auth/token-login", loginRateLimit, tokenLoginHandler);
router.post("/api/auth/forgot-password", loginRateLimit, forgotPasswordHandler);
async function changePasswordRateLimit(req: Request, res: Response, next: NextFunction) {
  const userId = (req as any).user?.userId || "anon";
  const { allowed, retryAfterMs } = await checkRateLimitDistributed(`chpw:${userId}`, 5, 3600);
  if (!allowed) {
    return res.status(429).json({
      message: "Too many password change attempts. Please try again later.",
      retryAfterMs,
    });
  }
  next();
}

router.post("/api/auth/change-password", authMiddleware, changePasswordRateLimit, changePasswordHandler as any);
router.post("/api/auth/working-city", authMiddleware, setWorkingCityHandler as any);
router.get("/api/auth/health", authHealthHandler);

export function registerAuthRoutes(app: Express) {
  app.use(router);
}
