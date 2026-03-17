/**
 * M-1: Database-backed feature flags with per-tenant override.
 *
 * Priority: company-specific flag > global flag > default (false).
 */
import { db } from "../db";
import { featureFlags } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

/**
 * Get a feature flag value.
 * Checks company-specific flag first, then global.
 */
export async function getFeatureFlag(
  key: string,
  companyId?: number | null,
): Promise<boolean> {
  try {
    // Check company-specific flag first
    if (companyId) {
      const [companyFlag] = await db
        .select({ enabled: featureFlags.enabled })
        .from(featureFlags)
        .where(
          and(
            eq(featureFlags.flagKey, key),
            eq(featureFlags.companyId, companyId),
          ),
        )
        .limit(1);
      if (companyFlag) return companyFlag.enabled;
    }

    // Fall back to global flag
    const [globalFlag] = await db
      .select({ enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(
        and(
          eq(featureFlags.flagKey, key),
          isNull(featureFlags.companyId),
        ),
      )
      .limit(1);

    return globalFlag?.enabled ?? false;
  } catch (err: any) {
    console.warn(`[FeatureFlags] Error reading flag '${key}':`, err.message);
    return false;
  }
}

/**
 * Set a feature flag value.
 */
export async function setFeatureFlag(
  key: string,
  enabled: boolean,
  updatedBy: number,
  companyId?: number | null,
): Promise<void> {
  const existing = await db
    .select()
    .from(featureFlags)
    .where(
      and(
        eq(featureFlags.flagKey, key),
        companyId
          ? eq(featureFlags.companyId, companyId)
          : isNull(featureFlags.companyId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(featureFlags)
      .set({ enabled, updatedBy, updatedAt: new Date() })
      .where(eq(featureFlags.id, existing[0].id));
  } else {
    await db.insert(featureFlags).values({
      flagKey: key,
      enabled,
      companyId: companyId || null,
      updatedBy,
    });
  }
}

/**
 * Get all feature flags (for admin UI).
 */
export async function getAllFeatureFlags(
  companyId?: number | null,
): Promise<Array<{ key: string; enabled: boolean; companyId: number | null }>> {
  const flags = companyId
    ? await db.select().from(featureFlags).where(eq(featureFlags.companyId, companyId))
    : await db.select().from(featureFlags).where(isNull(featureFlags.companyId));

  return flags.map((f) => ({
    key: f.flagKey,
    enabled: f.enabled,
    companyId: f.companyId,
  }));
}
