import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import type { Response } from "express";
import { db } from "../db";
import { recurringCancellationPolicies } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  cancelSingleOccurrence,
  cancelFutureOccurrences,
  cancelEntireSeries,
  holdSchedule,
  resumeSchedule,
  checkCancellationPolicy,
  autoSuspendCheck,
  getCancellationHistory,
} from "../lib/smartCancellationEngine";

export function registerSmartCancelRoutes(app: Express) {
  // Cancel a single occurrence
  app.post(
    "/api/recurring/cancel-single/:tripId",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
    async (req: AuthRequest, res: Response) => {
      try {
        const tripId = parseInt(req.params.tripId as string);
        const { reason } = req.body;
        if (!tripId || isNaN(tripId)) {
          return res.status(400).json({ message: "Valid tripId required" });
        }

        const policyCheck = await checkCancellationPolicy(
          req.body.patientId,
          req.user!.companyId!
        ).catch(() => null);

        if (policyCheck && !policyCheck.allowed) {
          return res.status(429).json({
            message: "Cancellation limit reached for this patient",
            ...policyCheck,
          });
        }

        const result = await cancelSingleOccurrence(tripId, reason || "Cancelled by dispatch", req.user!.userId);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // Cancel future occurrences from a trip onward
  app.post(
    "/api/recurring/cancel-future/:tripId",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
    async (req: AuthRequest, res: Response) => {
      try {
        const tripId = parseInt(req.params.tripId as string);
        const { reason } = req.body;
        if (!tripId || isNaN(tripId)) {
          return res.status(400).json({ message: "Valid tripId required" });
        }
        const result = await cancelFutureOccurrences(tripId, reason || "Future occurrences cancelled", req.user!.userId);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // Cancel entire series
  app.post(
    "/api/recurring/cancel-series/:seriesId",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
    async (req: AuthRequest, res: Response) => {
      try {
        const seriesId = parseInt(req.params.seriesId as string);
        const { reason } = req.body;
        if (!seriesId || isNaN(seriesId)) {
          return res.status(400).json({ message: "Valid seriesId required" });
        }
        const result = await cancelEntireSeries(seriesId, reason || "Entire series cancelled", req.user!.userId);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // Create a hold on a recurring schedule
  app.post(
    "/api/recurring/hold",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
    async (req: AuthRequest, res: Response) => {
      try {
        const { scheduleId, startDate, endDate, reason } = req.body;
        if (!scheduleId || !startDate || !endDate) {
          return res.status(400).json({ message: "scheduleId, startDate, endDate required" });
        }
        if (startDate > endDate) {
          return res.status(400).json({ message: "startDate must be before endDate" });
        }
        const result = await holdSchedule(scheduleId, startDate, endDate, reason || "", req.user!.userId);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // Resume from hold
  app.post(
    "/api/recurring/hold/:id/resume",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
    async (req: AuthRequest, res: Response) => {
      try {
        const holdId = parseInt(req.params.id as string);
        if (!holdId || isNaN(holdId)) {
          return res.status(400).json({ message: "Valid hold id required" });
        }
        const result = await resumeSchedule(holdId, req.user!.userId);
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // Get cancellation policy for company
  app.get(
    "/api/recurring/cancellation-policy",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = req.user!.companyId;
        if (!companyId) return res.status(400).json({ message: "No company context" });

        const [policy] = await db
          .select()
          .from(recurringCancellationPolicies)
          .where(eq(recurringCancellationPolicies.companyId, companyId))
          .limit(1);

        res.json({
          ok: true,
          policy: policy || {
            maxCancellationsPerWeek: 2,
            maxCancellationsPerMonth: 6,
            autoRebookEnabled: false,
            rebookDaysAhead: 7,
            cancellationWindowHours: 24,
            noShowAutoSuspendCount: 3,
            noShowAutoSuspendDays: 7,
          },
        });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // Update cancellation policy
  app.put(
    "/api/recurring/cancellation-policy",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = req.user!.companyId;
        if (!companyId) return res.status(400).json({ message: "No company context" });

        const {
          maxCancellationsPerWeek,
          maxCancellationsPerMonth,
          autoRebookEnabled,
          rebookDaysAhead,
          cancellationWindowHours,
          noShowAutoSuspendCount,
          noShowAutoSuspendDays,
        } = req.body;

        const [existing] = await db
          .select()
          .from(recurringCancellationPolicies)
          .where(eq(recurringCancellationPolicies.companyId, companyId))
          .limit(1);

        if (existing) {
          const [updated] = await db
            .update(recurringCancellationPolicies)
            .set({
              maxCancellationsPerWeek: maxCancellationsPerWeek ?? existing.maxCancellationsPerWeek,
              maxCancellationsPerMonth: maxCancellationsPerMonth ?? existing.maxCancellationsPerMonth,
              autoRebookEnabled: autoRebookEnabled ?? existing.autoRebookEnabled,
              rebookDaysAhead: rebookDaysAhead ?? existing.rebookDaysAhead,
              cancellationWindowHours: cancellationWindowHours ?? existing.cancellationWindowHours,
              noShowAutoSuspendCount: noShowAutoSuspendCount ?? existing.noShowAutoSuspendCount,
              noShowAutoSuspendDays: noShowAutoSuspendDays ?? existing.noShowAutoSuspendDays,
              updatedAt: new Date(),
            })
            .where(eq(recurringCancellationPolicies.id, existing.id))
            .returning();
          res.json({ ok: true, policy: updated });
        } else {
          const [created] = await db
            .insert(recurringCancellationPolicies)
            .values({
              companyId,
              maxCancellationsPerWeek: maxCancellationsPerWeek ?? 2,
              maxCancellationsPerMonth: maxCancellationsPerMonth ?? 6,
              autoRebookEnabled: autoRebookEnabled ?? false,
              rebookDaysAhead: rebookDaysAhead ?? 7,
              cancellationWindowHours: cancellationWindowHours ?? 24,
              noShowAutoSuspendCount: noShowAutoSuspendCount ?? 3,
              noShowAutoSuspendDays: noShowAutoSuspendDays ?? 7,
            })
            .returning();
          res.json({ ok: true, policy: created });
        }
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  // Get cancellation history for a patient
  app.get(
    "/api/recurring/cancellation-history/:patientId",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
    async (req: AuthRequest, res: Response) => {
      try {
        const patientId = parseInt(req.params.patientId as string);
        if (!patientId || isNaN(patientId)) {
          return res.status(400).json({ message: "Valid patientId required" });
        }
        const history = await getCancellationHistory(patientId);
        res.json({ ok: true, ...history });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );
}
