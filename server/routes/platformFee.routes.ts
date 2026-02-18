import { Router, type Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { type Response } from "express";
import {
  getGlobalSettings,
  updateGlobalSettings,
  getAllCompanyOverrides,
  upsertCompanyOverride,
  deleteCompanyOverride,
  getEffectivePlatformFee,
} from "../services/platformFee";
import { db } from "../db";
import { companies } from "@shared/schema";

const router = Router();

router.get(
  "/api/admin/platform-fee/settings",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (_req: AuthRequest, res: Response) => {
    try {
      const settings = await getGlobalSettings();
      res.json(settings);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/platform-fee/settings",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const { enabled, defaultFeeType, defaultFeePercent, defaultFeeCents } = req.body;
      const updated = await updateGlobalSettings({
        enabled,
        defaultFeeType,
        defaultFeePercent: defaultFeePercent != null ? String(defaultFeePercent) : undefined,
        defaultFeeCents: defaultFeeCents != null ? Number(defaultFeeCents) : undefined,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get(
  "/api/admin/platform-fee/companies",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (_req: AuthRequest, res: Response) => {
    try {
      const overrides = await getAllCompanyOverrides();
      const allCompanies = await db.select().from(companies);

      const result = allCompanies.map((c) => {
        const override = overrides.find((o) => o.companyId === c.id);
        return {
          companyId: c.id,
          companyName: c.name,
          hasOverride: !!override,
          override: override || null,
        };
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.post(
  "/api/admin/platform-fee/companies/:companyId",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(req.params.companyId);
      if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });

      const { enabled, feeType, feePercent, feeCents, clearOverride } = req.body;

      if (clearOverride) {
        await deleteCompanyOverride(companyId);
        return res.json({ cleared: true, companyId });
      }

      const result = await upsertCompanyOverride(companyId, {
        enabled: enabled ?? null,
        feeType: feeType ?? null,
        feePercent: feePercent != null ? String(feePercent) : null,
        feeCents: feeCents != null ? Number(feeCents) : null,
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

router.get(
  "/api/admin/platform-fee/effective/:companyId",
  authMiddleware,
  requireRole("SUPER_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(req.params.companyId);
      if (isNaN(companyId)) return res.status(400).json({ message: "Invalid company ID" });
      const fee = await getEffectivePlatformFee(companyId);
      res.json(fee);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }
);

export function registerPlatformFeeRoutes(app: Express) {
  app.use(router);
}
