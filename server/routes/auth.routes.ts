import express, { type Express } from "express";
import { authMiddleware, type AuthRequest } from "../auth";
import { loginHandler, loginJwtHandler, devSessionHandler, authMeHandler, meHandler } from "../controllers/auth.controller";

const router = express.Router();

router.post("/api/auth/login", loginHandler);
router.post("/api/auth/login-jwt", loginJwtHandler);

if (process.env.NODE_ENV === "development") {
  router.get("/api/auth/dev-session", devSessionHandler);
}

router.get("/api/auth/me", authMiddleware, authMeHandler as any);
router.get("/api/me", meHandler);

export function registerAuthRoutes(app: Express) {
  app.use(router);
}
