import { Router, type Express, type Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import {
  listFeeRules,
  getFeeRule,
  createFeeRule,
  updateFeeRule,
  disableFeeRule,
  listFeeRuleAudit,
  resolveFeeRule,
  computeFeeFromRule,
} from "../services/feeRules";

const router = Router();

router.get(
  "/api/admin/fee-rules",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const filters: any = {};
      if (req.query.scopeType) filters.scopeType = req.query.scopeType;
      if (req.query.companyId) filters.companyId = parseInt(req.query.companyId as string);
      if (req.query.clinicId) filters.clinicId = parseInt(req.query.clinicId as string);
      if (req.query.isEnabled !== undefined) filters.isEnabled = req.query.isEnabled === "true";
      if (req.query.serviceLevel) filters.serviceLevel = req.query.serviceLevel;

      const rules = await listFeeRules(filters);
      res.json({ rules });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get(
  "/api/admin/fee-rules/audit",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const ruleId = req.query.ruleId ? parseInt(req.query.ruleId as string) : undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const events = await listFeeRuleAudit(ruleId, limit);
      res.json({ events });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get(
  "/api/admin/fee-rules/:id",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ message: "Invalid rule ID" });

      const rule = await getFeeRule(id);
      if (!rule) return res.status(404).json({ message: "Rule not found" });

      res.json(rule);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/fee-rules",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        scopeType, companyId, clinicId, serviceLevel,
        feeType, percentBps, fixedFeeCents,
        minFeeCents, maxFeeCents,
        isEnabled, priority, effectiveFrom, effectiveTo, notes,
      } = req.body;

      if (!scopeType || !feeType) {
        return res.status(400).json({ message: "scopeType and feeType are required" });
      }

      if (scopeType === "company" && !companyId) {
        return res.status(400).json({ message: "companyId required for company scope" });
      }
      if (scopeType === "clinic" && !clinicId) {
        return res.status(400).json({ message: "clinicId required for clinic scope" });
      }
      if (scopeType === "company_clinic" && (!companyId || !clinicId)) {
        return res.status(400).json({ message: "companyId and clinicId required for company_clinic scope" });
      }

      const bps = parseInt(percentBps) || 0;
      if (bps < 0 || bps > 10000) {
        return res.status(400).json({ message: "percentBps must be 0-10000" });
      }

      const parsedFixedFeeCents = parseInt(fixedFeeCents) || 0;
      const parsedMinFeeCents = minFeeCents != null ? parseInt(minFeeCents) : null;
      const parsedMaxFeeCents = maxFeeCents != null ? parseInt(maxFeeCents) : null;

      if (parsedFixedFeeCents < 0) {
        return res.status(400).json({ message: "fixedFeeCents must not be negative" });
      }
      if (parsedMinFeeCents != null && parsedMinFeeCents < 0) {
        return res.status(400).json({ message: "minFeeCents must not be negative" });
      }
      if (parsedMaxFeeCents != null && parsedMaxFeeCents < 0) {
        return res.status(400).json({ message: "maxFeeCents must not be negative" });
      }

      const rule = await createFeeRule(
        {
          scopeType,
          companyId: companyId ? parseInt(companyId) : null,
          clinicId: clinicId ? parseInt(clinicId) : null,
          serviceLevel: serviceLevel || null,
          feeType,
          percentBps: bps,
          fixedFeeCents: parsedFixedFeeCents,
          minFeeCents: parsedMinFeeCents,
          maxFeeCents: parsedMaxFeeCents,
          isEnabled: isEnabled !== false,
          priority: parseInt(priority) || 100,
          effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : null,
          effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
          notes: notes || null,
          createdBy: req.user?.userId || null,
        },
        req.user?.userId,
        req.user?.role
      );

      res.status(201).json(rule);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.patch(
  "/api/admin/fee-rules/:id",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ message: "Invalid rule ID" });

      const existing = await getFeeRule(id);
      if (!existing) return res.status(404).json({ message: "Rule not found" });

      const updates: any = {};
      if (req.body.scopeType !== undefined) updates.scopeType = req.body.scopeType;
      if (req.body.companyId !== undefined) updates.companyId = req.body.companyId ? parseInt(req.body.companyId) : null;
      if (req.body.clinicId !== undefined) updates.clinicId = req.body.clinicId ? parseInt(req.body.clinicId) : null;
      if (req.body.serviceLevel !== undefined) updates.serviceLevel = req.body.serviceLevel || null;
      if (req.body.feeType !== undefined) updates.feeType = req.body.feeType;
      if (req.body.percentBps !== undefined) {
        const bps = parseInt(req.body.percentBps);
        if (bps < 0 || bps > 10000) return res.status(400).json({ message: "percentBps must be 0-10000" });
        updates.percentBps = bps;
      }
      if (req.body.fixedFeeCents !== undefined) {
        const fc = parseInt(req.body.fixedFeeCents) || 0;
        if (fc < 0) return res.status(400).json({ message: "fixedFeeCents must not be negative" });
        updates.fixedFeeCents = fc;
      }
      if (req.body.minFeeCents !== undefined) {
        const mc = req.body.minFeeCents != null ? parseInt(req.body.minFeeCents) : null;
        if (mc != null && mc < 0) return res.status(400).json({ message: "minFeeCents must not be negative" });
        updates.minFeeCents = mc;
      }
      if (req.body.maxFeeCents !== undefined) {
        const xc = req.body.maxFeeCents != null ? parseInt(req.body.maxFeeCents) : null;
        if (xc != null && xc < 0) return res.status(400).json({ message: "maxFeeCents must not be negative" });
        updates.maxFeeCents = xc;
      }
      if (req.body.isEnabled !== undefined) updates.isEnabled = req.body.isEnabled;
      if (req.body.priority !== undefined) updates.priority = parseInt(req.body.priority) || 100;
      if (req.body.effectiveFrom !== undefined) updates.effectiveFrom = req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : null;
      if (req.body.effectiveTo !== undefined) updates.effectiveTo = req.body.effectiveTo ? new Date(req.body.effectiveTo) : null;
      if (req.body.notes !== undefined) updates.notes = req.body.notes || null;

      const updated = await updateFeeRule(id, updates, req.user?.userId, req.user?.role);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/fee-rules/:id/disable",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ message: "Invalid rule ID" });

      const rule = await disableFeeRule(id, req.user?.userId, req.user?.role);
      if (!rule) return res.status(404).json({ message: "Rule not found" });

      res.json(rule);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/fee-rules/preview",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { companyId, clinicId, amountCents, serviceLevel } = req.body;

      if (!companyId || !clinicId || !amountCents) {
        return res.status(400).json({ message: "companyId, clinicId, and amountCents are required" });
      }

      const result = await resolveFeeRule({
        companyId: parseInt(companyId),
        clinicId: parseInt(clinicId),
        amountCents: parseInt(amountCents),
        serviceLevel: serviceLevel || null,
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

export function registerFeeRulesRoutes(app: Express) {
  app.use(router);
}
