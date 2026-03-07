import { Router, type Express } from "express";
import { authMiddleware, requirePermission, requireRole } from "../auth";
import { requireTenantScope } from "../middleware";
import {
  listTimeEntriesHandler,
  driverTimeEntriesHandler,
  manualCreateHandler,
  editTimeEntryHandler,
  submitTimeEntryHandler,
  approveTimeEntryHandler,
  rejectTimeEntryHandler,
  markPaidTimeEntryHandler,
  csvImportHandler,
  csvUploadMiddleware,
  listImportBatchesHandler,
  csvTemplateHandler,
  generatePayrollHandler,
  listPayrollRunsHandler,
  getPayrollRunHandler,
  finalizePayrollHandler,
  payPayrollHandler,
  deletePayrollRunHandler,
  payPayrollItemHandler,
  listCompanyDriversHandler,
  listStaffPayConfigsHandler,
  upsertStaffPayConfigHandler,
  deleteStaffPayConfigHandler,
  getDriverStripeStatusesHandler,
  createDriverStripeOnboardingHandler,
} from "../controllers/timepay.controller";

const router = Router();

router.get("/api/company/time/entries", authMiddleware, requirePermission("time_entries", "read"), requireTenantScope, listTimeEntriesHandler as any);
router.post("/api/company/time/manual-create", authMiddleware, requirePermission("time_entries", "write"), requireTenantScope, manualCreateHandler as any);
router.patch("/api/company/time/:id/edit", authMiddleware, requirePermission("time_entries", "write"), requireTenantScope, editTimeEntryHandler as any);
router.post("/api/company/time/:id/submit", authMiddleware, requirePermission("time_entries", "write"), requireTenantScope, submitTimeEntryHandler as any);
router.post("/api/company/time/:id/approve", authMiddleware, requirePermission("time_entries", "write"), requireTenantScope, approveTimeEntryHandler as any);
router.post("/api/company/time/:id/reject", authMiddleware, requirePermission("time_entries", "write"), requireTenantScope, rejectTimeEntryHandler as any);
router.post("/api/company/time/:id/mark-paid", authMiddleware, requirePermission("time_entries", "write"), requireTenantScope, markPaidTimeEntryHandler as any);
router.post("/api/company/time/import", authMiddleware, requirePermission("time_entries", "write"), requireTenantScope, csvUploadMiddleware as any, csvImportHandler as any);
router.get("/api/company/time/import-batches", authMiddleware, requirePermission("time_entries", "read"), requireTenantScope, listImportBatchesHandler as any);
router.get("/api/company/time/csv-template", authMiddleware, csvTemplateHandler as any);
router.get("/api/company/time/drivers", authMiddleware, requirePermission("time_entries", "read"), requireTenantScope, listCompanyDriversHandler as any);

router.get("/api/driver/time", authMiddleware, requireRole("DRIVER") as any, driverTimeEntriesHandler as any);

router.post("/api/company/payroll/generate", authMiddleware, requirePermission("payroll", "write"), requireTenantScope, generatePayrollHandler as any);
router.get("/api/company/payroll/runs", authMiddleware, requirePermission("payroll", "read"), requireTenantScope, listPayrollRunsHandler as any);
router.get("/api/company/payroll/runs/:runId", authMiddleware, requirePermission("payroll", "read"), requireTenantScope, getPayrollRunHandler as any);
router.post("/api/company/payroll/:runId/finalize", authMiddleware, requirePermission("payroll", "write"), requireTenantScope, finalizePayrollHandler as any);
router.post("/api/company/payroll/:runId/pay", authMiddleware, requirePermission("payroll", "write"), requireTenantScope, payPayrollHandler as any);
router.post("/api/company/payroll/:runId/items/:itemId/pay", authMiddleware, requirePermission("payroll", "write"), requireTenantScope, payPayrollItemHandler as any);
router.delete("/api/company/payroll/:runId", authMiddleware, requirePermission("payroll", "write"), requireTenantScope, deletePayrollRunHandler as any);

router.get("/api/company/staff-pay-configs", authMiddleware, requirePermission("payroll", "read"), requireTenantScope, listStaffPayConfigsHandler as any);
router.post("/api/company/staff-pay-configs", authMiddleware, requirePermission("payroll", "write"), requireTenantScope, upsertStaffPayConfigHandler as any);
router.delete("/api/company/staff-pay-configs/:id", authMiddleware, requirePermission("payroll", "write"), requireTenantScope, deleteStaffPayConfigHandler as any);

router.get("/api/company/driver-stripe-statuses", authMiddleware, requirePermission("payroll", "read"), requireTenantScope, getDriverStripeStatusesHandler as any);
router.post("/api/company/driver/:driverId/stripe-onboarding", authMiddleware, requirePermission("payroll", "write"), requireTenantScope, createDriverStripeOnboardingHandler as any);

export function registerTimePayRoutes(app: Express) {
  app.use(router);
}
