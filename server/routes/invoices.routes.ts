import express, { type Express } from "express";
import { authMiddleware, requireRole, requirePermission, type AuthRequest } from "../auth";
import { requireTenantScope } from "../middleware";
import {
  getInvoicesHandler,
  updateInvoiceHandler,
  markInvoicePaidHandler,
  invoicePdfHandler,
  sendInvoiceEmailHandler,
  getWeeklyBillingHandler,
  getWeeklyBillingPreviewHandler,
  generateWeeklyBillingHandler,
  getWeeklyBillingTripsHandler,
  getWeeklyBillingPdfHandler,
  verifyTripHandler,
} from "../controllers/invoices.controller";

const router = express.Router();

router.get("/api/invoices", authMiddleware, requirePermission("invoices", "read"), requireTenantScope, getInvoicesHandler as any);
router.patch("/api/invoices/:id", authMiddleware, requirePermission("invoices", "write"), requireTenantScope, updateInvoiceHandler as any);
router.patch("/api/invoices/:id/mark-paid", authMiddleware, requirePermission("invoices", "write"), requireTenantScope, markInvoicePaidHandler as any);
router.post("/api/invoices/:id/pdf", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER"), requireTenantScope, invoicePdfHandler as any);
router.post("/api/invoices/:id/send-email", authMiddleware, requirePermission("invoices", "write"), requireTenantScope, sendInvoiceEmailHandler as any);
router.get("/api/billing/weekly", authMiddleware, requirePermission("invoices", "read"), requireTenantScope, getWeeklyBillingHandler as any);
router.get("/api/billing/weekly/preview", authMiddleware, requirePermission("invoices", "read"), requireTenantScope, getWeeklyBillingPreviewHandler as any);
router.post("/api/billing/weekly/generate", authMiddleware, requirePermission("invoices", "write"), requireTenantScope, generateWeeklyBillingHandler as any);
router.get("/api/billing/weekly/:id/trips", authMiddleware, requirePermission("invoices", "read"), requireTenantScope, getWeeklyBillingTripsHandler as any);
router.get("/api/billing/weekly/:id/pdf", authMiddleware, requirePermission("invoices", "read"), requireTenantScope, getWeeklyBillingPdfHandler as any);
router.get("/api/verify/trip/:token", verifyTripHandler as any);

export function registerInvoiceRoutes(app: Express) {
  app.use(router);
}
