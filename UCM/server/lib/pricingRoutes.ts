import type { Express } from "express";
import { authMiddleware, requireRole, requirePermission, type AuthRequest } from "../auth";
import { db } from "../db";
import { pricingProfiles, pricingRules, pricingAuditLog } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { getActivePricingProfile, ALL_RULE_KEYS, DEFAULT_RATES, RULE_LABELS } from "./pricingResolver";
import { calculatePrivateQuote } from "./privatePricing";
import { storage } from "../storage";

export function registerPricingRoutes(app: Express) {
  app.get("/api/pricing/profiles", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const city = req.query.city as string | undefined;
      let profiles;
      if (city) {
        profiles = await db.select().from(pricingProfiles).where(eq(pricingProfiles.city, city));
      } else {
        profiles = await db.select().from(pricingProfiles);
      }
      res.json(profiles);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/pricing/profile/:id", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const [profile] = await db.select().from(pricingProfiles).where(eq(pricingProfiles.id, id));
      if (!profile) return res.status(404).json({ message: "Profile not found" });

      const rules = await db.select().from(pricingRules).where(eq(pricingRules.profileId, id));
      res.json({ profile, rules });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/pricing/active", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const city = req.query.city as string;
      if (!city) return res.status(400).json({ message: "city required" });

      const result = await getActivePricingProfile(city, "private");
      const rules = await db.select().from(pricingRules).where(eq(pricingRules.profileId, result.profileId));

      res.json({
        profileId: result.profileId,
        profileName: result.profileName,
        source: result.source,
        rates: result.rates,
        rules,
        ruleLabels: RULE_LABELS,
        allKeys: ALL_RULE_KEYS,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.put("/api/pricing/rules", authMiddleware, requireRole("SUPER_ADMIN", "DISPATCH"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        profileId: z.number(),
        rules: z.array(z.object({
          key: z.string(),
          valueNumeric: z.number(),
        })),
        note: z.string().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });

      const { profileId, rules: ruleUpdates, note } = parsed.data;
      const userId = req.user!.userId;

      const [profile] = await db.select().from(pricingProfiles).where(eq(pricingProfiles.id, profileId));
      if (!profile) return res.status(404).json({ message: "Profile not found" });

      const existingRules = await db.select().from(pricingRules).where(eq(pricingRules.profileId, profileId));
      const existingMap = new Map(existingRules.map(r => [r.key, r]));

      for (const update of ruleUpdates) {
        const existing = existingMap.get(update.key);
        const oldValue = existing?.valueNumeric ? String(existing.valueNumeric) : "0";
        const newValue = String(update.valueNumeric);

        if (oldValue !== newValue) {
          await db.insert(pricingAuditLog).values({
            profileId,
            key: update.key,
            oldValue,
            newValue,
            changedBy: userId,
            note: note || null,
          });
        }

        if (existing) {
          await db.update(pricingRules)
            .set({ valueNumeric: newValue, updatedBy: userId, updatedAt: new Date() })
            .where(eq(pricingRules.id, existing.id));
        } else {
          await db.insert(pricingRules).values({
            profileId,
            key: update.key,
            valueNumeric: newValue,
            enabled: true,
            updatedBy: userId,
          });
        }
      }

      await db.update(pricingProfiles)
        .set({ updatedBy: userId, updatedAt: new Date() })
        .where(eq(pricingProfiles.id, profileId));

      await storage.createAuditLog({
        userId,
        action: "UPDATE_PRICING",
        entity: "pricing_profiles",
        entityId: profileId,
        details: `Updated ${ruleUpdates.length} pricing rules for profile "${profile.name}"${note ? ` - ${note}` : ""}`,
        cityId: null,
      });

      res.json({ success: true, updatedCount: ruleUpdates.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pricing/reset-defaults", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({ profileId: z.number() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "profileId required" });

      const { profileId } = parsed.data;
      const userId = req.user!.userId;

      const [profile] = await db.select().from(pricingProfiles).where(eq(pricingProfiles.id, profileId));
      if (!profile) return res.status(404).json({ message: "Profile not found" });

      const existingRules = await db.select().from(pricingRules).where(eq(pricingRules.profileId, profileId));
      const existingMap = new Map(existingRules.map(r => [r.key, r]));

      const defaultRateMap: Record<string, number> = {};
      for (const key of ALL_RULE_KEYS) {
        const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()) as keyof typeof DEFAULT_RATES;
        defaultRateMap[key] = (DEFAULT_RATES as any)[camelKey] ?? 0;
      }

      for (const key of ALL_RULE_KEYS) {
        const defaultVal = String(defaultRateMap[key]);
        const existing = existingMap.get(key);
        const oldValue = existing?.valueNumeric ? String(existing.valueNumeric) : "0";

        if (oldValue !== defaultVal) {
          await db.insert(pricingAuditLog).values({
            profileId,
            key,
            oldValue,
            newValue: defaultVal,
            changedBy: userId,
            note: "Reset to defaults",
          });
        }

        if (existing) {
          await db.update(pricingRules)
            .set({ valueNumeric: defaultVal, updatedBy: userId, updatedAt: new Date() })
            .where(eq(pricingRules.id, existing.id));
        } else {
          await db.insert(pricingRules).values({
            profileId,
            key,
            valueNumeric: defaultVal,
            enabled: true,
            updatedBy: userId,
          });
        }
      }

      await db.update(pricingProfiles)
        .set({ updatedBy: userId, updatedAt: new Date() })
        .where(eq(pricingProfiles.id, profileId));

      await storage.createAuditLog({
        userId,
        action: "RESET_PRICING",
        entity: "pricing_profiles",
        entityId: profileId,
        details: `Reset all pricing rules to defaults for profile "${profile.name}"`,
        cityId: null,
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/pricing/preview-quote", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const schema = z.object({
        miles: z.number().min(0),
        minutes: z.number().min(0).optional(),
        isWheelchair: z.boolean().default(false),
        roundTrip: z.boolean().default(false),
        scheduledTime: z.string().default("10:00"),
        city: z.string(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid data" });

      const { miles, minutes, isWheelchair, roundTrip, scheduledTime, city } = parsed.data;
      const result = await getActivePricingProfile(city, "private");
      const rates = result.rates;

      const mileChargeCents = Math.round(miles * rates.perMileCents);
      const bufferCents = Math.round(mileChargeCents * (rates.bufferPercent / 100));

      const [hStr] = scheduledTime.split(":");
      const hour = parseInt(hStr, 10);
      const isPeak = (!isNaN(hour)) && (
        (hour >= rates.peakStartHour1 && hour < rates.peakEndHour1) ||
        (hour >= rates.peakStartHour2 && hour < rates.peakEndHour2)
      );
      const peakCents = isPeak ? Math.round((mileChargeCents + bufferCents) * (rates.peakSurchargePercent / 100)) : 0;
      const wavCents = isWheelchair ? rates.wheelchairSurchargeCents : 0;

      let subtotal = rates.baseFareCents + mileChargeCents + bufferCents + peakCents + wavCents;
      const rtMultiplier = roundTrip ? rates.roundTripMultiplier : 1;
      subtotal = Math.round(subtotal * rtMultiplier);

      let total = Math.round(subtotal / 50) * 50;
      total = Math.max(rates.minimumFareCents, Math.min(rates.maxFareCents, total));

      res.json({
        totalCents: total,
        totalFormatted: `$${(total / 100).toFixed(2)}`,
        breakdown: {
          baseFareCents: rates.baseFareCents,
          mileChargeCents,
          bufferCents,
          peakCents,
          wavCents,
          roundTripMultiplier: rtMultiplier,
          subtotalCents: subtotal,
          isPeak,
          minimumApplied: total === rates.minimumFareCents && subtotal < rates.minimumFareCents,
          maximumApplied: total === rates.maxFareCents && subtotal > rates.maxFareCents,
        },
        ratesUsed: rates,
        profileName: result.profileName,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/pricing/audit", authMiddleware, requirePermission("invoices", "read"), async (req: AuthRequest, res) => {
    try {
      const profileId = parseInt(req.query.profileId as string);
      if (isNaN(profileId)) return res.status(400).json({ message: "profileId required" });

      const logs = await db.select().from(pricingAuditLog)
        .where(eq(pricingAuditLog.profileId, profileId))
        .orderBy(desc(pricingAuditLog.changedAt))
        .limit(100);

      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
