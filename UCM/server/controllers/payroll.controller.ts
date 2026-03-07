import type { Express, Response } from "express";
import { authMiddleware, requireRole, type AuthRequest, getCompanyIdFromAuth } from "../auth";
import { getCompanyPayRules, upsertCompanyPayRules } from "../services/payroll/payrollRulesService";
import { getWeeklyEarnings, getCurrentWeekStart } from "../services/payroll/weeklySummaryService";
import { computeDailyMinimumTopups } from "../services/payroll/dailyMinimumEngine";
import { z } from "zod";

function requireCompanyId(req: AuthRequest, res: Response): number | null {
  const companyId = getCompanyIdFromAuth(req);
  if (!companyId) {
    res.status(400).json({ message: "Company context required." });
    return null;
  }
  return companyId;
}

const payRulesSchema = z.object({
  dailyMinEnabled: z.boolean().optional(),
  dailyMinCents: z.number().int().min(0).nullable().optional(),
  dailyMinAppliesDays: z.array(z.string()).nullable().optional(),
  onTimeBonusEnabled: z.boolean().optional(),
  onTimeBonusMode: z.enum(["PER_TRIP", "WEEKLY"]).nullable().optional(),
  onTimeBonusCents: z.number().int().min(0).nullable().optional(),
  onTimeThresholdMinutes: z.number().int().min(1).max(60).nullable().optional(),
  onTimeRequiresConfirmedPickup: z.boolean().optional(),
  noShowPenaltyEnabled: z.boolean().optional(),
  noShowPenaltyCents: z.number().int().min(0).nullable().optional(),
  noShowPenaltyReasonCodes: z.array(z.string()).nullable().optional(),
});

export function registerPayrollModifierRoutes(app: Express) {
  app.get(
    "/api/company/payroll/pay-rules",
    authMiddleware,
    requireRole("COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = requireCompanyId(req, res);
        if (!companyId) return;
        const rules = await getCompanyPayRules(companyId);
        res.json({ rules: rules || null });
      } catch (err: any) {
        console.error("[PayRules] Get error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.put(
    "/api/company/payroll/pay-rules",
    authMiddleware,
    requireRole("COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = requireCompanyId(req, res);
        if (!companyId) return;

        const parsed = payRulesSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid payload", errors: parsed.error.flatten() });
        }

        const rules = await upsertCompanyPayRules(companyId, parsed.data);
        res.json({ rules });
      } catch (err: any) {
        console.error("[PayRules] Upsert error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get(
    "/api/drivers/me/weekly-earnings",
    authMiddleware,
    requireRole("DRIVER"),
    async (req: AuthRequest, res: Response) => {
      try {
        const user = req.user;
        if (!user?.driverId) {
          return res.status(403).json({ message: "No driver profile linked" });
        }
        if (!user.companyId) {
          return res.status(403).json({ message: "No company context" });
        }

        const weekStart = (req.query.weekStart as string) || getCurrentWeekStart();

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(weekStart)) {
          return res.status(400).json({ message: "weekStart must be YYYY-MM-DD" });
        }

        const earnings = await getWeeklyEarnings(user.driverId, user.companyId, weekStart);
        res.json(earnings);
      } catch (err: any) {
        console.error("[Earnings] Weekly error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/company/payroll/compute-daily-min",
    authMiddleware,
    requireRole("COMPANY_ADMIN"),
    async (req: AuthRequest, res: Response) => {
      try {
        const companyId = requireCompanyId(req, res);
        if (!companyId) return;

        const { date } = req.body;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return res.status(400).json({ message: "date must be YYYY-MM-DD" });
        }

        const topups = await computeDailyMinimumTopups(companyId, date);
        res.json({ topups, count: topups.length });
      } catch (err: any) {
        console.error("[DailyMin] Compute error:", err.message);
        res.status(500).json({ message: err.message });
      }
    }
  );
}
