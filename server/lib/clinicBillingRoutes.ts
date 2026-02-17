import type { Express } from "express";
import { authMiddleware, requireRole, requirePermission, type AuthRequest } from "../auth";
import { db } from "../db";
import { storage } from "../storage";
import {
  clinicBillingProfiles,
  clinicBillingRules,
  clinicBillingInvoices,
  clinicBillingInvoiceLines,
  billingAuditLog,
  trips,
  patients,
  clinics,
  cities,
  clinicTariffs,
  tripBilling,
  clinicInvoicesMonthly,
  clinicInvoiceItems,
  insertClinicTariffSchema,
} from "@shared/schema";
import { eq, and, sql, gte, lte, isNull, inArray, desc } from "drizzle-orm";
import { z } from "zod";
import { computeBillingWindow } from "./billingCycleUtils";

const OUTCOMES = ["completed", "no_show", "cancelled", "company_error"] as const;
const LEG_TYPES = ["outbound", "return"] as const;
const CANCEL_WINDOWS = ["advance", "same_day", "late"] as const;

function classifyCancelWindow(
  trip: any,
  cancelAdvanceHours: number,
  cancelLateMinutes: number
): string {
  if (!trip.cancelledAt || !trip.scheduledDate || !trip.pickupTime) return "same_day";

  const pickupStr = `${trip.scheduledDate}T${trip.pickupTime}:00`;
  const pickupTime = new Date(pickupStr).getTime();
  const cancelTime = new Date(trip.cancelledAt).getTime();

  if (isNaN(pickupTime) || isNaN(cancelTime)) return "same_day";

  const hoursBeforePickup = (pickupTime - cancelTime) / (1000 * 60 * 60);
  const minutesBeforePickup = (pickupTime - cancelTime) / (1000 * 60);

  if (hoursBeforePickup >= cancelAdvanceHours) return "advance";
  if (minutesBeforePickup <= cancelLateMinutes) return "late";
  return "same_day";
}

function classifyBillingOutcome(trip: any): { outcome: string; reason: string } {
  const status = trip.status;
  if (status === "COMPLETED") return { outcome: "completed", reason: "Trip completed" };
  if (status === "NO_SHOW") return { outcome: "no_show", reason: "Patient or driver no-show" };
  if (status === "CANCELLED") {
    const fp = trip.faultParty;
    if (fp === "dispatch" || fp === "driver") {
      return { outcome: "company_error", reason: `Cancelled - fault: ${fp}` };
    }
    return { outcome: "cancelled", reason: trip.cancelledReason || "Trip cancelled" };
  }
  return { outcome: "completed", reason: "Default" };
}

function classifyLegType(trip: any): string {
  if (trip.parentTripId) return "return";
  return "outbound";
}

function lookupRate(
  rules: any[],
  outcome: string,
  passengerCount: number,
  legType: string,
  cancelWindow: string | null
): number {
  let rule = rules.find(
    (r: any) =>
      r.outcome === outcome &&
      r.passengerCount === passengerCount &&
      r.legType === legType &&
      (cancelWindow ? r.cancelWindow === cancelWindow : r.cancelWindow === null) &&
      r.enabled
  );
  if (!rule) {
    rule = rules.find(
      (r: any) =>
        r.outcome === outcome &&
        r.passengerCount === passengerCount &&
        r.legType === "both" &&
        (cancelWindow ? r.cancelWindow === cancelWindow : r.cancelWindow === null) &&
        r.enabled
    );
  }
  if (!rule && passengerCount > 1) {
    return lookupRate(rules, outcome, 1, legType, cancelWindow);
  }
  return rule ? parseFloat(rule.unitRate) : 0;
}

export async function autoBillingClassify(trip: any): Promise<void> {
  if (trip.billingOutcome) return;

  const { outcome, reason } = classifyBillingOutcome(trip);
  const legType = classifyLegType(trip);

  let cancelWin: string | null = null;
  if (outcome === "cancelled") {
    if (trip.clinicId) {
      const [profile] = await db
        .select()
        .from(clinicBillingProfiles)
        .where(
          and(
            eq(clinicBillingProfiles.clinicId, trip.clinicId),
            eq(clinicBillingProfiles.isActive, true)
          )
        );
      if (profile) {
        cancelWin = classifyCancelWindow(trip, profile.cancelAdvanceHours, profile.cancelLateMinutes);
      } else {
        cancelWin = classifyCancelWindow(trip, 24, 0);
      }
    } else {
      cancelWin = classifyCancelWindow(trip, 24, 0);
    }
  }

  await db.update(trips).set({
    billingOutcome: outcome,
    billingReason: reason,
    cancelWindow: cancelWin,
  }).where(eq(trips.id, trip.id));

  console.log(`[BILLING] Auto-classified trip ${trip.id}: outcome=${outcome}, leg=${legType}, cancelWindow=${cancelWin || "n/a"}`);
}

