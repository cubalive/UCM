import { Router, type Express } from "express";
import { authMiddleware, requireRole } from "../auth";
import {
  createImportJob, uploadFile, uploadMiddleware,
  validateImport, runImport, rollbackImport,
  listImportJobs, getImportJob,
  dryRunImport, downloadTemplate,
} from "../controllers/imports.controller";

const router = Router();

router.use(authMiddleware as any, requireRole("SUPER_ADMIN") as any);

router.post("/", createImportJob as any);
router.post("/:id/upload", uploadMiddleware as any, uploadFile as any);
router.post("/:id/validate", validateImport as any);
router.post("/:id/dry-run", dryRunImport as any);
router.post("/:id/run", runImport as any);
router.post("/:id/rollback", rollbackImport as any);
router.get("/", listImportJobs as any);
router.get("/:id", getImportJob as any);
router.get("/templates/:entity", downloadTemplate as any);

export function registerImportRoutes(app: Express) {
  app.use("/api/admin/imports", router);
}
