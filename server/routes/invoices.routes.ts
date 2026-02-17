import express, { type Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
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

router.get("/api/invoices", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), getInvoicesHandler as any);
router.patch("/api/invoices/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), updateInvoiceHandler as any);
router.patch("/api/invoices/:id/mark-paid", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), markInvoicePaidHandler as any);
router.post("/api/invoices/:id/pdf", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER"), invoicePdfHandler as any);
router.post("/api/invoices/:id/send-email", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), sendInvoiceEmailHandler as any);
router.get("/api/billing/weekly", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), getWeeklyBillingHandler as any);
router.get("/api/billing/weekly/preview", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), getWeeklyBillingPreviewHandler as any);
router.post("/api/billing/weekly/generate", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), generateWeeklyBillingHandler as any);
router.get("/api/billing/weekly/:id/trips", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), getWeeklyBillingTripsHandler as any);
router.get("/api/billing/weekly/:id/pdf", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), getWeeklyBillingPdfHandler as any);
router.get("/api/verify/trip/:token", verifyTripHandler as any);

export function registerInvoiceRoutes(app: Express) {
  app.use(router);
}
