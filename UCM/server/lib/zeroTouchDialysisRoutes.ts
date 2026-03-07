import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import {
  getDialysisTripsSummary,
  pauseDialysisAutomation,
  resumeDialysisAutomation,
  runDialysisPreAssign,
  runDialysisRecheck,
} from "./zeroTouchDialysisEngine";
import { db } from "../db";
import { companies, automationEvents } from "@shared/schema";
import { eq, and, desc, isNull } from "drizzle-orm";

export function registerZeroTouchDialysisRoutes(app: Express) {
  app.get(
    "/api/dialysis/today",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const { companyId, date } = req.query;
        const summary = await getDialysisTripsSummary({
          companyId: companyId ? parseInt(companyId as string) : undefined,
          date: date as string | undefined,
        });
        res.json(summary);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/dialysis/companies",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN"),
    async (_req: AuthRequest, res) => {
      try {
        const rows = await db.select({
          id: companies.id,
          name: companies.name,
          zeroTouchDialysisEnabled: companies.zeroTouchDialysisEnabled,
        }).from(companies).where(isNull(companies.deletedAt));
        res.json(rows);
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/dialysis/company/:companyId/pause",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
    async (req: AuthRequest, res) => {
      try {
        const companyId = parseInt(req.params.companyId as string);
        await pauseDialysisAutomation(companyId, req.user?.userId);
        res.json({ message: "Dialysis automation paused", companyId });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/dialysis/company/:companyId/resume",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
    async (req: AuthRequest, res) => {
      try {
        const companyId = parseInt(req.params.companyId as string);
        await resumeDialysisAutomation(companyId, req.user?.userId);
        res.json({ message: "Dialysis automation resumed", companyId });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/dialysis/run-now",
    authMiddleware,
    requireRole("SUPER_ADMIN"),
    async (req: AuthRequest, res) => {
      try {
        const preAssign = await runDialysisPreAssign();
        const recheck = await runDialysisRecheck();
        res.json({ preAssign, recheck });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/dialysis/events",
    authMiddleware,
    requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        const { companyId, limit: limitStr } = req.query;
        const limit = Math.min(parseInt(limitStr as string) || 50, 200);

        const conditions = [
          eq(automationEvents.eventType, "DIALYSIS_AUTO_ASSIGN"),
        ];
        if (companyId) conditions.push(eq(automationEvents.companyId, parseInt(companyId as string)));

        const events = await db.select().from(automationEvents)
          .where(and(...conditions))
          .orderBy(desc(automationEvents.createdAt))
          .limit(limit);

        const reassignEvents = await db.select().from(automationEvents)
          .where(and(
            eq(automationEvents.eventType, "DIALYSIS_AUTO_REASSIGN"),
            ...(companyId ? [eq(automationEvents.companyId, parseInt(companyId as string))] : [])
          ))
          .orderBy(desc(automationEvents.createdAt))
          .limit(limit);

        res.json({ assignEvents: events, reassignEvents });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );
}
