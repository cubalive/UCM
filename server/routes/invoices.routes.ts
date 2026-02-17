import express, { type Express } from "express";
import { authMiddleware, requireRole, requirePermission, type AuthRequest } from "../auth";
import { requireCompanyScope } from "../middleware";
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

router.get("/api/invoices", authMiddleware, requirePermission("invoices", "read"), requireCompanyScope, getInvoicesHandler as any);
router.patch("/api/invoices/:id", authMiddleware, requirePermission("invoices", "write"), requireCompanyScope, updateInvoiceHandler as any);
router.patch("/api/invoices/:id/mark-paid", authMiddleware, requirePermission("invoices", "write"), requireCompanyScope, markInvoicePaidHandler as any);
router.post("/api/invoices/:id/pdf", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER"), requireCompanyScope, invoicePdfHandler as any);
router.post("/api/invoices/:id/send-email", authMiddleware, requirePermission("invoices", "write"), requireCompanyScope, sendInvoiceEmailHandler as any);
router.get("/api/billing/weekly", authMiddleware, requirePermission("invoices", "read"), requireCompanyScope, getWeeklyBillingHandler as any);
router.get("/api/billing/weekly/preview", authMiddleware, requirePermission("invoices", "read"), requireCompanyScope, getWeeklyBillingPreviewHandler as any);
router.post("/api/billing/weekly/generate", authMiddleware, requirePermission("invoices", "write"), requireCompanyScope, generateWeeklyBillingHandler as any);
router.get("/api/billing/weekly/:id/trips", authMiddleware, requirePermission("invoices", "read"), requireCompanyScope, getWeeklyBillingTripsHandler as any);
router.get("/api/billing/weekly/:id/pdf", authMiddleware, requirePermission("invoices", "read"), requireCompanyScope, getWeeklyBillingPdfHandler as any);
router.get("/api/verify/trip/:token", verifyTripHandler as any);

export function registerInvoiceRoutes(app: Express) {
  app.use(router);
}
