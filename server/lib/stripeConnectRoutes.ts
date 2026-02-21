import type { Express, Request, Response } from "express";
import { authMiddleware, requireRole, getActorContext, type AuthRequest } from "../auth";
import { storage } from "../storage";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { invoices, companies, billingCycleInvoices } from "@shared/schema";

function getStripe() {
  const Stripe = require("stripe").default;
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

const APP_URL = () =>
  process.env.APP_PUBLIC_URL ||
  process.env.PUBLIC_BASE_URL ||
  process.env.APP_URL ||
  "https://app.unitedcaremobility.com";

export function registerStripeConnectRoutes(app: Express) {

  app.post(
    "/api/admin/companies/:companyId/stripe/connect/create",
    authMiddleware,
    requireRole("SUPER_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = parseInt(String(req.params.companyId));
        if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });

        if (!process.env.STRIPE_SECRET_KEY) {
          return res.status(500).json({ message: "Stripe not configured" });
        }

        const existing = await storage.getCompanyStripeAccount(companyId);
        if (existing) {
          return res.json({ accountId: existing.stripeAccountId, alreadyExists: true });
        }

        const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
        if (!company) return res.status(404).json({ message: "Company not found" });
        const stripe = getStripe();

        const account = await stripe.accounts.create({
          type: "express",
          metadata: { ucm_company_id: String(companyId) },
          business_profile: {
            name: company?.name || `Company ${companyId}`,
          },
        });

        await storage.upsertCompanyStripeAccount({
          companyId,
          stripeAccountId: account.id,
          chargesEnabled: account.charges_enabled || false,
          payoutsEnabled: account.payouts_enabled || false,
          detailsSubmitted: account.details_submitted || false,
          onboardingStatus: "PENDING",
        });

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "STRIPE_CONNECT_CREATE",
          entity: "company",
          entityId: companyId,
          details: `Created Stripe connected account ${account.id} for company ${companyId}`,
        });

        res.json({ accountId: account.id });
      } catch (err: any) {
        console.error("[StripeConnect] Create error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/admin/companies/:companyId/stripe/connect/onboarding-link",
    authMiddleware,
    requireRole("SUPER_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = parseInt(String(req.params.companyId));
        if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });

        if (!process.env.STRIPE_SECRET_KEY) {
          return res.status(500).json({ message: "Stripe not configured" });
        }

        const account = await storage.getCompanyStripeAccount(companyId);
        if (!account) {
          return res.status(404).json({ message: "No Stripe account for this company. Create one first." });
        }

        const stripe = getStripe();
        const baseUrl = APP_URL();

        const accountLink = await stripe.accountLinks.create({
          account: account.stripeAccountId,
          refresh_url: `${baseUrl}/companies?stripe=refresh&company=${companyId}`,
          return_url: `${baseUrl}/companies?stripe=return&company=${companyId}`,
          type: "account_onboarding",
        });

        res.json({ url: accountLink.url });
      } catch (err: any) {
        console.error("[StripeConnect] Onboarding link error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/admin/companies/:companyId/stripe/connect/status",
    authMiddleware,
    requireRole("SUPER_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = parseInt(String(req.params.companyId));
        if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });

        if (!process.env.STRIPE_SECRET_KEY) {
          return res.status(500).json({ message: "Stripe not configured" });
        }

        const record = await storage.getCompanyStripeAccount(companyId);
        if (!record) {
          return res.json({ connected: false, onboardingStatus: "NOT_CREATED" });
        }

        const stripe = getStripe();
        const account = await stripe.accounts.retrieve(record.stripeAccountId);

        const chargesEnabled = account.charges_enabled || false;
        const payoutsEnabled = account.payouts_enabled || false;
        const detailsSubmitted = account.details_submitted || false;
        const onboardingStatus =
          chargesEnabled && payoutsEnabled ? "ACTIVE" : "RESTRICTED";

        await storage.updateCompanyStripeAccount(companyId, {
          chargesEnabled,
          payoutsEnabled,
          detailsSubmitted,
          onboardingStatus,
        });

        res.json({
          connected: true,
          stripeAccountId: record.stripeAccountId,
          chargesEnabled,
          payoutsEnabled,
          detailsSubmitted,
          onboardingStatus,
        });
      } catch (err: any) {
        console.error("[StripeConnect] Status error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/clinic/invoices/:id/pay",
    authMiddleware,
    async (req: AuthRequest, res: Response) => {
      try {
        const invoiceId = parseInt(String(req.params.id));
        if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

        if (!process.env.STRIPE_SECRET_KEY) {
          return res.status(500).json({ message: "Stripe not configured" });
        }

        const actor = await getActorContext(req);
        if (!actor) return res.status(401).json({ message: "Unauthorized" });

        const invoice = await storage.getInvoice(invoiceId);
        if (!invoice) return res.status(404).json({ message: "Invoice not found" });

        const clinic = await storage.getClinic(invoice.clinicId);
        if (!clinic) return res.status(404).json({ message: "Invoice not found" });

        if (actor.role === "CLINIC_USER") {
          if (!actor.clinicId || actor.clinicId !== invoice.clinicId) {
            return res.status(404).json({ message: "Invoice not found" });
          }
          if (actor.companyId && clinic.companyId && actor.companyId !== clinic.companyId) {
            return res.status(404).json({ message: "Invoice not found" });
          }
        } else if (actor.companyId) {
          if (clinic.companyId && actor.companyId !== clinic.companyId) {
            return res.status(404).json({ message: "Invoice not found" });
          }
        }

        if (invoice.status === "paid") {
          return res.json({
            alreadyPaid: true,
            receiptUrl: invoice.receiptUrl,
            paidAt: invoice.paidAt,
          });
        }

        const companyId = clinic.companyId;
        if (!companyId) {
          return res.status(409).json({ message: "Company billing not enabled yet" });
        }

        const stripeAccount = await storage.getCompanyStripeAccount(companyId);
        if (!stripeAccount || stripeAccount.onboardingStatus !== "ACTIVE") {
          return res.status(409).json({ message: "Company billing not enabled yet" });
        }

        const amountCents = Math.round(
          (typeof invoice.amount === "string" ? parseFloat(invoice.amount) : Number(invoice.amount)) * 100
        );
        if (amountCents <= 0) {
          return res.status(400).json({ message: "Invalid invoice amount" });
        }

        const stripe = getStripe();
        const baseUrl = APP_URL();

        const user = await storage.getUser(actor.userId);

        const { resolveFeeRule } = await import("../services/feeRules");
        const feeResult = await resolveFeeRule({
          companyId,
          clinicId: invoice.clinicId,
          amountCents,
          serviceLevel: null,
        });
        const applicationFeeAmount = feeResult.feeCents;

        const paymentMetadata: Record<string, string> = {
          invoice_id: String(invoice.id),
          company_id: String(companyId),
          clinic_id: String(invoice.clinicId),
          type: "clinic_invoice",
        };

        if (applicationFeeAmount > 0) {
          paymentMetadata.platform_fee_cents = String(applicationFeeAmount);
          paymentMetadata.fee_source = feeResult.source;
          if (feeResult.details.ruleId) paymentMetadata.fee_rule_id = String(feeResult.details.ruleId);
          if (feeResult.details.feeType) paymentMetadata.fee_type = feeResult.details.feeType;
          if (feeResult.details.percentBps) paymentMetadata.percent_bps = String(feeResult.details.percentBps);
        }

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: `Invoice #${invoice.id} - ${clinic.name || "Clinic"}`,
                  description: `Service: ${invoice.serviceDate || "N/A"} | Patient: ${invoice.patientName || "N/A"}`,
                },
                unit_amount: amountCents,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          customer_email: user?.email || undefined,
          success_url: `${baseUrl}/clinic/invoices?paid=1&invoice=${invoice.id}`,
          cancel_url: `${baseUrl}/clinic/invoices?canceled=1&invoice=${invoice.id}`,
          payment_intent_data: {
            transfer_data: {
              destination: stripeAccount.stripeAccountId,
            },
            application_fee_amount: applicationFeeAmount,
            metadata: paymentMetadata,
          },
          metadata: {
            invoice_id: String(invoice.id),
            company_id: String(companyId),
            clinic_id: String(invoice.clinicId),
            type: "clinic_invoice",
          },
        });

        await db
          .update(invoices)
          .set({ stripeCheckoutSessionId: session.id })
          .where(eq(invoices.id, invoice.id));

        res.json({ url: session.url });
      } catch (err: any) {
        console.error("[StripeConnect] Pay error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/stripe/webhook", async (req: Request, res: Response) => {
    try {
      if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
        return res.status(500).json({ message: "Stripe not configured" });
      }

      const stripe = getStripe();
      const sig = req.headers["stripe-signature"];
      if (!sig) return res.status(400).json({ message: "Missing stripe-signature" });

      let event: any;
      try {
        event = stripe.webhooks.constructEvent(
          (req as any).rawBody,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err: any) {
        console.error("[StripeWebhook] Signature verification failed:", err.message);
        return res.status(400).json({ message: "Webhook signature verification failed" });
      }

      const { inserted } = await storage.insertStripeWebhookEvent(event.id, event.type);
      if (!inserted) {
        console.log(`[StripeWebhook] Duplicate event ${event.id}, skipping`);
        return res.status(200).json({ received: true, duplicate: true });
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const metadata = session.metadata || {};

        if (metadata.type === "billing_cycle_invoice") {
          const bciId = parseInt(metadata.billing_cycle_invoice_id);
          if (isNaN(bciId)) {
            await storage.updateStripeWebhookEvent(event.id, "IGNORED", "Invalid billing_cycle_invoice_id");
            return res.status(200).json({ received: true });
          }

          const [bci] = await db.select().from(billingCycleInvoices).where(eq(billingCycleInvoices.id, bciId));
          if (!bci) {
            await storage.updateStripeWebhookEvent(event.id, "IGNORED", `BCI ${bciId} not found`);
            return res.status(200).json({ received: true });
          }
          if (bci.paymentStatus === "paid") {
            await storage.updateStripeWebhookEvent(event.id, "IGNORED", "Already paid");
            return res.status(200).json({ received: true });
          }

          if (metadata.clinic_id && String(bci.clinicId) !== metadata.clinic_id) {
            await storage.updateStripeWebhookEvent(event.id, "IGNORED", "BCI clinic mismatch");
            return res.status(200).json({ received: true });
          }
          if (metadata.company_id && bci.companyId && String(bci.companyId) !== metadata.company_id) {
            await storage.updateStripeWebhookEvent(event.id, "IGNORED", "BCI company mismatch");
            return res.status(200).json({ received: true });
          }

          let bciReceiptUrl: string | null = null;
          const bciPaymentIntentId = session.payment_intent || null;
          if (bciPaymentIntentId) {
            try {
              const pi = await stripe.paymentIntents.retrieve(bciPaymentIntentId);
              const latestCharge = pi.latest_charge;
              if (latestCharge) {
                const charge = typeof latestCharge === "string"
                  ? await stripe.charges.retrieve(latestCharge)
                  : latestCharge;
                bciReceiptUrl = charge.receipt_url || null;
              }
            } catch (e: any) {
              console.warn("[StripeWebhook] Could not retrieve BCI charge:", e.message);
            }
          }

          await db.update(billingCycleInvoices).set({
            paymentStatus: "paid",
            amountPaidCents: bci.totalCents,
            balanceDueCents: 0,
            lastPaymentAt: new Date(),
            locked: true,
            stripePaymentIntentId: bciPaymentIntentId,
            receiptUrl: bciReceiptUrl,
            updatedAt: new Date(),
          }).where(eq(billingCycleInvoices.id, bciId));

          try {
            const { ledgerEntries } = await import("@shared/schema");
            const existing = await db.select().from(ledgerEntries)
              .where(and(
                eq(ledgerEntries.refType, "payment_intent"),
                eq(ledgerEntries.refId, bciPaymentIntentId || `session_${session.id}`),
              ))
              .limit(1);
            if (existing.length === 0) {
              const { writePaymentSucceededJournal } = await import("../services/ledgerService");
              await writePaymentSucceededJournal({
                paymentIntentId: bciPaymentIntentId || `session_${session.id}`,
                invoiceId: bciId,
                clinicId: bci.clinicId,
                companyId: bci.companyId || parseInt(metadata.company_id) || 0,
                totalCents: bci.totalCents || 0,
                platformFeeCents: bci.platformFeeCents || parseInt(metadata.platform_fee_cents || "0") || 0,
              });
            }
          } catch (ledgerErr: any) {
            console.warn("[StripeWebhook] Ledger write failed (non-fatal):", ledgerErr.message);
          }

          try {
            const { writeBillingAudit } = await import("../services/billingAuditService");
            await writeBillingAudit({
              action: "payment_succeeded",
              entityType: "invoice",
              entityId: bciId,
              scopeClinicId: bci.clinicId,
              scopeCompanyId: bci.companyId,
              details: { paymentIntentId: bciPaymentIntentId, amountCents: bci.totalCents, source: "webhook", stripeEventId: event.id },
            });
          } catch {}

          if (bciPaymentIntentId) {
            try {
              const pi = await stripe.paymentIntents.retrieve(bciPaymentIntentId);
              if (pi.payment_method && bci.clinicId) {
                const { clinics: clinicsTable } = await import("@shared/schema");
                const [clinic] = await db.select().from(clinicsTable).where(eq(clinicsTable.id, bci.clinicId));
                if (clinic && !clinic.stripeDefaultPaymentMethodId) {
                  await db.update(clinicsTable).set({
                    stripeDefaultPaymentMethodId: pi.payment_method as string,
                  }).where(eq(clinicsTable.id, bci.clinicId));
                }
              }
            } catch {}
          }

          await storage.updateStripeWebhookEvent(event.id, "PROCESSED");
          console.log(`[StripeWebhook] BillingCycleInvoice ${bciId} marked PAID`);
          return res.status(200).json({ received: true, invoiceId: bciId, status: "paid" });
        }

        if (metadata.type !== "clinic_invoice") {
          await storage.updateStripeWebhookEvent(event.id, "IGNORED");
          return res.status(200).json({ received: true });
        }

        const invoiceId = parseInt(metadata.invoice_id);
        if (isNaN(invoiceId)) {
          await storage.updateStripeWebhookEvent(event.id, "IGNORED", "Invalid invoice_id in metadata");
          return res.status(200).json({ received: true });
        }

        const invoice = await storage.getInvoice(invoiceId);
        if (!invoice) {
          await storage.updateStripeWebhookEvent(event.id, "IGNORED", `Invoice ${invoiceId} not found`);
          return res.status(200).json({ received: true });
        }

        if (invoice.status === "paid") {
          await storage.updateStripeWebhookEvent(event.id, "IGNORED", "Already paid");
          return res.status(200).json({ received: true });
        }

        const clinic = await storage.getClinic(invoice.clinicId);
        if (
          metadata.company_id &&
          clinic?.companyId &&
          String(clinic.companyId) !== metadata.company_id
        ) {
          await storage.updateStripeWebhookEvent(event.id, "IGNORED", "Company mismatch");
          return res.status(200).json({ received: true });
        }
        if (
          metadata.clinic_id &&
          String(invoice.clinicId) !== metadata.clinic_id
        ) {
          await storage.updateStripeWebhookEvent(event.id, "IGNORED", "Clinic mismatch");
          return res.status(200).json({ received: true });
        }

        let receiptUrl: string | null = null;
        let chargeId: string | null = null;
        const paymentIntentId = session.payment_intent || null;

        if (paymentIntentId) {
          try {
            const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
            const latestCharge = pi.latest_charge;
            if (latestCharge) {
              const charge = typeof latestCharge === "string"
                ? await stripe.charges.retrieve(latestCharge)
                : latestCharge;
              chargeId = charge.id || null;
              receiptUrl = charge.receipt_url || null;
            }
          } catch (e: any) {
            console.warn("[StripeWebhook] Could not retrieve charge:", e.message);
          }
        }

        await db
          .update(invoices)
          .set({
            status: "paid",
            paidAt: new Date(),
            stripePaymentIntentId: paymentIntentId,
            stripeChargeId: chargeId,
            receiptUrl,
          })
          .where(eq(invoices.id, invoiceId));

        await storage.updateStripeWebhookEvent(event.id, "PROCESSED");

        console.log(`[StripeWebhook] Invoice ${invoiceId} marked PAID via checkout.session.completed`);
        return res.status(200).json({ received: true, invoiceId, status: "paid" });
      }

      if (event.type === "charge.dispute.created") {
        try {
          const dispute = event.data.object;
          const { writeDisputeJournal } = await import("../services/ledgerService");
          const { writeBillingAudit } = await import("../services/billingAuditService");

          await writeDisputeJournal({
            disputeId: dispute.id,
            amountCents: dispute.amount || 0,
            currency: dispute.currency || "usd",
          });

          await writeBillingAudit({
            action: "dispute_created",
            entityType: "dispute",
            entityId: dispute.id,
            details: { amount: dispute.amount, reason: dispute.reason, chargeId: dispute.charge },
          });

          await storage.updateStripeWebhookEvent(event.id, "PROCESSED", `Dispute ${dispute.id} recorded`);
          console.log(`[StripeWebhook] Dispute ${dispute.id} recorded, amount=${dispute.amount}`);
          return res.status(200).json({ received: true });
        } catch (disputeErr: any) {
          console.error("[StripeWebhook] Dispute handling error:", disputeErr.message);
        }
      }

      await storage.updateStripeWebhookEvent(event.id, "IGNORED", `Unhandled event type: ${event.type}`);
      return res.status(200).json({ received: true });
    } catch (err: any) {
      console.error("[StripeWebhook] Error:", err.message);
      if (err.stripeEventId) {
        await storage.updateStripeWebhookEvent(err.stripeEventId, "FAILED", err.message);
      }
      return res.status(500).json({ message: "Webhook processing error" });
    }
  });
}