export function registerClinicBillingRoutes(app: Express) {

  app.get("/api/clinic-billing/profiles", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
      let profiles;
      if (clinicId) {
        profiles = await db.select().from(clinicBillingProfiles).where(eq(clinicBillingProfiles.clinicId, clinicId));
      } else {
        profiles = await db.select().from(clinicBillingProfiles);
      }
      const enriched = await Promise.all(profiles.map(async (p: any) => {
        const [clinic] = await db.select().from(clinics).where(eq(clinics.id, p.clinicId));
        const [city] = await db.select().from(cities).where(eq(cities.id, p.cityId));
        return { ...p, clinicName: clinic?.name, cityName: city?.name };
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/clinic-billing/profiles", authMiddleware, requirePermission("invoices", "write"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        clinicId: z.number(),
        cityId: z.number(),
        name: z.string().min(1),
        cancelAdvanceHours: z.number().optional(),
        cancelLateMinutes: z.number().optional(),
      });
      const data = schema.parse(req.body);

      const [profile] = await db
        .insert(clinicBillingProfiles)
        .values({
          clinicId: data.clinicId,
          cityId: data.cityId,
          name: data.name,
          cancelAdvanceHours: data.cancelAdvanceHours ?? 24,
          cancelLateMinutes: data.cancelLateMinutes ?? 0,
          createdBy: req.user!.userId,
        })
        .returning();

      const defaultRules: any[] = [];
      for (const pc of [1, 2, 3, 4]) {
        for (const lt of LEG_TYPES) {
          defaultRules.push({ profileId: profile.id, outcome: "completed", passengerCount: pc, legType: lt, cancelWindow: null, unitRate: "0.00", enabled: true });
          defaultRules.push({ profileId: profile.id, outcome: "no_show", passengerCount: pc, legType: lt, cancelWindow: null, unitRate: "0.00", enabled: true });
          for (const cw of CANCEL_WINDOWS) {
            defaultRules.push({ profileId: profile.id, outcome: "cancelled", passengerCount: pc, legType: lt, cancelWindow: cw, unitRate: "0.00", enabled: true });
          }
          defaultRules.push({ profileId: profile.id, outcome: "company_error", passengerCount: pc, legType: lt, cancelWindow: null, unitRate: "0.00", enabled: true });
        }
      }
      await db.insert(clinicBillingRules).values(defaultRules);

      res.json(profile);
    } catch (err: any) {
      if (err.code === "23505") {
        return res.status(409).json({ message: "A billing profile already exists for this clinic + city" });
      }
      res.status(err.issues ? 400 : 500).json({ message: err.message || String(err) });
    }
  });

  app.get("/api/clinic-billing/profiles/:id", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const [profile] = await db.select().from(clinicBillingProfiles).where(eq(clinicBillingProfiles.id, id));
      if (!profile) return res.status(404).json({ message: "Profile not found" });

      const rules = await db.select().from(clinicBillingRules).where(eq(clinicBillingRules.profileId, id));
      const [clinic] = await db.select().from(clinics).where(eq(clinics.id, profile.clinicId));
      const [city] = await db.select().from(cities).where(eq(cities.id, profile.cityId));

      res.json({ profile: { ...profile, clinicName: clinic?.name, cityName: city?.name }, rules });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/clinic-billing/profiles/:id", authMiddleware, requirePermission("invoices", "write"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const schema = z.object({
        name: z.string().optional(),
        isActive: z.boolean().optional(),
        cancelAdvanceHours: z.number().optional(),
        cancelLateMinutes: z.number().optional(),
      });
      const data = schema.parse(req.body);
      const [updated] = await db
        .update(clinicBillingProfiles)
        .set({ ...data, updatedBy: req.user!.userId, updatedAt: new Date() })
        .where(eq(clinicBillingProfiles.id, id))
        .returning();
      if (!updated) return res.status(404).json({ message: "Profile not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(err.issues ? 400 : 500).json({ message: err.message || String(err) });
    }
  });

  app.patch("/api/clinic-billing/rules/batch", authMiddleware, requirePermission("invoices", "write"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        rules: z.array(z.object({
          id: z.number(),
          unitRate: z.string(),
          enabled: z.boolean().optional(),
        })),
      });
      const { rules } = schema.parse(req.body);

      for (const r of rules) {
        await db
          .update(clinicBillingRules)
          .set({ unitRate: r.unitRate, enabled: r.enabled ?? true, updatedBy: req.user!.userId, updatedAt: new Date() })
          .where(eq(clinicBillingRules.id, r.id));
      }
      res.json({ updated: rules.length });
    } catch (err: any) {
      res.status(err.issues ? 400 : 500).json({ message: err.message || String(err) });
    }
  });

  app.patch("/api/clinic-billing/rules/:id", authMiddleware, requirePermission("invoices", "write"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const schema = z.object({
        unitRate: z.string(),
        enabled: z.boolean().optional(),
      });
      const data = schema.parse(req.body);
      const [updated] = await db
        .update(clinicBillingRules)
        .set({ ...data, updatedBy: req.user!.userId, updatedAt: new Date() })
        .where(eq(clinicBillingRules.id, id))
        .returning();
      if (!updated) return res.status(404).json({ message: "Rule not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(err.issues ? 400 : 500).json({ message: err.message || String(err) });
    }
  });

  app.post("/api/clinic-billing/trips/:id/billing-outcome", authMiddleware, requirePermission("invoices", "write"), async (req: AuthRequest, res) => {
    try {
      const tripId = parseInt(req.params.id as string);
      const schema = z.object({
        billingOutcome: z.enum(["completed", "no_show", "cancelled", "company_error"]),
        billingReason: z.string().min(1),
      });
      const data = schema.parse(req.body);

      const [trip] = await db.select().from(trips).where(eq(trips.id, tripId));
      if (!trip) return res.status(404).json({ message: "Trip not found" });

      await db.insert(billingAuditLog).values({
        tripId,
        oldOutcome: trip.billingOutcome,
        newOutcome: data.billingOutcome,
        oldReason: trip.billingReason,
        newReason: data.billingReason,
        changedBy: req.user!.userId,
      });

      const [updated] = await db
        .update(trips)
        .set({
          billingOutcome: data.billingOutcome,
          billingReason: data.billingReason,
          billingSetBy: req.user!.userId,
          billingSetAt: new Date(),
          billingOverride: true,
        })
        .where(eq(trips.id, tripId))
        .returning();

      res.json(updated);
    } catch (err: any) {
      res.status(err.issues ? 400 : 500).json({ message: err.message || String(err) });
    }
  });

  app.get("/api/clinic-billing/trips-log", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
      const startDate = req.query.start_date as string;
      const endDate = req.query.end_date as string;
      const outcomeFilter = req.query.outcome as string | undefined;
      const passengerFilter = req.query.passenger_count ? parseInt(req.query.passenger_count as string) : undefined;

      if (!clinicId || !startDate || !endDate) {
        return res.status(400).json({ message: "clinic_id, start_date, end_date required" });
      }

      const conditions = [
        eq(trips.clinicId, clinicId),
        gte(trips.scheduledDate, startDate),
        lte(trips.scheduledDate, endDate),
        isNull(trips.deletedAt),
        inArray(trips.status, ["COMPLETED", "CANCELLED", "NO_SHOW"]),
      ];

      let allTrips = await db
        .select({
          trip: trips,
          patient: patients,
        })
        .from(trips)
        .innerJoin(patients, eq(trips.patientId, patients.id))
        .where(and(...conditions))
        .orderBy(trips.scheduledDate, trips.pickupTime);

      const [profile] = await db
        .select()
        .from(clinicBillingProfiles)
        .where(
          and(
            eq(clinicBillingProfiles.clinicId, clinicId),
            eq(clinicBillingProfiles.isActive, true)
          )
        );

      let rules: any[] = [];
      if (profile) {
        rules = await db.select().from(clinicBillingRules).where(eq(clinicBillingRules.profileId, profile.id));
      }

      const enriched = allTrips.map(({ trip, patient }) => {
        const billingOutcome = trip.billingOutcome || classifyBillingOutcome(trip).outcome;
        const legType = classifyLegType(trip);
        const pc = trip.passengerCount || 1;

        let cancelWin: string | null = null;
        if (billingOutcome === "cancelled" && profile) {
          cancelWin = trip.cancelWindow || classifyCancelWindow(trip, profile.cancelAdvanceHours, profile.cancelLateMinutes);
        }

        const unitRate = lookupRate(rules, billingOutcome, pc, legType, cancelWin);
        const lineTotal = unitRate;

        return {
          tripId: trip.id,
          publicId: trip.publicId,
          scheduledDate: trip.scheduledDate,
          pickupTime: trip.pickupTime,
          pickupAddress: trip.pickupAddress,
          dropoffAddress: trip.dropoffAddress,
          distanceMiles: trip.distanceMiles,
          status: trip.status,
          patientId: patient.id,
          patientName: `${patient.firstName} ${patient.lastName}`,
          passengerCount: pc,
          legType,
          billingOutcome,
          cancelWindow: cancelWin,
          unitRate: unitRate.toFixed(2),
          lineTotal: lineTotal.toFixed(2),
          parentTripId: trip.parentTripId,
          billingOverride: trip.billingOverride,
          billingReason: trip.billingReason,
        };
      });

      let filtered = enriched;
      if (outcomeFilter) {
        filtered = filtered.filter((t) => t.billingOutcome === outcomeFilter);
      }
      if (passengerFilter) {
        filtered = filtered.filter((t) => t.passengerCount === passengerFilter);
      }

      const grouped: Record<string, Record<string, any[]>> = {};
      for (const t of filtered) {
        if (!grouped[t.scheduledDate]) grouped[t.scheduledDate] = {};
        const pKey = `${t.patientId}-${t.patientName}`;
        if (!grouped[t.scheduledDate][pKey]) grouped[t.scheduledDate][pKey] = [];
        grouped[t.scheduledDate][pKey].push(t);
      }

      for (const date of Object.keys(grouped)) {
        for (const pKey of Object.keys(grouped[date])) {
          grouped[date][pKey].sort((a, b) => {
            if (a.legType === "outbound" && b.legType === "return") return -1;
            if (a.legType === "return" && b.legType === "outbound") return 1;
            return 0;
          });
        }
      }

      res.json({ trips: filtered, grouped, profileId: profile?.id || null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clinic-billing/trips/:id/audit", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const tripId = parseInt(req.params.id as string);
      const entries = await db
        .select()
        .from(billingAuditLog)
        .where(eq(billingAuditLog.tripId, tripId))
        .orderBy(desc(billingAuditLog.changedAt));
      res.json(entries);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/clinic-billing/invoices/generate", authMiddleware, requirePermission("invoices", "write"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        clinicId: z.number(),
        cityId: z.number(),
        weekStart: z.string(),
        weekEnd: z.string(),
      });
      const data = schema.parse(req.body);

      const existing = await db
        .select()
        .from(clinicBillingInvoices)
        .where(
          and(
            eq(clinicBillingInvoices.clinicId, data.clinicId),
            eq(clinicBillingInvoices.cityId, data.cityId),
            eq(clinicBillingInvoices.weekStart, data.weekStart)
          )
        );

      if (existing.length > 0 && existing[0].status === "finalized") {
        return res.status(400).json({ message: "Invoice already finalized for this week" });
      }

      const [profile] = await db
        .select()
        .from(clinicBillingProfiles)
        .where(
          and(
            eq(clinicBillingProfiles.clinicId, data.clinicId),
            eq(clinicBillingProfiles.isActive, true)
          )
        );

      if (!profile) {
        return res.status(400).json({ message: "No active billing profile for this clinic. Create one first." });
      }

      const rules = await db.select().from(clinicBillingRules).where(eq(clinicBillingRules.profileId, profile.id));

      const tripRows = await db
        .select({ trip: trips, patient: patients })
        .from(trips)
        .innerJoin(patients, eq(trips.patientId, patients.id))
        .where(
          and(
            eq(trips.clinicId, data.clinicId),
            gte(trips.scheduledDate, data.weekStart),
            lte(trips.scheduledDate, data.weekEnd),
            isNull(trips.deletedAt),
            inArray(trips.status, ["COMPLETED", "CANCELLED", "NO_SHOW"])
          )
        )
        .orderBy(trips.scheduledDate, trips.pickupTime);

      if (tripRows.length === 0) {
        return res.status(400).json({ message: "No billable trips found for this period" });
      }

      let completedTotal = 0, noShowTotal = 0, cancelledTotal = 0, companyErrorTotal = 0;
      let outboundTotal = 0, returnTotal = 0;
      const lines: any[] = [];

      for (const { trip, patient } of tripRows) {
        const outcome = trip.billingOutcome || classifyBillingOutcome(trip).outcome;
        const legType = classifyLegType(trip);
        const pc = trip.passengerCount || 1;

        let cancelWin: string | null = null;
        if (outcome === "cancelled") {
          cancelWin = trip.cancelWindow || classifyCancelWindow(trip, profile.cancelAdvanceHours, profile.cancelLateMinutes);
        }

        const unitRate = lookupRate(rules, outcome, pc, legType, cancelWin);
        const lineTotal = unitRate;

        if (!trip.billingOutcome) {
          await db.update(trips).set({
            billingOutcome: outcome,
            billingReason: classifyBillingOutcome(trip).reason,
            cancelWindow: cancelWin,
          }).where(eq(trips.id, trip.id));
        }

        lines.push({
          tripId: trip.id,
          patientId: patient.id,
          serviceDate: trip.scheduledDate,
          legType,
          outcome,
          cancelWindow: cancelWin,
          passengerCount: pc,
          unitRateSnapshot: unitRate.toFixed(2),
          lineTotal: lineTotal.toFixed(2),
          pickupAddress: trip.pickupAddress,
          dropoffAddress: trip.dropoffAddress,
          distanceMiles: trip.distanceMiles,
          tripPublicId: trip.publicId,
          pickupTime: trip.pickupTime,
        });

        switch (outcome) {
          case "completed": completedTotal += lineTotal; break;
          case "no_show": noShowTotal += lineTotal; break;
          case "cancelled": cancelledTotal += lineTotal; break;
          case "company_error": companyErrorTotal += lineTotal; break;
        }

        if (legType === "outbound") outboundTotal += lineTotal;
        else returnTotal += lineTotal;
      }

      const totalAmount = completedTotal + noShowTotal + cancelledTotal + companyErrorTotal;

      if (existing.length > 0) {
        await db.delete(clinicBillingInvoiceLines).where(eq(clinicBillingInvoiceLines.invoiceId, existing[0].id));

        const [updated] = await db
          .update(clinicBillingInvoices)
          .set({
            totalAmount: totalAmount.toFixed(2),
            completedTotal: completedTotal.toFixed(2),
            noShowTotal: noShowTotal.toFixed(2),
            cancelledTotal: cancelledTotal.toFixed(2),
            companyErrorTotal: companyErrorTotal.toFixed(2),
            outboundTotal: outboundTotal.toFixed(2),
            returnTotal: returnTotal.toFixed(2),
            status: "draft",
            updatedAt: new Date(),
          })
          .where(eq(clinicBillingInvoices.id, existing[0].id))
          .returning();

        for (const line of lines) {
          await db.insert(clinicBillingInvoiceLines).values({ ...line, invoiceId: updated.id });
        }

        res.json({ invoice: updated, lineCount: lines.length, regenerated: true });
      } else {
        const [invoice] = await db
          .insert(clinicBillingInvoices)
          .values({
            clinicId: data.clinicId,
            cityId: data.cityId,
            weekStart: data.weekStart,
            weekEnd: data.weekEnd,
            totalAmount: totalAmount.toFixed(2),
            completedTotal: completedTotal.toFixed(2),
            noShowTotal: noShowTotal.toFixed(2),
            cancelledTotal: cancelledTotal.toFixed(2),
            companyErrorTotal: companyErrorTotal.toFixed(2),
            outboundTotal: outboundTotal.toFixed(2),
            returnTotal: returnTotal.toFixed(2),
            createdBy: req.user!.userId,
          })
          .returning();

        for (const line of lines) {
          await db.insert(clinicBillingInvoiceLines).values({ ...line, invoiceId: invoice.id });
        }

        res.json({ invoice, lineCount: lines.length, regenerated: false });
      }
    } catch (err: any) {
      res.status(err.issues ? 400 : 500).json({ message: err.message || String(err) });
    }
  });

  app.get("/api/clinic-billing/invoices", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
      let invoiceRows;
      if (clinicId) {
        invoiceRows = await db.select().from(clinicBillingInvoices).where(eq(clinicBillingInvoices.clinicId, clinicId)).orderBy(desc(clinicBillingInvoices.createdAt));
      } else {
        invoiceRows = await db.select().from(clinicBillingInvoices).orderBy(desc(clinicBillingInvoices.createdAt));
      }

      const enriched = await Promise.all(invoiceRows.map(async (inv: any) => {
        const [clinic] = await db.select().from(clinics).where(eq(clinics.id, inv.clinicId));
        const [city] = await db.select().from(cities).where(eq(cities.id, inv.cityId));
        const lineCount = await db.select({ count: sql<number>`count(*)` }).from(clinicBillingInvoiceLines).where(eq(clinicBillingInvoiceLines.invoiceId, inv.id));
        return { ...inv, clinicName: clinic?.name, cityName: city?.name, lineCount: Number(lineCount[0]?.count || 0) };
      }));

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clinic-billing/invoices/:id", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const [invoice] = await db.select().from(clinicBillingInvoices).where(eq(clinicBillingInvoices.id, id));
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      const [clinic] = await db.select().from(clinics).where(eq(clinics.id, invoice.clinicId));
      const [city] = await db.select().from(cities).where(eq(cities.id, invoice.cityId));

      const lineRows = await db
        .select({ line: clinicBillingInvoiceLines, patient: patients })
        .from(clinicBillingInvoiceLines)
        .innerJoin(patients, eq(clinicBillingInvoiceLines.patientId, patients.id))
        .where(eq(clinicBillingInvoiceLines.invoiceId, id))
        .orderBy(clinicBillingInvoiceLines.serviceDate, clinicBillingInvoiceLines.pickupTime);

      const lines = lineRows.map(({ line, patient }) => ({
        ...line,
        patientName: `${patient.firstName} ${patient.lastName}`,
      }));

      const grouped: Record<string, Record<string, any[]>> = {};
      for (const line of lines) {
        if (!grouped[line.serviceDate]) grouped[line.serviceDate] = {};
        const pKey = `${line.patientId}-${line.patientName}`;
        if (!grouped[line.serviceDate][pKey]) grouped[line.serviceDate][pKey] = [];
        grouped[line.serviceDate][pKey].push(line);
      }

      for (const date of Object.keys(grouped)) {
        for (const pKey of Object.keys(grouped[date])) {
          grouped[date][pKey].sort((a, b) => {
            if (a.legType === "outbound" && b.legType === "return") return -1;
            if (a.legType === "return" && b.legType === "outbound") return 1;
            return 0;
          });
        }
      }

      const totals: Record<string, number> = {};
      for (const pc of [1, 2, 3, 4]) {
        totals[`pax_${pc}`] = lines
          .filter((l) => l.passengerCount === pc)
          .reduce((s, l) => s + parseFloat(l.lineTotal), 0);
      }
      for (const out of OUTCOMES) {
        totals[out] = lines
          .filter((l) => l.outcome === out)
          .reduce((s, l) => s + parseFloat(l.lineTotal), 0);
      }
      for (const cw of CANCEL_WINDOWS) {
        totals[`cancel_${cw}`] = lines
          .filter((l) => l.outcome === "cancelled" && l.cancelWindow === cw)
          .reduce((s, l) => s + parseFloat(l.lineTotal), 0);
      }

      res.json({
        invoice: { ...invoice, clinicName: clinic?.name, cityName: city?.name },
        lines,
        grouped,
        totals,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/clinic-billing/invoices/:id/finalize", authMiddleware, requirePermission("invoices", "write"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const [invoice] = await db.select().from(clinicBillingInvoices).where(eq(clinicBillingInvoices.id, id));
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      if (invoice.status === "finalized") return res.status(400).json({ message: "Already finalized" });

      const [updated] = await db
        .update(clinicBillingInvoices)
        .set({ status: "finalized", finalizedAt: new Date(), finalizedBy: req.user!.userId, updatedAt: new Date() })
        .where(eq(clinicBillingInvoices.id, id))
        .returning();

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/clinic-billing/invoices/:id/reopen", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const [invoice] = await db.select().from(clinicBillingInvoices).where(eq(clinicBillingInvoices.id, id));
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      if (invoice.status !== "finalized") return res.status(400).json({ message: "Only finalized invoices can be reopened" });

      const [updated] = await db
        .update(clinicBillingInvoices)
        .set({ status: "draft", finalizedAt: null, finalizedBy: null, updatedAt: new Date() })
        .where(eq(clinicBillingInvoices.id, id))
        .returning();

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clinic-billing/invoices/:id/csv", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const [invoice] = await db.select().from(clinicBillingInvoices).where(eq(clinicBillingInvoices.id, id));
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      const [clinic] = await db.select().from(clinics).where(eq(clinics.id, invoice.clinicId));

      const lineRows = await db
        .select({ line: clinicBillingInvoiceLines, patient: patients })
        .from(clinicBillingInvoiceLines)
        .innerJoin(patients, eq(clinicBillingInvoiceLines.patientId, patients.id))
        .where(eq(clinicBillingInvoiceLines.invoiceId, id))
        .orderBy(clinicBillingInvoiceLines.serviceDate, clinicBillingInvoiceLines.pickupTime);

      const header = "Date,Patient,Leg,Outcome,Cancel Window,Passengers,Pickup,Dropoff,Miles,Rate,Total\n";
      const rows = lineRows.map(({ line, patient }) => {
        return [
          line.serviceDate,
          `"${patient.firstName} ${patient.lastName}"`,
          line.legType,
          line.outcome,
          line.cancelWindow || "",
          line.passengerCount,
          `"${line.pickupAddress || ""}"`,
          `"${line.dropoffAddress || ""}"`,
          line.distanceMiles || "",
          line.unitRateSnapshot,
          line.lineTotal,
        ].join(",");
      });

      const csv = header + rows.join("\n") + `\n\nTotal,,,,,,,,,,$${parseFloat(invoice.totalAmount).toFixed(2)}`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="clinic-billing-${clinic?.name || id}-${invoice.weekStart}.csv"`);
      res.setHeader("Cache-Control", "no-store");
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/tariffs", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
      if (!clinicId) return res.status(400).json({ message: "clinic_id required" });
      const tariffs = await storage.getClinicTariffs(clinicId);
      res.json(tariffs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tariffs", authMiddleware, requirePermission("invoices", "write"), async (req: AuthRequest, res) => {
    try {
      const parsed = insertClinicTariffSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
      const tariff = await storage.createClinicTariff(parsed.data);
      res.json(tariff);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const updateTariffSchema = z.object({
    baseFee: z.string().optional(),
    perMileRate: z.string().optional(),
    waitTimePerMinute: z.string().optional(),
    wheelchairExtra: z.string().optional(),
    effectiveFrom: z.string().optional(),
    effectiveTo: z.string().nullable().optional(),
  });

  app.patch("/api/tariffs/:id", authMiddleware, requirePermission("invoices", "write"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const parsed = updateTariffSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid tariff data", errors: parsed.error.flatten() });
      }
      const updateData: Record<string, any> = {};
      if (parsed.data.baseFee !== undefined) updateData.baseFeeCents = Math.round(parseFloat(parsed.data.baseFee) * 100);
      if (parsed.data.perMileRate !== undefined) updateData.perMileCents = Math.round(parseFloat(parsed.data.perMileRate) * 100);
      if (parsed.data.waitTimePerMinute !== undefined) updateData.waitMinuteCents = Math.round(parseFloat(parsed.data.waitTimePerMinute) * 100);
      if (parsed.data.wheelchairExtra !== undefined) updateData.wheelchairExtraCents = Math.round(parseFloat(parsed.data.wheelchairExtra) * 100);
      if (parsed.data.effectiveFrom !== undefined) updateData.effectiveFrom = new Date(parsed.data.effectiveFrom);
      const updated = await storage.updateClinicTariff(id, updateData);
      if (!updated) return res.status(404).json({ message: "Tariff not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/trip-billing/:tripId", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const tripId = parseInt(String(req.params.tripId));
      const billing = await storage.getTripBilling(tripId);
      if (!billing) return res.status(404).json({ message: "No billing record for this trip" });
      res.json(billing);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/trip-billing/clinic/:clinicId", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(String(req.params.clinicId));
      const month = req.query.month as string | undefined;
      const billings = await storage.getTripBillingsByClinic(clinicId, month);
      res.json(billings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/monthly-invoices", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
      const invoicesResult = await storage.getClinicInvoicesMonthly(clinicId);
      const enriched = await Promise.all(invoicesResult.map(async (inv: any) => {
        const clinic = await storage.getClinic(inv.clinicId);
        return { ...inv, clinicName: clinic?.name };
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/monthly-invoices/:id", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const invoice = await storage.getClinicInvoiceMonthly(id);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });
      const items = await storage.getClinicInvoiceItems(id);
      const clinic = await storage.getClinic(invoice.clinicId);
      res.json({ invoice: { ...invoice, clinicName: clinic?.name }, items });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/monthly-invoices/generate", authMiddleware, requirePermission("invoices", "write"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        clinicId: z.number(),
        periodMonth: z.string().regex(/^\d{4}-\d{2}$/),
      });
      const data = schema.parse(req.body);

      const billings = await storage.getTripBillingsByClinic(data.clinicId, data.periodMonth);
      const pendingBillings = billings.filter(b => b.status === "pending");
      if (pendingBillings.length === 0) {
        return res.status(400).json({ message: "No pending trip billings found for this period" });
      }

      const subtotalCents = pendingBillings.reduce((sum, b) => sum + b.totalCents, 0);

      const invoice = await storage.createClinicInvoiceMonthly({
        clinicId: data.clinicId,
        cityId: pendingBillings[0].cityId,
        periodMonth: data.periodMonth,
        subtotalCents,
        adjustmentsCents: 0,
        totalCents: subtotalCents,
        status: "draft",
      });

      for (const billing of pendingBillings) {
        await storage.createClinicInvoiceItem({
          invoiceId: invoice.id,
          tripId: billing.tripId,
          amountCents: billing.totalCents,
          lineJson: JSON.stringify(billing),
        });
      }

      for (const billing of pendingBillings) {
        await db.update(tripBilling).set({ status: "invoiced" }).where(eq(tripBilling.id, billing.id));
      }

      res.json({ invoice, itemCount: pendingBillings.length });
    } catch (err: any) {
      res.status(err.issues ? 400 : 500).json({ message: err.message || String(err) });
    }
  });

  app.patch("/api/monthly-invoices/:id/status", authMiddleware, requirePermission("invoices", "write"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const { status } = req.body;
      if (!["draft", "sent", "paid"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      const updateData: any = { status };
      if (status === "sent") updateData.sentAt = new Date();
      if (status === "paid") updateData.paidAt = new Date();
      const updated = await storage.updateClinicInvoiceMonthly(id, updateData);
      if (!updated) return res.status(404).json({ message: "Invoice not found" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  async function checkClinicAccess(req: AuthRequest, clinicId: number): Promise<{ allowed: boolean; reason?: string }> {
    const user = await storage.getUser(req.user!.userId);
    if (!user) return { allowed: false, reason: "User not found" };
    const role = user.role;
    if (role === "SUPER_ADMIN" || role === "ADMIN" || role === "DISPATCH") {
      return { allowed: true };
    }
    if (role === "COMPANY_ADMIN") {
      if (!user.companyId) return { allowed: false, reason: "Access denied" };
      const clinic = await storage.getClinic(clinicId);
      if (!clinic || clinic.companyId !== user.companyId) return { allowed: false, reason: "Access denied" };
      return { allowed: true };
    }
    if (role === "CLINIC_USER") {
      if (user.clinicId !== clinicId) return { allowed: false, reason: "Access denied" };
      return { allowed: true };
    }
    return { allowed: false, reason: "Access denied" };
  }

  app.get("/api/clinics/:clinicId/billing-settings", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(String(req.params.clinicId));
      if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });
      const access = await checkClinicAccess(req, clinicId);
      if (!access.allowed) return res.status(403).json({ message: access.reason });
      const settings = await storage.getClinicBillingSettings(clinicId);
      res.json(settings || {
        clinicId,
        billingCycle: "weekly",
        anchorDow: 1,
        anchorDom: 1,
        biweeklyMode: "1_15",
        anchorDate: null,
        timezone: "America/Los_Angeles",
        autoGenerate: false,
        graceDays: 0,
        lateFeePct: "0",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/clinics/:clinicId/billing-settings", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(String(req.params.clinicId));
      if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });
      const access = await checkClinicAccess(req, clinicId);
      if (!access.allowed) return res.status(403).json({ message: access.reason });

      const { billingCycle, anchorDow, anchorDom, biweeklyMode, anchorDate, timezone, autoGenerate, graceDays, lateFeePct } = req.body;
      if (billingCycle && !["weekly", "biweekly", "monthly"].includes(billingCycle)) {
        return res.status(400).json({ message: "Invalid billing cycle" });
      }
      if (anchorDow !== undefined && anchorDow !== null && (anchorDow < 1 || anchorDow > 7)) {
        return res.status(400).json({ message: "anchorDow must be 1-7" });
      }
      if (anchorDom !== undefined && anchorDom !== null && (anchorDom < 1 || anchorDom > 28)) {
        return res.status(400).json({ message: "anchorDom must be 1-28" });
      }

      const result = await storage.upsertClinicBillingSettings({
        clinicId,
        billingCycle: billingCycle || "weekly",
        anchorDow: anchorDow ?? null,
        anchorDom: anchorDom ?? null,
        biweeklyMode: biweeklyMode || "1_15",
        anchorDate: anchorDate || null,
        timezone: timezone || "America/Los_Angeles",
        autoGenerate: autoGenerate ?? false,
        graceDays: graceDays ?? 0,
        lateFeePct: String(lateFeePct ?? "0"),
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/clinics/:clinicId/cycle-invoices/preview", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(String(req.params.clinicId));
      if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });
      const access = await checkClinicAccess(req, clinicId);
      if (!access.allowed) return res.status(403).json({ message: access.reason });

      let periodStart: string;
      let periodEnd: string;
      const { periodStart: ps, periodEnd: pe, asOf } = req.body;

      if (ps && pe) {
        periodStart = ps;
        periodEnd = pe;
      } else {
        const settings = await storage.getClinicBillingSettings(clinicId);
        const defaultSettings = settings || {
          clinicId,
          billingCycle: "weekly" as const,
          anchorDow: 1,
          anchorDom: 1,
          biweeklyMode: "1_15" as const,
          anchorDate: null,
          timezone: "America/Los_Angeles",
          autoGenerate: false,
          graceDays: 0,
          lateFeePct: "0",
          updatedAt: new Date(),
          createdAt: new Date(),
        };
        const window = computeBillingWindow(defaultSettings, asOf ? new Date(asOf) : undefined);
        periodStart = window.periodStart;
        periodEnd = window.periodEnd;
      }

      const eligibleTrips = await storage.getEligibleTripsForBilling(clinicId, periodStart, periodEnd);
      const warnings: string[] = [];

      const tripItems = await Promise.all(eligibleTrips.map(async (trip) => {
        let amountCents = trip.priceTotalCents || 0;
        const requiresReview = amountCents === 0;
        if (requiresReview) {
          const billing = await storage.getTripBilling(trip.id);
          if (billing) {
            amountCents = billing.totalCents;
          } else {
            warnings.push(`Trip ${trip.publicId} has no price. Requires review.`);
          }
        }
        const patient = await storage.getPatient(trip.patientId);
        return {
          tripId: trip.id,
          tripPublicId: trip.publicId,
          date: trip.scheduledDate,
          riderName: patient ? `${patient.firstName} ${patient.lastName}` : null,
          pickup: trip.pickupAddress,
          dropoff: trip.dropoffAddress,
          amountCents,
          status: trip.status,
          requiresReview,
        };
      }));

      const subtotalCents = tripItems.reduce((sum, t) => sum + t.amountCents, 0);

      res.json({
        clinicId,
        periodStart,
        periodEnd,
        eligibleTrips: tripItems,
        subtotalCents,
        feesCents: 0,
        totalCents: subtotalCents,
        warnings,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/clinics/:clinicId/cycle-invoices", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(String(req.params.clinicId));
      if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });
      const access = await checkClinicAccess(req, clinicId);
      if (!access.allowed) return res.status(403).json({ message: access.reason });

      let periodStart: string;
      let periodEnd: string;
      const { periodStart: ps, periodEnd: pe, asOf, notes } = req.body;

      if (ps && pe) {
        periodStart = ps;
        periodEnd = pe;
      } else {
        const settings = await storage.getClinicBillingSettings(clinicId);
        const defaultSettings = settings || {
          clinicId,
          billingCycle: "weekly" as const,
          anchorDow: 1,
          anchorDom: 1,
          biweeklyMode: "1_15" as const,
          anchorDate: null,
          timezone: "America/Los_Angeles",
          autoGenerate: false,
          graceDays: 0,
          lateFeePct: "0",
          updatedAt: new Date(),
          createdAt: new Date(),
        };
        const window = computeBillingWindow(defaultSettings, asOf ? new Date(asOf) : undefined);
        periodStart = window.periodStart;
        periodEnd = window.periodEnd;
      }

      const existing = await storage.findBillingCycleInvoice(clinicId, periodStart, periodEnd);
      if (existing) {
        const items = await storage.getBillingCycleInvoiceItems(existing.id);
        return res.json({ invoice: existing, items, existing: true });
      }

      const eligibleTrips = await storage.getEligibleTripsForBilling(clinicId, periodStart, periodEnd);

      let subtotalCents = 0;
      const items: any[] = [];
      for (const trip of eligibleTrips) {
        let amountCents = trip.priceTotalCents || 0;
        if (amountCents === 0) {
          const billing = await storage.getTripBilling(trip.id);
          if (billing) amountCents = billing.totalCents;
        }
        const patient = await storage.getPatient(trip.patientId);
        const riderName = patient ? `${patient.firstName} ${patient.lastName}` : "Unknown";
        items.push({
          tripId: trip.id,
          description: `Trip ${trip.publicId} - ${riderName} - ${trip.scheduledDate}`,
          amountCents,
          metadata: { tripPublicId: trip.publicId, riderName, date: trip.scheduledDate, requiresReview: amountCents === 0 },
        });
        subtotalCents += amountCents;
      }

      const invoice = await storage.createBillingCycleInvoice({
        clinicId,
        periodStart,
        periodEnd,
        status: "draft",
        currency: "USD",
        subtotalCents,
        taxCents: 0,
        feesCents: 0,
        totalCents: subtotalCents,
        notes: notes || null,
        createdBy: req.user!.userId,
      });

      const createdItems = [];
      for (const item of items) {
        const created = await storage.createBillingCycleInvoiceItem({
          invoiceId: invoice.id,
          tripId: item.tripId,
          description: item.description,
          amountCents: item.amountCents,
          metadata: item.metadata,
        });
        createdItems.push(created);
      }

      res.json({ invoice, items: createdItems });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  async function updateInvoicePaymentStatus(invoiceId: number) {
    const invoice = await storage.getBillingCycleInvoice(invoiceId);
    if (!invoice || invoice.status !== "finalized") return;

    const payments = await storage.getInvoicePayments(invoiceId);
    const sumPaid = payments.reduce((sum, p) => sum + p.amountCents, 0);
    const balanceDue = Math.max(invoice.totalCents - sumPaid, 0);

    let paymentStatus: "unpaid" | "partial" | "paid" | "overdue" = "unpaid";
    if (balanceDue === 0 && sumPaid > 0) {
      paymentStatus = "paid";
    } else if (sumPaid > 0) {
      paymentStatus = "partial";
    }

    if (paymentStatus !== "paid" && invoice.dueDate && new Date() > new Date(invoice.dueDate)) {
      paymentStatus = "overdue";
    }

    const lastPaymentAt = payments.length > 0 ? payments[0].paidAt : null;

    await storage.updateBillingCycleInvoice(invoiceId, {
      amountPaidCents: sumPaid,
      balanceDueCents: balanceDue,
      paymentStatus,
      lastPaymentAt,
      updatedAt: new Date(),
    } as any);
  }

  app.post("/api/cycle-invoices/:invoiceId/finalize", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(String(req.params.invoiceId));
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getBillingCycleInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      const access = await checkClinicAccess(req, invoice.clinicId);
      if (!access.allowed) return res.status(403).json({ message: access.reason });

      if (invoice.status === "void") return res.status(400).json({ message: "Cannot finalize a voided invoice" });
      if (invoice.status === "finalized") return res.json(invoice);

      const items = await storage.getBillingCycleInvoiceItems(invoiceId);
      const recalcSubtotal = items.reduce((sum, item) => sum + item.amountCents, 0);
      const totalCents = recalcSubtotal + (invoice.feesCents || 0) + (invoice.taxCents || 0);

      const invoiceNumber = await storage.nextInvoiceNumber();

      const settings = await storage.getClinicBillingSettings(invoice.clinicId);
      const graceDays = settings?.graceDays || 0;
      const periodEndDate = new Date(invoice.periodEnd);
      const dueDate = new Date(periodEndDate.getTime() + graceDays * 24 * 60 * 60 * 1000);

      const updated = await storage.updateBillingCycleInvoice(invoiceId, {
        status: "finalized",
        finalizedAt: new Date(),
        subtotalCents: recalcSubtotal,
        totalCents,
        invoiceNumber,
        paymentStatus: "unpaid",
        amountPaidCents: 0,
        balanceDueCents: totalCents,
        dueDate,
        updatedAt: new Date(),
      } as any);

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/cycle-invoices/:invoiceId", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(String(req.params.invoiceId));
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getBillingCycleInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      const access = await checkClinicAccess(req, invoice.clinicId);
      if (!access.allowed) return res.status(403).json({ message: access.reason });

      const items = await storage.getBillingCycleInvoiceItems(invoiceId);
      res.json({ invoice, items });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/clinics/:clinicId/cycle-invoices", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const clinicId = parseInt(String(req.params.clinicId));
      if (isNaN(clinicId)) return res.status(400).json({ message: "Invalid clinic ID" });

      const access = await checkClinicAccess(req, clinicId);
      if (!access.allowed) return res.status(403).json({ message: access.reason });

      const { status, from, to } = req.query;
      const invoices = await storage.getBillingCycleInvoices(
        clinicId,
        status as string | undefined,
        from as string | undefined,
        to as string | undefined
      );
      res.json(invoices);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/cycle-invoices/:invoiceId/void", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(String(req.params.invoiceId));
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getBillingCycleInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      const access = await checkClinicAccess(req, invoice.clinicId);
      if (!access.allowed) return res.status(403).json({ message: access.reason });

      const updated = await storage.updateBillingCycleInvoice(invoiceId, { status: "void" });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/cycle-invoices/:invoiceId/create-checkout", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(String(req.params.invoiceId));
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getBillingCycleInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      const access = await checkClinicAccess(req, invoice.clinicId);
      if (!access.allowed) return res.status(403).json({ message: access.reason });

      if (invoice.status !== "finalized") return res.status(400).json({ message: "Invoice must be finalized" });
      if ((invoice.balanceDueCents || 0) <= 0) return res.status(400).json({ message: "No balance due" });

      if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ message: "Stripe not configured" });

      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      const clinic = await storage.getClinic(invoice.clinicId);
      const APP_URL = process.env.APP_PUBLIC_URL || process.env.PUBLIC_BASE_URL || "https://app.unitedcaremobility.com";

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: `Invoice ${invoice.invoiceNumber || `#${invoice.id}`}`,
              description: `${clinic?.name || "Clinic"} - Period ${invoice.periodStart} to ${invoice.periodEnd}`,
            },
            unit_amount: invoice.balanceDueCents || invoice.totalCents,
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: `${APP_URL}/billing?paid=1&invoice=${invoiceId}`,
        cancel_url: `${APP_URL}/billing?canceled=1&invoice=${invoiceId}`,
        metadata: {
          invoice_id: String(invoiceId),
          clinic_id: String(invoice.clinicId),
          company_id: String(clinic?.companyId || ""),
          invoice_number: invoice.invoiceNumber || "",
          type: "cycle_invoice",
        },
      });

      await storage.updateBillingCycleInvoice(invoiceId, {
        stripeCheckoutSessionId: session.id,
        stripeCheckoutUrl: session.url,
        updatedAt: new Date(),
      } as any);

      res.json({ url: session.url, sessionId: session.id });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/cycle-invoices/:invoiceId/register-manual-payment", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(String(req.params.invoiceId));
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getBillingCycleInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      const access = await checkClinicAccess(req, invoice.clinicId);
      if (!access.allowed) return res.status(403).json({ message: access.reason });

      if (invoice.status !== "finalized") return res.status(400).json({ message: "Invoice must be finalized" });

      const { amountCents, reference } = req.body;
      if (!amountCents || amountCents <= 0) return res.status(400).json({ message: "Invalid amount" });

      const payment = await storage.createInvoicePayment({
        invoiceId,
        amountCents,
        method: "manual",
        reference: reference || null,
        paidAt: new Date(),
      });

      await updateInvoicePaymentStatus(invoiceId);
      const updated = await storage.getBillingCycleInvoice(invoiceId);

      res.json({ payment, invoice: updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/cycle-invoices/:invoiceId/payments", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(String(req.params.invoiceId));
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getBillingCycleInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      const access = await checkClinicAccess(req, invoice.clinicId);
      if (!access.allowed) return res.status(403).json({ message: access.reason });

      const payments = await storage.getInvoicePayments(invoiceId);
      res.json(payments);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/cycle-invoices/:invoiceId/pdf", authMiddleware, async (req: AuthRequest, res) => {
    try {
      const invoiceId = parseInt(String(req.params.invoiceId));
      if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

      const invoice = await storage.getBillingCycleInvoice(invoiceId);
      if (!invoice) return res.status(404).json({ message: "Invoice not found" });

      const access = await checkClinicAccess(req, invoice.clinicId);
      if (!access.allowed) return res.status(403).json({ message: access.reason });

      if (invoice.status === "draft") return res.status(400).json({ message: "Cannot generate PDF for draft invoices" });

      const items = await storage.getBillingCycleInvoiceItems(invoiceId);
      const clinic = await storage.getClinic(invoice.clinicId);
      const payments = await storage.getInvoicePayments(invoiceId);

      const { generateInvoicePdf } = await import("./invoicePdfGenerator");
      await generateInvoicePdf({ invoice, items, clinic, payments }, res);
    } catch (err: any) {
      console.error("[InvoicePDF] Error:", err.message);
      if (!res.headersSent) res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reports/aging", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const asOfStr = req.query.asOf as string | undefined;
      const asOf = asOfStr ? new Date(asOfStr) : new Date();
      const clinicIdFilter = req.query.clinicId ? parseInt(req.query.clinicId as string) : undefined;

      const user = await storage.getUser(req.user!.userId);
      let companyFilter: number | undefined;
      if (user?.role === "COMPANY_ADMIN" && user.companyId) {
        companyFilter = user.companyId;
      }

      const invoices = await storage.getBillingCycleInvoicesByPaymentStatus(["unpaid", "partial", "overdue"], clinicIdFilter);

      const clinicBuckets: Record<number, { clinicId: number; clinicName: string; current: number; days1_30: number; days31_60: number; days61_90: number; days90plus: number; total: number }> = {};

      for (const inv of invoices) {
        if (!inv.dueDate) continue;
        if (companyFilter) {
          const clinic = await storage.getClinic(inv.clinicId);
          if (!clinic || clinic.companyId !== companyFilter) continue;
        }

        const dueDate = new Date(inv.dueDate);
        const daysDiff = Math.floor((asOf.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
        const balance = inv.balanceDueCents || 0;

        if (!clinicBuckets[inv.clinicId]) {
          const clinic = await storage.getClinic(inv.clinicId);
          clinicBuckets[inv.clinicId] = {
            clinicId: inv.clinicId,
            clinicName: clinic?.name || `Clinic ${inv.clinicId}`,
            current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days90plus: 0, total: 0,
          };
        }

        const bucket = clinicBuckets[inv.clinicId];
        if (daysDiff <= 0) bucket.current += balance;
        else if (daysDiff <= 30) bucket.days1_30 += balance;
        else if (daysDiff <= 60) bucket.days31_60 += balance;
        else if (daysDiff <= 90) bucket.days61_90 += balance;
        else bucket.days90plus += balance;
        bucket.total += balance;
      }

      res.json({
        asOf: asOf.toISOString(),
        buckets: Object.values(clinicBuckets),
        summary: {
          current: Object.values(clinicBuckets).reduce((s, b) => s + b.current, 0),
          days1_30: Object.values(clinicBuckets).reduce((s, b) => s + b.days1_30, 0),
          days31_60: Object.values(clinicBuckets).reduce((s, b) => s + b.days31_60, 0),
          days61_90: Object.values(clinicBuckets).reduce((s, b) => s + b.days61_90, 0),
          days90plus: Object.values(clinicBuckets).reduce((s, b) => s + b.days90plus, 0),
          total: Object.values(clinicBuckets).reduce((s, b) => s + b.total, 0),
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/ops/recompute-overdue", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), async (_req: AuthRequest, res) => {
    try {
      const invoices = await storage.getBillingCycleInvoicesByPaymentStatus(["unpaid", "partial"]);
      let updated = 0;
      const now = new Date();

      for (const inv of invoices) {
        if (inv.dueDate && now > new Date(inv.dueDate)) {
          await storage.updateBillingCycleInvoice(inv.id, {
            paymentStatus: "overdue",
            updatedAt: now,
          } as any);
          updated++;
        }
      }

      res.json({ message: `Recomputed overdue status for ${updated} invoices`, updated });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/stripe/cycle-invoice-webhook", async (req, res) => {
    try {
      if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
        return res.status(500).json({ message: "Stripe not configured" });
      }

      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      const sig = req.headers["stripe-signature"];
      if (!sig) return res.status(400).json({ message: "Missing signature" });

      let event;
      try {
        event = stripe.webhooks.constructEvent(
          (req as any).rawBody || Buffer.from(JSON.stringify(req.body)),
          sig as string,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } catch (err: any) {
        console.error("[StripeWebhook] Signature verification failed:", err.message);
        return res.status(400).json({ message: "Invalid signature" });
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as any;
        const metadata = session.metadata || {};

        if (metadata.type !== "cycle_invoice") {
          return res.json({ received: true, skipped: "not cycle_invoice" });
        }

        const invoiceId = parseInt(metadata.invoice_id);
        if (isNaN(invoiceId)) return res.json({ received: true, skipped: "no invoice_id" });

        const existingByRef = await storage.findPaymentByReference(session.id);
        if (existingByRef) return res.json({ received: true, skipped: "duplicate" });

        if (session.payment_intent) {
          const existingByPI = await storage.findPaymentByStripePI(session.payment_intent);
          if (existingByPI) return res.json({ received: true, skipped: "duplicate_pi" });
        }

        const amountCents = session.amount_total || 0;

        const paymentMethodTypes: string[] = session.payment_method_types || [];
        const isAch = paymentMethodTypes.includes("us_bank_account");

        await storage.createInvoicePayment({
          invoiceId,
          amountCents,
          method: isAch ? "ach" : "stripe",
          reference: session.id,
          stripePaymentIntentId: session.payment_intent || null,
          paidAt: new Date(),
        });

        await storage.updateBillingCycleInvoice(invoiceId, {
          stripePaymentIntentId: session.payment_intent || null,
          updatedAt: new Date(),
        } as any);

        await updateInvoicePaymentStatus(invoiceId);

        console.log(`[StripeWebhook] Payment recorded for invoice ${invoiceId}: ${amountCents} cents`);
      }

      res.json({ received: true });
    } catch (err: any) {
      console.error("[StripeWebhook] Error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });
}

export async function computeTripBilling(tripId: number): Promise<void> {
  const trip = await storage.getTrip(tripId);
  if (!trip || !trip.clinicId) return;

  const existing = await storage.getTripBilling(tripId);
  if (existing) return;

  const tariff = await storage.getActiveTariff(trip.clinicId, trip.cityId);
  if (!tariff) {
    console.log(`[TARIFF-BILLING] No active tariff for clinic ${trip.clinicId}, skipping trip ${tripId}`);
    return;
  }

  const distanceMiles = trip.distanceMiles ? parseFloat(trip.distanceMiles) : 0;
  const waitMinutes = 0;
  const mobilityReq = trip.mobilityRequirement || "STANDARD";

  const baseFeeCents = tariff.baseFeeCents;
  const mileageCents = Math.round(tariff.perMileCents * distanceMiles);
  const waitCents = tariff.waitMinuteCents * waitMinutes;
  const wheelchairCents = mobilityReq === "WHEELCHAIR" ? tariff.wheelchairExtraCents : 0;
  const totalCents = baseFeeCents + mileageCents + waitCents + wheelchairCents;

  await storage.createTripBilling({
    tripId,
    clinicId: trip.clinicId,
    cityId: trip.cityId,
    mobilityRequirement: mobilityReq,
    distanceMiles: distanceMiles.toFixed(2),
    waitMinutes,
    baseFeeCents,
    mileageCents,
    waitCents,
    wheelchairCents,
    totalCents,
    status: "pending",
  });

  console.log(`[TARIFF-BILLING] Trip ${tripId} billed: base=$${(baseFeeCents / 100).toFixed(2)} + mileage=$${(mileageCents / 100).toFixed(2)} + wait=$${(waitCents / 100).toFixed(2)} + wheelchair=$${(wheelchairCents / 100).toFixed(2)} = $${(totalCents / 100).toFixed(2)}`);
}
