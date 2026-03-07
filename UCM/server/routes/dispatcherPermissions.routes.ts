import express, { type Express } from "express";
import { authMiddleware, requireRole } from "../auth";
import {
  getDispatcherPermissionsHandler,
  updateDispatcherPermissionsHandler,
  getMyPermissionsHandler,
  getCompanyCitiesHandler,
} from "../controllers/dispatcherPermissions.controller";

const router = express.Router();

router.get(
  "/api/company/dispatchers/:dispatcherUserId/permissions",
  authMiddleware,
  requireRole("COMPANY_ADMIN", "SUPER_ADMIN"),
  getDispatcherPermissionsHandler as any,
);

router.put(
  "/api/company/dispatchers/:dispatcherUserId/permissions",
  authMiddleware,
  requireRole("COMPANY_ADMIN", "SUPER_ADMIN"),
  updateDispatcherPermissionsHandler as any,
);

router.get(
  "/api/dispatcher/my-permissions",
  authMiddleware,
  getMyPermissionsHandler as any,
);

router.get(
  "/api/company/cities",
  authMiddleware,
  requireRole("COMPANY_ADMIN", "SUPER_ADMIN"),
  getCompanyCitiesHandler as any,
);

export function registerDispatcherPermissionsRoutes(app: Express) {
  app.use(router);
}
