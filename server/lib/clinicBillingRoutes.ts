import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { db } from "../db";
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
} from "@shared/schema";
import { eq, and, sql, gte, lte, isNull, inArray, desc } from "drizzle-orm";
import { z } from "zod";

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

export function registerClinicBillingRoutes(app: Express) {

  app.get("/api/clinic-billing/profiles", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.post("/api/clinic-billing/profiles", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.get("/api/clinic-billing/profiles/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.patch("/api/clinic-billing/profiles/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.patch("/api/clinic-billing/rules/batch", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.patch("/api/clinic-billing/rules/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.post("/api/clinic-billing/trips/:id/billing-outcome", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.get("/api/clinic-billing/trips-log", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.get("/api/clinic-billing/trips/:id/audit", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.post("/api/clinic-billing/invoices/generate", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.get("/api/clinic-billing/invoices", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.get("/api/clinic-billing/invoices/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

  app.post("/api/clinic-billing/invoices/:id/finalize", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN"), async (req: AuthRequest, res) => {
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

  app.get("/api/clinic-billing/invoices/:id/csv", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
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

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="clinic-billing-${clinic?.name || id}-${invoice.weekStart}.csv"`);
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
