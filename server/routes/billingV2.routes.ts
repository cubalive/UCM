import { Router, type Express } from "express";
import { authMiddleware, requirePermission, requireRole } from "../auth";
import { requireTenantScope } from "../middleware";
import { requireSubscription } from "../middleware/requireSubscription";
import { requireClinicScope } from "../middleware/requireClinicScope";
import {
  listTariffsHandler,
  createTariffHandler,
  updateTariffHandler,
  upsertClinicBillingSettingsHandler,
  getClinicBillingSettingsHandler,
  backfillBillingHandler,
  generateInvoiceHandler,
  batchGenerateInvoicesHandler,
  finalizeInvoiceHandler,
  batchFinalizeInvoicesHandler,
  companyListInvoicesHandler,
  clinicListInvoicesHandler,
  clinicGetInvoiceHandler,
  clinicExportInvoiceCsvHandler,
  clinicExportInvoiceJsonHandler,
  clinicPayInvoiceHandler,
  clinicCreateSupportThreadHandler,
  clinicGetSupportThreadHandler,
  clinicPostMessageHandler,
  clinicGetThreadMessagesHandler,
  companyListSupportThreadsHandler,
  companyGetThreadMessagesHandler,
  companyPostThreadMessageHandler,
  companyCloseThreadHandler,
  getDispatchContactHandler,
} from "../controllers/billingV2.controller";

const router = Router();

router.get("/api/company/billing/tariffs", authMiddleware, requirePermission("billing", "read"), requireTenantScope, listTariffsHandler as any);
router.post("/api/company/billing/tariffs", authMiddleware, requirePermission("billing", "write"), requireTenantScope, createTariffHandler as any);
router.patch("/api/company/billing/tariffs/:id", authMiddleware, requirePermission("billing", "write"), requireTenantScope, updateTariffHandler as any);

router.get("/api/company/billing/settings/clinic/:clinicId", authMiddleware, requirePermission("billing", "read"), requireTenantScope, getClinicBillingSettingsHandler as any);
router.post("/api/company/billing/settings/clinic/:clinicId", authMiddleware, requirePermission("billing", "write"), requireTenantScope, upsertClinicBillingSettingsHandler as any);

router.post("/api/company/billing/backfill", authMiddleware, requirePermission("billing", "write"), requireTenantScope, backfillBillingHandler as any);
router.post("/api/company/billing/invoices/generate", authMiddleware, requirePermission("billing", "write"), requireTenantScope, requireSubscription, generateInvoiceHandler as any);
router.post("/api/company/billing/invoices/batch-generate", authMiddleware, requirePermission("billing", "write"), requireTenantScope, requireSubscription, batchGenerateInvoicesHandler as any);
router.post("/api/company/billing/invoices/batch-finalize", authMiddleware, requirePermission("billing", "write"), requireTenantScope, batchFinalizeInvoicesHandler as any);
router.post("/api/company/billing/invoices/:id/finalize", authMiddleware, requirePermission("billing", "write"), requireTenantScope, finalizeInvoiceHandler as any);
router.get("/api/company/billing/invoices", authMiddleware, requirePermission("billing", "read"), requireTenantScope, companyListInvoicesHandler as any);

router.get("/api/clinic/billing/invoices", authMiddleware, requirePermission("billing", "read"), requireClinicScope as any, clinicListInvoicesHandler as any);
router.get("/api/clinic/billing/invoices/:id", authMiddleware, requirePermission("billing", "read"), requireClinicScope as any, clinicGetInvoiceHandler as any);
router.get("/api/clinic/billing/invoices/:id/export.csv", authMiddleware, requirePermission("billing", "read"), requireClinicScope as any, clinicExportInvoiceCsvHandler as any);
router.get("/api/clinic/billing/invoices/:id/export.json", authMiddleware, requirePermission("billing", "read"), requireClinicScope as any, clinicExportInvoiceJsonHandler as any);
router.post("/api/clinic/billing/invoices/:id/pay", authMiddleware, requirePermission("billing", "read"), requireClinicScope as any, clinicPayInvoiceHandler as any);

router.get("/api/clinic/dispatch-contact", authMiddleware, requireClinicScope as any, getDispatchContactHandler as any);

router.post("/api/clinic/support/thread", authMiddleware, requirePermission("support", "write"), clinicCreateSupportThreadHandler as any);
router.get("/api/clinic/support/thread", authMiddleware, requirePermission("support", "read"), clinicGetSupportThreadHandler as any);
router.get("/api/clinic/support/thread/:id/messages", authMiddleware, requirePermission("support", "read"), clinicGetThreadMessagesHandler as any);
router.post("/api/clinic/support/message", authMiddleware, requirePermission("support", "write"), clinicPostMessageHandler as any);

router.get("/api/company/support/threads", authMiddleware, requirePermission("support", "read"), requireTenantScope, companyListSupportThreadsHandler as any);
router.get("/api/company/support/threads/:id/messages", authMiddleware, requirePermission("support", "read"), requireTenantScope, companyGetThreadMessagesHandler as any);
router.post("/api/company/support/threads/:id/message", authMiddleware, requirePermission("support", "write"), requireTenantScope, companyPostThreadMessageHandler as any);
router.post("/api/company/support/threads/:id/close", authMiddleware, requirePermission("support", "write"), requireTenantScope, companyCloseThreadHandler as any);

export function registerBillingV2Routes(app: Express) {
  app.use(router);
}
