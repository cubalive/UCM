import express, { type Express } from "express";
import { authMiddleware } from "../auth";
import { authRateLimiter, forgotPasswordRateLimiter, passwordRateLimiter } from "../middleware/rateLimiter";
import { loginHandler, loginJwtHandler, devSessionHandler, authMeHandler, meHandler, changePasswordHandler, setWorkingCityHandler, authHealthHandler, forgotPasswordHandler, tokenLoginHandler, deleteAccountHandler, refreshHandler, logoutHandler } from "../controllers/auth.controller";

const router = express.Router();

router.post("/api/auth/login", authRateLimiter, loginHandler);
router.post("/api/auth/login-jwt", authRateLimiter, loginJwtHandler);

if (process.env.NODE_ENV === "development") {
  router.get("/api/auth/dev-session", devSessionHandler);
}

router.get("/api/auth/me", authMiddleware, authMeHandler as any);
router.get("/api/me", meHandler);
router.post("/api/auth/token-login", authRateLimiter, tokenLoginHandler);
router.post("/api/auth/forgot-password", forgotPasswordRateLimiter, forgotPasswordHandler);
router.post("/api/auth/change-password", authMiddleware, passwordRateLimiter, changePasswordHandler as any);
router.post("/api/auth/delete-account", authMiddleware, deleteAccountHandler as any);
router.post("/api/auth/working-city", authMiddleware, setWorkingCityHandler as any);
router.post("/api/auth/refresh", refreshHandler);
router.post("/api/auth/logout", logoutHandler);
router.get("/api/auth/health", authHealthHandler);

export function registerAuthRoutes(app: Express) {
  app.use(router);
}
