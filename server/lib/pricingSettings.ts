import { db } from "../db";
import { appSettings, clinics, clinicMemberships } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface PricingSettings {
  platform_tariffs_enabled: boolean;
  default_discount_percent: number;
}

const DEFAULT_PRICING_SETTINGS: PricingSettings = {
  platform_tariffs_enabled: false,
  default_discount_percent: 0,
};

let cachedSettings: PricingSettings | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000;

export async function getPricingSettings(): Promise<PricingSettings> {
  const now = Date.now();
  if (cachedSettings && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedSettings;
  }

  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "pricing"));
    if (!row || !row.valueJson) {
      cachedSettings = { ...DEFAULT_PRICING_SETTINGS };
    } else {
      const val = row.valueJson as Record<string, unknown>;
      cachedSettings = {
        platform_tariffs_enabled: val.platform_tariffs_enabled === true,
        default_discount_percent: typeof val.default_discount_percent === "number"
          ? Math.max(0, Math.min(100, val.default_discount_percent))
          : 0,
      };
    }
    cacheTimestamp = now;
    return cachedSettings;
  } catch (err: any) {
    console.error("[PricingSettings] Failed to read:", err.message);
    return cachedSettings ?? { ...DEFAULT_PRICING_SETTINGS };
  }
}

export async function updatePricingSettings(updates: Partial<PricingSettings>): Promise<PricingSettings> {
  const current = await getPricingSettings();
  const merged: PricingSettings = {
    platform_tariffs_enabled: updates.platform_tariffs_enabled ?? current.platform_tariffs_enabled,
    default_discount_percent: updates.default_discount_percent ?? current.default_discount_percent,
  };

  merged.default_discount_percent = Math.max(0, Math.min(100, merged.default_discount_percent));

  await db.insert(appSettings).values({
    key: "pricing",
    valueJson: merged,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: appSettings.key,
    set: { valueJson: merged, updatedAt: new Date() },
  });

  cachedSettings = merged;
  cacheTimestamp = Date.now();
  return merged;
}

export interface DiscountResolution {
  discountPercent: number;
  source: "super_admin_override" | "clinic_override" | "membership" | "default" | "none";
}

export async function resolveDiscountPercent(
  clinicId: number | null,
  superAdminOverride?: number,
): Promise<DiscountResolution> {
  if (superAdminOverride !== undefined && superAdminOverride > 0) {
    return { discountPercent: superAdminOverride, source: "super_admin_override" };
  }

  if (clinicId) {
    const [clinic] = await db.select({ discountPercent: clinics.discountPercent })
      .from(clinics).where(eq(clinics.id, clinicId));
    if (clinic?.discountPercent !== null && clinic?.discountPercent !== undefined) {
      const val = parseFloat(String(clinic.discountPercent));
      if (val > 0) {
        return { discountPercent: val, source: "clinic_override" };
      }
    }

    const [membership] = await db.select({ includedDiscountPercent: clinicMemberships.includedDiscountPercent, status: clinicMemberships.status })
      .from(clinicMemberships).where(and(eq(clinicMemberships.clinicId, clinicId), eq(clinicMemberships.status, "active")));
    if (membership) {
      const val = parseFloat(String(membership.includedDiscountPercent));
      if (val > 0) {
        return { discountPercent: val, source: "membership" };
      }
    }
  }

  const settings = await getPricingSettings();
  if (settings.default_discount_percent > 0) {
    return { discountPercent: settings.default_discount_percent, source: "default" };
  }

  return { discountPercent: 0, source: "none" };
}

export function invalidatePricingCache(): void {
  cachedSettings = null;
  cacheTimestamp = 0;
}
