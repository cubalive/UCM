import express, { type Express } from "express";
import { authMiddleware, requirePermission } from "../auth";
import { requireTenantScope } from "../middleware";
import { getUsersHandler, createUserHandler } from "../controllers/users.controller";

const router = express.Router();

router.get("/api/users", authMiddleware, requirePermission("users", "read"), requireTenantScope, getUsersHandler as any);
router.post("/api/users", authMiddleware, requirePermission("users", "write"), requireTenantScope, createUserHandler as any);

export function registerUserRoutes(app: Express) {
  app.use(router);
}
