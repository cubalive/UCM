import express, { type Express } from "express";
import { authMiddleware, requireRole } from "../auth";
import { getUsersHandler, createUserHandler } from "../controllers/users.controller";

const router = express.Router();

router.get("/api/users", authMiddleware, requireRole("ADMIN", "COMPANY_ADMIN"), getUsersHandler as any);
router.post("/api/users", authMiddleware, requireRole("ADMIN", "COMPANY_ADMIN"), createUserHandler as any);

export function registerUserRoutes(app: Express) {
  app.use(router);
}
