import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, authorize, tenantIsolation } from "../middleware/auth.js";
import { validateBody, validateParams, validateQuery, uuidParam, paginationQuery } from "../middleware/validation.js";
import { billingRateLimiter, paymentRateLimiter } from "../middleware/rateLimiter.js";
import { generateInvoice, finalizeInvoice, recordPayment, createStripePaymentIntent } from "../services/invoiceService.js";
import { generateInvoicePdf } from "../services/pdfService.js";
import { sendInvoiceGeneratedEmail } from "../services/emailService.js";
import { getDb } from "../db/index.js";
import { invoices, invoiceLineItems, billingCycles } from "../db/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { stripeDashboardUrl, isTestMode } from "../utils/stripeLinks.js";
import logger from "../lib/logger.js";

const router = Router();

// All billing routes require auth + tenant isolation
router.use(authenticate, tenantIsolation);

// Schemas
const generateInvoiceSchema = z.object({
  patientId: z.string().uuid().optional(),
  billingCycleId: z.string().uuid().optional(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
}).refine(data => data.periodStart < data.periodEnd, {
  message: "periodStart must be before periodEnd",
});

const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  stripePaymentIntentId: z.string().optional(),
});

// List invoices
router.get("/invoices", billingRateLimiter, validateQuery(paginationQuery), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { page, limit } = req.query as unknown as { page: number; limit: number };
    const offset = (page - 1) * limit;

    const results = await db
      .select()
      .from(invoices)
      .where(eq(invoices.tenantId, req.tenantId!))
      .orderBy(desc(invoices.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(eq(invoices.tenantId, req.tenantId!));

    res.json({ data: results, pagination: { page, limit, total: Number(count) } });
  } catch (err: any) {
    logger.error("Failed to list invoices", { error: err.message });
    res.status(500).json({ error: "Failed to list invoices" });
  }
});

// Get invoice by ID
router.get("/invoices/:id", billingRateLimiter, validateParams(uuidParam), async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, req.params.id as string), eq(invoices.tenantId, req.tenantId!)));

    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const lineItems = await db
      .select()
      .from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoice.id));

    const testMode = isTestMode();
    const links: Record<string, string> = {};
    if (invoice.stripePaymentIntentId) {
      links.stripePayment = stripeDashboardUrl("payment_intent", invoice.stripePaymentIntentId, testMode);
    }
    if (invoice.stripeInvoiceId) {
      links.stripeInvoice = stripeDashboardUrl("invoice", invoice.stripeInvoiceId, testMode);
    }

    res.json({ ...invoice, lineItems, links });
  } catch (err: any) {
    logger.error("Failed to get invoice", { error: err.message });
    res.status(500).json({ error: "Failed to get invoice" });
  }
});

// Generate invoice
router.post(
  "/invoices/generate",
  billingRateLimiter,
  authorize("admin", "billing"),
  validateBody(generateInvoiceSchema),
  async (req: Request, res: Response) => {
    try {
      const invoice = await generateInvoice({
        tenantId: req.tenantId!,
        userId: req.user!.id,
        ...req.body,
      });

      if (!invoice) {
        res.status(404).json({ error: "No completed trips found in the specified period" });
        return;
      }

      // Send email notification (fire-and-forget, non-blocking)
      if (req.user?.email) {
        sendInvoiceGeneratedEmail(
          req.user.email,
          invoice.invoiceNumber,
          String(invoice.total),
          invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "N/A"
        ).catch(err => logger.warn("Failed to send invoice email", { error: err.message }));
      }

      res.status(201).json(invoice);
    } catch (err: any) {
      logger.error("Failed to generate invoice", { error: err.message });
      res.status(500).json({ error: "Failed to generate invoice" });
    }
  }
);

// Finalize invoice
router.post(
  "/invoices/:id/finalize",
  billingRateLimiter,
  authorize("admin", "billing"),
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const invoice = await finalizeInvoice(req.params.id as string, req.tenantId!);
      res.json(invoice);
    } catch (err: any) {
      logger.error("Failed to finalize invoice", { error: err.message });
      const status = err.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

// Record payment
router.post(
  "/invoices/:id/pay",
  paymentRateLimiter,
  authorize("admin", "billing"),
  validateParams(uuidParam),
  validateBody(recordPaymentSchema),
  async (req: Request, res: Response) => {
    try {
      const result = await recordPayment(
        req.params.id as string,
        req.tenantId!,
        req.body.amount,
        req.body.stripePaymentIntentId
      );
      res.json(result);
    } catch (err: any) {
      logger.error("Failed to record payment", { error: err.message });
      const status = err.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

// Create Stripe payment intent
router.post(
  "/invoices/:id/payment-intent",
  paymentRateLimiter,
  authorize("admin", "billing"),
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const paymentIntent = await createStripePaymentIntent(req.params.id as string, req.tenantId!);
      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
      });
    } catch (err: any) {
      logger.error("Failed to create payment intent", { error: err.message });
      const status = err.message.includes("not found") ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  }
);

// Retry payment (creates a new payment intent for existing invoice)
router.post(
  "/invoices/:id/retry-payment",
  paymentRateLimiter,
  authorize("admin", "billing"),
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const [invoice] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, req.params.id as string), eq(invoices.tenantId, req.tenantId!)));

      if (!invoice) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }

      if (invoice.status === "paid") {
        res.status(400).json({ error: "Invoice is already paid" });
        return;
      }

      // Reset overdue status back to pending
      if (invoice.status === "overdue") {
        await db
          .update(invoices)
          .set({ status: "pending", updatedAt: new Date() })
          .where(eq(invoices.id, req.params.id as string));
      }

      const paymentIntent = await createStripePaymentIntent(req.params.id as string, req.tenantId!);
      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        stripeDashboardUrl: `https://dashboard.stripe.com/payments/${paymentIntent.id}`,
      });
    } catch (err: any) {
      logger.error("Failed to retry payment", { error: err.message });
      res.status(500).json({ error: "Failed to retry payment" });
    }
  }
);

// Download invoice PDF
router.get(
  "/invoices/:id/pdf",
  billingRateLimiter,
  validateParams(uuidParam),
  async (req: Request, res: Response) => {
    try {
      const pdf = await generateInvoicePdf(req.params.id as string, req.tenantId!);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="invoice-${req.params.id as string}.pdf"`);
      res.send(pdf);
    } catch (err: any) {
      logger.error("Failed to generate PDF", { error: err.message });
      const status = err.message.includes("not found") ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  }
);

// Billing cycles
router.get("/billing-cycles", billingRateLimiter, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const results = await db
      .select()
      .from(billingCycles)
      .where(eq(billingCycles.tenantId, req.tenantId!))
      .orderBy(desc(billingCycles.periodStart));

    res.json({ data: results });
  } catch (err: any) {
    logger.error("Failed to list billing cycles", { error: err.message });
    res.status(500).json({ error: "Failed to list billing cycles" });
  }
});

export default router;
