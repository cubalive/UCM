import type { Express, Response } from "express";
import { authMiddleware, requireRole, type AuthRequest, getCompanyIdFromAuth } from "../auth";
import { db } from "../db";
import { eq, and, inArray, lte, sql } from "drizzle-orm";
import {
  companyPayrollSettings, driverStripeAccounts, driverEarningsLedger,
  payrollPayruns, payrollPayrunItems, trips, drivers, companies,
  type CompanyPayrollSettings, type DriverStripeAccount,
} from "@shared/schema";

async function getStripe() {
  const Stripe = (await import("stripe")).default;
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

const APP_URL = () =>
  process.env.APP_PUBLIC_URL ||
  process.env.PUBLIC_BASE_URL ||
  process.env.APP_URL ||
  "https://app.unitedcaremobility.com";

function requireCompanyId(req: AuthRequest, res: Response): number | null {
  const companyId = getCompanyIdFromAuth(req);
  if (!companyId) {
    res.status(400).json({ message: "Company context required. COMPANY_ADMIN must belong to a company; SUPER_ADMIN must send x-ucm-company-id header." });
    return null;
  }
  return companyId;
}

export function registerPayrollRoutes(app: Express) {

  app.get(
    "/api/company/payroll/settings",
    authMiddleware,
    requireRole("COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = requireCompanyId(req, res);
        if (!companyId) return;

        const [settings] = await db.select().from(companyPayrollSettings)
          .where(eq(companyPayrollSettings.companyId, companyId));

        res.json({ settings: settings || null });
      } catch (err: any) {
        console.error("[Payroll] Get settings error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.put(
    "/api/company/payroll/settings",
    authMiddleware,
    requireRole("COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = requireCompanyId(req, res);
        if (!companyId) return;

        const { cadence, paydayWeekday, paydayDayOfMonth, timezone, payMode,
          hourlyRateCents, perTripFlatCents, perTripPercentBps,
          requireTripFinalized, requireClinicPaid, minimumPayoutCents, holdbackDays } = req.body;

        if (!cadence || !payMode) {
          return res.status(400).json({ message: "cadence and payMode are required" });
        }

        if (payMode === "HOURLY" && (!hourlyRateCents || hourlyRateCents <= 0)) {
          return res.status(400).json({ message: "hourlyRateCents is required for HOURLY mode" });
        }
        if (payMode === "PER_TRIP" && (!perTripFlatCents || perTripFlatCents <= 0)) {
          return res.status(400).json({ message: "perTripFlatCents is required for PER_TRIP mode" });
        }

        const [existing] = await db.select().from(companyPayrollSettings)
          .where(eq(companyPayrollSettings.companyId, companyId));

        const values = {
          companyId,
          cadence,
          paydayWeekday: paydayWeekday ?? null,
          paydayDayOfMonth: paydayDayOfMonth ?? null,
          timezone: timezone || "America/Los_Angeles",
          payMode,
          hourlyRateCents: hourlyRateCents ?? null,
          perTripFlatCents: perTripFlatCents ?? null,
          perTripPercentBps: perTripPercentBps ?? null,
          requireTripFinalized: requireTripFinalized ?? true,
          requireClinicPaid: requireClinicPaid ?? false,
          minimumPayoutCents: minimumPayoutCents ?? 0,
          holdbackDays: holdbackDays ?? 0,
          updatedAt: new Date(),
        };

        let result;
        if (existing) {
          const [row] = await db.update(companyPayrollSettings)
            .set(values)
            .where(eq(companyPayrollSettings.companyId, companyId))
            .returning();
          result = row;
        } else {
          const [row] = await db.insert(companyPayrollSettings)
            .values(values)
            .returning();
          result = row;
        }

        res.json({ settings: result });
      } catch (err: any) {
        console.error("[Payroll] Update settings error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/company/payroll/earnings/generate",
    authMiddleware,
    requireRole("COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = requireCompanyId(req, res);
        if (!companyId) return;

        const [settings] = await db.select().from(companyPayrollSettings)
          .where(eq(companyPayrollSettings.companyId, companyId));
        if (!settings) {
          return res.status(400).json({ message: "Payroll settings not configured for this company" });
        }

        const generated = await generateEarnings(companyId, settings);
        res.json({ generated });
      } catch (err: any) {
        console.error("[Payroll] Generate earnings error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/company/payroll/earnings",
    authMiddleware,
    requireRole("COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = requireCompanyId(req, res);
        if (!companyId) return;

        const driverIdFilter = req.query.driverId ? parseInt(String(req.query.driverId)) : null;
        const statusFilter = req.query.status ? String(req.query.status) : null;

        let conditions = [eq(driverEarningsLedger.companyId, companyId)];
        if (driverIdFilter) conditions.push(eq(driverEarningsLedger.driverId, driverIdFilter));
        if (statusFilter) conditions.push(eq(driverEarningsLedger.status, statusFilter as any));

        const rows = await db.select().from(driverEarningsLedger)
          .where(and(...conditions))
          .orderBy(driverEarningsLedger.earnedAt);

        res.json({ earnings: rows });
      } catch (err: any) {
        console.error("[Payroll] Get earnings error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/driver/payroll/earnings",
    authMiddleware,
    requireRole("DRIVER"),
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.userId;
        const [driver] = await db.select().from(drivers).where(eq(drivers.userId, userId));
        if (!driver) return res.status(404).json({ message: "Driver profile not found" });

        const rows = await db.select().from(driverEarningsLedger)
          .where(eq(driverEarningsLedger.driverId, driver.id))
          .orderBy(driverEarningsLedger.earnedAt);

        res.json({ earnings: rows });
      } catch (err: any) {
        console.error("[Payroll] Driver earnings error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/company/payroll/payruns/generate",
    authMiddleware,
    requireRole("COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = requireCompanyId(req, res);
        if (!companyId) return;

        const periodStart = String(req.query.periodStart || req.body.periodStart || "");
        const periodEnd = String(req.query.periodEnd || req.body.periodEnd || "");
        if (!periodStart || !periodEnd) {
          return res.status(400).json({ message: "periodStart and periodEnd are required (YYYY-MM-DD)" });
        }

        const [settings] = await db.select().from(companyPayrollSettings)
          .where(eq(companyPayrollSettings.companyId, companyId));
        if (!settings) {
          return res.status(400).json({ message: "Payroll settings not configured" });
        }

        const idempotencyKey = `payrun_${companyId}_${periodStart}_${periodEnd}`;
        const [existingPayrun] = await db.select().from(payrollPayruns)
          .where(eq(payrollPayruns.idempotencyKey, idempotencyKey));
        if (existingPayrun) {
          return res.json({ payrun: existingPayrun, message: "Payrun already exists for this period" });
        }

        await generateEarnings(companyId, settings);

        const eligibleEndDate = new Date(periodEnd + "T23:59:59Z");
        const eligible = await db.select().from(driverEarningsLedger)
          .where(and(
            eq(driverEarningsLedger.companyId, companyId),
            eq(driverEarningsLedger.status, "ELIGIBLE"),
            lte(driverEarningsLedger.eligibleAt, eligibleEndDate)
          ));

        if (eligible.length === 0) {
          return res.json({ payrun: null, message: "No eligible earnings found for this period" });
        }

        const driverTotals = new Map<number, number>();
        for (const e of eligible) {
          const current = driverTotals.get(e.driverId) || 0;
          driverTotals.set(e.driverId, current + e.amountCents);
        }

        const qualifiedDrivers = new Map<number, number>();
        for (const [dId, total] of driverTotals) {
          if (total >= settings.minimumPayoutCents) {
            qualifiedDrivers.set(dId, total);
          }
        }

        if (qualifiedDrivers.size === 0) {
          return res.json({ payrun: null, message: "No drivers meet minimum payout threshold" });
        }

        const scheduledPayday = periodEnd;

        const [payrun] = await db.insert(payrollPayruns).values({
          companyId,
          periodStart,
          periodEnd,
          payMode: settings.payMode,
          cadence: settings.cadence,
          scheduledPayday,
          status: "DRAFT",
          createdBy: req.user!.userId,
          idempotencyKey,
        }).returning();

        for (const [driverId, amount] of qualifiedDrivers) {
          await db.insert(payrollPayrunItems).values({
            payrunId: payrun.id,
            driverId,
            amountCents: amount,
          });
        }

        const qualifiedDriverIds = [...qualifiedDrivers.keys()];
        const eligibleIds = eligible
          .filter(e => qualifiedDriverIds.includes(e.driverId))
          .map(e => e.id);

        if (eligibleIds.length > 0) {
          await db.update(driverEarningsLedger)
            .set({ status: "IN_PAYRUN", payrunId: payrun.id })
            .where(inArray(driverEarningsLedger.id, eligibleIds));
        }

        res.json({ payrun, itemCount: qualifiedDrivers.size });
      } catch (err: any) {
        console.error("[Payroll] Generate payrun error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/company/payroll/payruns",
    authMiddleware,
    requireRole("COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = requireCompanyId(req, res);
        if (!companyId) return;

        const rows = await db.select().from(payrollPayruns)
          .where(eq(payrollPayruns.companyId, companyId))
          .orderBy(payrollPayruns.createdAt);

        res.json({ payruns: rows });
      } catch (err: any) {
        console.error("[Payroll] List payruns error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/company/payroll/payruns/:id",
    authMiddleware,
    requireRole("COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = requireCompanyId(req, res);
        if (!companyId) return;

        const payrunId = parseInt(String(req.params.id));
        if (isNaN(payrunId)) return res.status(400).json({ message: "Invalid payrun ID" });

        const [payrun] = await db.select().from(payrollPayruns)
          .where(and(eq(payrollPayruns.id, payrunId), eq(payrollPayruns.companyId, companyId)));
        if (!payrun) return res.status(404).json({ message: "Payrun not found" });

        const items = await db.select().from(payrollPayrunItems)
          .where(eq(payrollPayrunItems.payrunId, payrunId));

        res.json({ payrun, items });
      } catch (err: any) {
        console.error("[Payroll] Get payrun error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/company/payroll/payruns/:id/approve",
    authMiddleware,
    requireRole("COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = requireCompanyId(req, res);
        if (!companyId) return;

        const payrunId = parseInt(String(req.params.id));
        if (isNaN(payrunId)) return res.status(400).json({ message: "Invalid payrun ID" });

        const [payrun] = await db.select().from(payrollPayruns)
          .where(and(eq(payrollPayruns.id, payrunId), eq(payrollPayruns.companyId, companyId)));
        if (!payrun) return res.status(404).json({ message: "Payrun not found" });

        if (payrun.status !== "DRAFT") {
          return res.status(409).json({ message: `Cannot approve payrun in status ${payrun.status}` });
        }

        const [updated] = await db.update(payrollPayruns)
          .set({ status: "APPROVED", approvedBy: req.user!.userId, approvedAt: new Date() })
          .where(eq(payrollPayruns.id, payrunId))
          .returning();

        res.json({ payrun: updated });
      } catch (err: any) {
        console.error("[Payroll] Approve payrun error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/company/payroll/payruns/:id/process",
    authMiddleware,
    requireRole("COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = requireCompanyId(req, res);
        if (!companyId) return;

        const payrunId = parseInt(String(req.params.id));
        if (isNaN(payrunId)) return res.status(400).json({ message: "Invalid payrun ID" });

        const [payrun] = await db.select().from(payrollPayruns)
          .where(and(eq(payrollPayruns.id, payrunId), eq(payrollPayruns.companyId, companyId)));
        if (!payrun) return res.status(404).json({ message: "Payrun not found" });

        if (payrun.status === "PAID") {
          return res.json({ payrun, message: "Already paid" });
        }
        if (payrun.status !== "APPROVED") {
          return res.status(409).json({ message: `Cannot process payrun in status ${payrun.status}. Must be APPROVED.` });
        }

        await db.update(payrollPayruns)
          .set({ status: "PROCESSING" })
          .where(eq(payrollPayruns.id, payrunId));

        const items = await db.select().from(payrollPayrunItems)
          .where(eq(payrollPayrunItems.payrunId, payrunId));

        if (!process.env.STRIPE_SECRET_KEY) {
          await db.update(payrollPayruns)
            .set({ status: "FAILED" })
            .where(eq(payrollPayruns.id, payrunId));
          return res.status(500).json({ message: "Stripe not configured" });
        }

        const stripe = await getStripe();
        let allSuccess = true;
        const results: any[] = [];

        for (const item of items) {
          try {
            const [driverAccount] = await db.select().from(driverStripeAccounts)
              .where(and(
                eq(driverStripeAccounts.driverId, item.driverId),
                eq(driverStripeAccounts.companyId, companyId)
              ));

            if (!driverAccount || driverAccount.status !== "ACTIVE" || !driverAccount.payoutsEnabled) {
              results.push({ driverId: item.driverId, error: "Driver Stripe account not active or payouts not enabled" });
              allSuccess = false;
              continue;
            }

            if (item.stripeTransferId) {
              results.push({ driverId: item.driverId, transferId: item.stripeTransferId, status: "already_transferred" });
              continue;
            }

            const transfer = await stripe.transfers.create({
              amount: item.amountCents,
              currency: "usd",
              destination: driverAccount.stripeAccountId,
              transfer_group: payrun.idempotencyKey,
              metadata: {
                payrun_id: String(payrunId),
                driver_id: String(item.driverId),
                company_id: String(companyId),
              },
            }, {
              idempotencyKey: `${payrun.idempotencyKey}_driver_${item.driverId}`,
            });

            await db.update(payrollPayrunItems)
              .set({ stripeTransferId: transfer.id, paidAt: new Date() })
              .where(eq(payrollPayrunItems.id, item.id));

            results.push({ driverId: item.driverId, transferId: transfer.id, status: "success" });
          } catch (err: any) {
            console.error(`[Payroll] Transfer failed for driver ${item.driverId}:`, err.message);
            results.push({ driverId: item.driverId, error: err.message });
            allSuccess = false;
          }
        }

        const finalStatus = allSuccess ? "PAID" : "FAILED";
        await db.update(payrollPayruns)
          .set({ status: finalStatus, processedAt: new Date() })
          .where(eq(payrollPayruns.id, payrunId));

        if (allSuccess) {
          const ledgerIds = await db.select({ id: driverEarningsLedger.id }).from(driverEarningsLedger)
            .where(eq(driverEarningsLedger.payrunId, payrunId));
          if (ledgerIds.length > 0) {
            await db.update(driverEarningsLedger)
              .set({ status: "PAID" })
              .where(inArray(driverEarningsLedger.id, ledgerIds.map(l => l.id)));
          }
        }

        const [updatedPayrun] = await db.select().from(payrollPayruns)
          .where(eq(payrollPayruns.id, payrunId));

        res.json({ payrun: updatedPayrun, results });
      } catch (err: any) {
        console.error("[Payroll] Process payrun error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/driver/stripe/connect/create",
    authMiddleware,
    requireRole("DRIVER"),
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.userId;
        const [driver] = await db.select().from(drivers).where(eq(drivers.userId, userId));
        if (!driver || !driver.companyId) return res.status(404).json({ message: "Driver profile not found or no company" });

        if (!process.env.STRIPE_SECRET_KEY) {
          return res.status(500).json({ message: "Stripe not configured" });
        }

        const [existing] = await db.select().from(driverStripeAccounts)
          .where(and(
            eq(driverStripeAccounts.driverId, driver.id),
            eq(driverStripeAccounts.companyId, driver.companyId)
          ));
        if (existing) {
          return res.json({ accountId: existing.stripeAccountId, alreadyExists: true, status: existing.status });
        }

        const stripe = await getStripe();
        const account = await stripe.accounts.create({
          type: "express",
          metadata: {
            ucm_driver_id: String(driver.id),
            ucm_company_id: String(driver.companyId),
          },
          business_profile: {
            name: `${driver.firstName} ${driver.lastName}`,
          },
        });

        await db.insert(driverStripeAccounts).values({
          companyId: driver.companyId,
          driverId: driver.id,
          stripeAccountId: account.id,
          status: "PENDING",
          payoutsEnabled: false,
          detailsSubmitted: false,
        });

        res.json({ accountId: account.id });
      } catch (err: any) {
        console.error("[Payroll] Driver stripe create error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/driver/stripe/connect/onboarding-link",
    authMiddleware,
    requireRole("DRIVER"),
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.userId;
        const [driver] = await db.select().from(drivers).where(eq(drivers.userId, userId));
        if (!driver || !driver.companyId) return res.status(404).json({ message: "Driver profile not found" });

        if (!process.env.STRIPE_SECRET_KEY) {
          return res.status(500).json({ message: "Stripe not configured" });
        }

        const [account] = await db.select().from(driverStripeAccounts)
          .where(and(
            eq(driverStripeAccounts.driverId, driver.id),
            eq(driverStripeAccounts.companyId, driver.companyId)
          ));
        if (!account) {
          return res.status(404).json({ message: "No Stripe account. Create one first." });
        }

        const stripe = await getStripe();
        const baseUrl = APP_URL();

        const accountLink = await stripe.accountLinks.create({
          account: account.stripeAccountId,
          refresh_url: `${baseUrl}/driver/payments?stripe=refresh`,
          return_url: `${baseUrl}/driver/payments?stripe=return`,
          type: "account_onboarding",
        });

        res.json({ url: accountLink.url });
      } catch (err: any) {
        console.error("[Payroll] Driver stripe onboarding error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/driver/stripe/connect/status",
    authMiddleware,
    requireRole("DRIVER"),
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.userId;
        const [driver] = await db.select().from(drivers).where(eq(drivers.userId, userId));
        if (!driver || !driver.companyId) return res.status(404).json({ message: "Driver profile not found" });

        const [record] = await db.select().from(driverStripeAccounts)
          .where(and(
            eq(driverStripeAccounts.driverId, driver.id),
            eq(driverStripeAccounts.companyId, driver.companyId)
          ));
        if (!record) {
          return res.json({ connected: false, status: "NOT_CREATED" });
        }

        if (process.env.STRIPE_SECRET_KEY) {
          try {
            const stripe = await getStripe();
            const acct = await stripe.accounts.retrieve(record.stripeAccountId);
            const newStatus = acct.charges_enabled && acct.payouts_enabled ? "ACTIVE" : "RESTRICTED";
            await db.update(driverStripeAccounts)
              .set({
                status: newStatus,
                payoutsEnabled: acct.payouts_enabled || false,
                detailsSubmitted: acct.details_submitted || false,
              })
              .where(eq(driverStripeAccounts.id, record.id));
            return res.json({
              connected: true,
              stripeAccountId: record.stripeAccountId,
              status: newStatus,
              payoutsEnabled: acct.payouts_enabled || false,
              detailsSubmitted: acct.details_submitted || false,
            });
          } catch {}
        }

        res.json({
          connected: true,
          stripeAccountId: record.stripeAccountId,
          status: record.status,
          payoutsEnabled: record.payoutsEnabled,
          detailsSubmitted: record.detailsSubmitted,
        });
      } catch (err: any) {
        console.error("[Payroll] Driver stripe status error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/driver/payroll/payruns",
    authMiddleware,
    requireRole("DRIVER"),
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.user!.userId;
        const [driver] = await db.select().from(drivers).where(eq(drivers.userId, userId));
        if (!driver) return res.status(404).json({ message: "Driver profile not found" });

        const items = await db.select().from(payrollPayrunItems)
          .where(eq(payrollPayrunItems.driverId, driver.id));

        const payrunIds = [...new Set(items.map(i => i.payrunId))];
        if (payrunIds.length === 0) return res.json({ payruns: [] });

        const runs = await db.select().from(payrollPayruns)
          .where(inArray(payrollPayruns.id, payrunIds));

        const result = runs.map(run => {
          const driverItem = items.find(i => i.payrunId === run.id);
          return {
            payrunId: run.id,
            periodStart: run.periodStart,
            periodEnd: run.periodEnd,
            scheduledPayday: run.scheduledPayday,
            status: run.status,
            amountCents: driverItem?.amountCents || 0,
            stripeTransferId: driverItem?.stripeTransferId || null,
            paidAt: driverItem?.paidAt || null,
          };
        });

        res.json({ payruns: result });
      } catch (err: any) {
        console.error("[Payroll] Driver payruns error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/internal/payroll/run-due",
    async (req: AuthRequest, res: Response) => {
      try {
        const authHeader = req.headers.authorization;
        const internalSecret = process.env.PAYROLL_INTERNAL_SECRET || process.env.JWT_SECRET;
        if (!authHeader || authHeader !== `Bearer ${internalSecret}`) {
          return res.status(401).json({ message: "Unauthorized" });
        }

        const today = new Date().toISOString().split("T")[0];
        const duePayruns = await db.select().from(payrollPayruns)
          .where(and(
            eq(payrollPayruns.status, "APPROVED"),
            eq(payrollPayruns.scheduledPayday, today)
          ));

        if (duePayruns.length === 0) {
          return res.json({ processed: 0, message: "No due payruns today" });
        }

        const results: any[] = [];
        for (const payrun of duePayruns) {
          try {
            await processPayrun(payrun.id, payrun.companyId);
            results.push({ payrunId: payrun.id, status: "processed" });
          } catch (err: any) {
            results.push({ payrunId: payrun.id, status: "failed", error: err.message });
          }
        }

        res.json({ processed: results.length, results });
      } catch (err: any) {
        console.error("[Payroll] Run-due error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );
}

async function generateEarnings(companyId: number, settings: CompanyPayrollSettings): Promise<number> {
  const completedTrips = await db.select().from(trips)
    .where(and(
      eq(trips.companyId, companyId),
      eq(trips.status, "COMPLETED"),
    ));

  let generated = 0;
  const now = new Date();

  for (const trip of completedTrips) {
    if (!trip.driverId) continue;

    const [existing] = await db.select().from(driverEarningsLedger)
      .where(and(
        eq(driverEarningsLedger.companyId, companyId),
        eq(driverEarningsLedger.driverId, trip.driverId),
        eq(driverEarningsLedger.tripId, trip.id),
      ));
    if (existing) continue;

    const earnedAt = trip.completedAt || trip.createdAt;
    const holdbackMs = (settings.holdbackDays || 0) * 24 * 60 * 60 * 1000;
    const eligibleAt = new Date(earnedAt.getTime() + holdbackMs);

    let amountCents = 0;
    let earningType: "TRIP" | "HOURLY" = "TRIP";
    let units: string | null = null;

    if (settings.payMode === "PER_TRIP") {
      earningType = "TRIP";
      if (settings.perTripPercentBps && trip.priceTotalCents) {
        amountCents = Math.round((trip.priceTotalCents * settings.perTripPercentBps) / 10000);
      } else {
        amountCents = settings.perTripFlatCents || 0;
      }
      units = "1";
    } else {
      earningType = "HOURLY";
      let durationMinutes = trip.durationMinutes || 0;
      if (durationMinutes === 0 && trip.pickedUpAt && trip.completedAt) {
        durationMinutes = Math.round((trip.completedAt.getTime() - trip.pickedUpAt.getTime()) / 60000);
      }
      const hours = durationMinutes / 60;
      amountCents = Math.round(hours * (settings.hourlyRateCents || 0));
      units = String(hours.toFixed(2));
    }

    if (amountCents <= 0) continue;

    const isEligible = eligibleAt <= now;

    try {
      await db.insert(driverEarningsLedger).values({
        companyId,
        driverId: trip.driverId,
        tripId: trip.id,
        earningType,
        units,
        amountCents,
        currency: "USD",
        earnedAt,
        eligibleAt,
        status: isEligible ? "ELIGIBLE" : "EARNED",
      });
      generated++;
    } catch (e: any) {
      if (!e.message?.includes("duplicate")) throw e;
    }
  }

  return generated;
}

async function processPayrun(payrunId: number, companyId: number): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe not configured");
  }

  const [payrun] = await db.select().from(payrollPayruns)
    .where(eq(payrollPayruns.id, payrunId));
  if (!payrun || payrun.status !== "APPROVED") {
    throw new Error(`Payrun ${payrunId} is not in APPROVED status`);
  }

  await db.update(payrollPayruns)
    .set({ status: "PROCESSING" })
    .where(eq(payrollPayruns.id, payrunId));

  const items = await db.select().from(payrollPayrunItems)
    .where(eq(payrollPayrunItems.payrunId, payrunId));

  const stripe = await getStripe();
  let allSuccess = true;

  for (const item of items) {
    if (item.stripeTransferId) continue;

    const [driverAccount] = await db.select().from(driverStripeAccounts)
      .where(and(
        eq(driverStripeAccounts.driverId, item.driverId),
        eq(driverStripeAccounts.companyId, companyId)
      ));

    if (!driverAccount || driverAccount.status !== "ACTIVE" || !driverAccount.payoutsEnabled) {
      allSuccess = false;
      continue;
    }

    try {
      const transfer = await stripe.transfers.create({
        amount: item.amountCents,
        currency: "usd",
        destination: driverAccount.stripeAccountId,
        transfer_group: payrun.idempotencyKey,
        metadata: {
          payrun_id: String(payrunId),
          driver_id: String(item.driverId),
          company_id: String(companyId),
        },
      }, {
        idempotencyKey: `${payrun.idempotencyKey}_driver_${item.driverId}`,
      });

      await db.update(payrollPayrunItems)
        .set({ stripeTransferId: transfer.id, paidAt: new Date() })
        .where(eq(payrollPayrunItems.id, item.id));
    } catch (err: any) {
      console.error(`[Payroll] Auto-process transfer failed for driver ${item.driverId}:`, err.message);
      allSuccess = false;
    }
  }

  const finalStatus = allSuccess ? "PAID" : "FAILED";
  await db.update(payrollPayruns)
    .set({ status: finalStatus, processedAt: new Date() })
    .where(eq(payrollPayruns.id, payrunId));

  if (allSuccess) {
    const ledgerIds = await db.select({ id: driverEarningsLedger.id }).from(driverEarningsLedger)
      .where(eq(driverEarningsLedger.payrunId, payrunId));
    if (ledgerIds.length > 0) {
      await db.update(driverEarningsLedger)
        .set({ status: "PAID" })
        .where(inArray(driverEarningsLedger.id, ledgerIds.map(l => l.id)));
    }
  }
}

export function startPayrollScheduler() {
  setInterval(async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const duePayruns = await db.select().from(payrollPayruns)
        .where(and(
          eq(payrollPayruns.status, "APPROVED"),
          eq(payrollPayruns.scheduledPayday, today)
        ));

      for (const payrun of duePayruns) {
        try {
          await processPayrun(payrun.id, payrun.companyId);
          console.log(`[PayrollScheduler] Processed payrun ${payrun.id} for company ${payrun.companyId}`);
        } catch (err: any) {
          console.error(`[PayrollScheduler] Failed payrun ${payrun.id}:`, err.message);
        }
      }
    } catch (err: any) {
      console.error("[PayrollScheduler] Scheduler error:", err.message);
    }
  }, 60 * 60 * 1000);
}
