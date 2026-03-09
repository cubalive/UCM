import express, { type Request, Response, NextFunction, type Express } from "express";
import { authMiddleware, type AuthRequest } from "../auth";
import { checkRateLimit } from "../lib/rateLimiter";
import { loginHandler, loginJwtHandler, devSessionHandler, authMeHandler, meHandler, changePasswordHandler, setWorkingCityHandler, authHealthHandler, forgotPasswordHandler, tokenLoginHandler, deleteAccountHandler } from "../controllers/auth.controller";

function loginRateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const { allowed, retryAfterMs } = checkRateLimit(`login:${ip}`, 10, 300);
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
router.post("/api/auth/change-password", authMiddleware, changePasswordHandler as any);
router.post("/api/auth/delete-account", authMiddleware, deleteAccountHandler as any);
router.post("/api/auth/working-city", authMiddleware, setWorkingCityHandler as any);
router.get("/api/auth/health", authHealthHandler);

export function registerAuthRoutes(app: Express) {
  app.use(router);
}
