import express, { type Express } from "express";
import { authMiddleware, requireRole } from "../auth";
import { requireCompanyScope } from "../middleware";
import { getUsersHandler, createUserHandler } from "../controllers/users.controller";

const router = express.Router();

router.get("/api/users", authMiddleware, requireRole("ADMIN", "COMPANY_ADMIN"), requireCompanyScope, getUsersHandler as any);
router.post("/api/users", authMiddleware, requireRole("ADMIN", "COMPANY_ADMIN"), requireCompanyScope, createUserHandler as any);

export function registerUserRoutes(app: Express) {
  app.use(router);
}
