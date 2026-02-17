import { Router, type Express } from "express";
import { authMiddleware, requireRole } from "../auth";
import {
  createImportJob, uploadFile, uploadMiddleware,
  validateImport, runImport, rollbackImport,
  listImportJobs, getImportJob,
} from "../controllers/imports.controller";

const router = Router();

router.use(authMiddleware as any, requireRole("SUPER_ADMIN") as any);

router.post("/api/admin/imports", createImportJob as any);
router.post("/api/admin/imports/:id/upload", uploadMiddleware as any, uploadFile as any);
router.post("/api/admin/imports/:id/validate", validateImport as any);
router.post("/api/admin/imports/:id/run", runImport as any);
router.post("/api/admin/imports/:id/rollback", rollbackImport as any);
router.get("/api/admin/imports", listImportJobs as any);
router.get("/api/admin/imports/:id", getImportJob as any);

export function registerImportRoutes(app: Express) {
  app.use(router);
}
