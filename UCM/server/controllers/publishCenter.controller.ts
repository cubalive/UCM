import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { db } from "../db";
import {
  intelligencePublications,
  intelligencePublicationTargets,
  clinics,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { mergeConfig } from "../lib/publicationGate";

export async function listPublicationsHandler(req: AuthRequest, res: Response) {
  try {
    const moduleFilter = req.query.module as string | undefined;
    const conditions: any[] = [];
    if (moduleFilter) conditions.push(eq(intelligencePublications.module, moduleFilter));

    const rows = await db
      .select()
      .from(intelligencePublications)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(intelligencePublications.createdAt))
      .limit(200);

    const enriched = await Promise.all(
      rows.map(async (pub) => {
        const targets = await db
          .select()
          .from(intelligencePublicationTargets)
          .where(eq(intelligencePublicationTargets.publicationId, pub.id));

        const targetClinics = await Promise.all(
          targets
            .filter((t) => t.targetType === "clinic" && t.clinicId)
            .map(async (t) => {
              const c = await db
                .select({ name: clinics.name })
                .from(clinics)
                .where(eq(clinics.id, t.clinicId!))
                .then((r) => r[0]);
              return { ...t, clinicName: c?.name || `Clinic #${t.clinicId}` };
            })
        );

        return {
          ...pub,
          configJson: mergeConfig(pub.configJson),
          targets: [
            ...targets.filter((t) => t.targetType === "all_clinics"),
            ...targetClinics,
          ],
        };
      })
    );

    return res.json({ publications: enriched });
  } catch (err: any) {
    console.error("listPublications error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function createPublicationHandler(req: AuthRequest, res: Response) {
  try {
    const { module, quarterKey, scope, state, city, metricKey, configJson, targets } = req.body;

    if (!module) {
      return res.status(400).json({ message: "module is required" });
    }

    const validModules = ["indexes", "certification", "ranking", "audit", "prediction"];
    if (!validModules.includes(module)) {
      return res.status(400).json({ message: `module must be one of: ${validModules.join(", ")}` });
    }

    const [pub] = await db
      .insert(intelligencePublications)
      .values({
        module,
        quarterKey: quarterKey || null,
        scope: scope || null,
        state: state || null,
        city: city || null,
        metricKey: metricKey || null,
        configJson: configJson || {},
        published: false,
        publishedBy: req.user!.userId,
      })
      .returning();

    if (targets && Array.isArray(targets)) {
      for (const target of targets) {
        await db.insert(intelligencePublicationTargets).values({
          publicationId: pub.id,
          targetType: target.targetType || "all_clinics",
          clinicId: target.clinicId || null,
          enabled: target.enabled !== false,
        });
      }
    }

    return res.json({ publication: pub });
  } catch (err: any) {
    console.error("createPublication error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function updatePublicationHandler(req: AuthRequest, res: Response) {
  try {
    const pubId = parseInt(String(req.params.id));
    if (!pubId || isNaN(pubId)) return res.status(400).json({ message: "Invalid publication ID" });

    const { configJson, quarterKey, scope, state, city, metricKey } = req.body;

    const updates: any = {};
    if (configJson !== undefined) updates.configJson = configJson;
    if (quarterKey !== undefined) updates.quarterKey = quarterKey;
    if (scope !== undefined) updates.scope = scope;
    if (state !== undefined) updates.state = state;
    if (city !== undefined) updates.city = city;
    if (metricKey !== undefined) updates.metricKey = metricKey;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No updates provided" });
    }

    const [updated] = await db
      .update(intelligencePublications)
      .set(updates)
      .where(eq(intelligencePublications.id, pubId))
      .returning();

    if (!updated) return res.status(404).json({ message: "Publication not found" });
    return res.json({ publication: updated });
  } catch (err: any) {
    console.error("updatePublication error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function publishHandler(req: AuthRequest, res: Response) {
  try {
    const pubId = parseInt(String(req.params.id));
    if (!pubId || isNaN(pubId)) return res.status(400).json({ message: "Invalid publication ID" });

    const [updated] = await db
      .update(intelligencePublications)
      .set({
        published: true,
        publishedAt: new Date(),
        publishedBy: req.user!.userId,
      })
      .where(eq(intelligencePublications.id, pubId))
      .returning();

    if (!updated) return res.status(404).json({ message: "Publication not found" });
    return res.json({ publication: updated });
  } catch (err: any) {
    console.error("publish error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function unpublishHandler(req: AuthRequest, res: Response) {
  try {
    const pubId = parseInt(String(req.params.id));
    if (!pubId || isNaN(pubId)) return res.status(400).json({ message: "Invalid publication ID" });

    const [updated] = await db
      .update(intelligencePublications)
      .set({
        published: false,
        publishedAt: null,
      })
      .where(eq(intelligencePublications.id, pubId))
      .returning();

    if (!updated) return res.status(404).json({ message: "Publication not found" });
    return res.json({ publication: updated });
  } catch (err: any) {
    console.error("unpublish error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function deletePublicationHandler(req: AuthRequest, res: Response) {
  try {
    const pubId = parseInt(String(req.params.id));
    if (!pubId || isNaN(pubId)) return res.status(400).json({ message: "Invalid publication ID" });

    await db
      .delete(intelligencePublicationTargets)
      .where(eq(intelligencePublicationTargets.publicationId, pubId));

    const [deleted] = await db
      .delete(intelligencePublications)
      .where(eq(intelligencePublications.id, pubId))
      .returning();

    if (!deleted) return res.status(404).json({ message: "Publication not found" });
    return res.json({ success: true });
  } catch (err: any) {
    console.error("deletePublication error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function addTargetHandler(req: AuthRequest, res: Response) {
  try {
    const pubId = parseInt(String(req.params.id));
    if (!pubId || isNaN(pubId)) return res.status(400).json({ message: "Invalid publication ID" });

    const { targetType, clinicId } = req.body;
    if (!targetType) return res.status(400).json({ message: "targetType is required" });

    const [target] = await db
      .insert(intelligencePublicationTargets)
      .values({
        publicationId: pubId,
        targetType,
        clinicId: clinicId || null,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: [
          intelligencePublicationTargets.publicationId,
          intelligencePublicationTargets.targetType,
          intelligencePublicationTargets.clinicId,
        ],
        set: { enabled: true },
      })
      .returning();

    return res.json({ target });
  } catch (err: any) {
    console.error("addTarget error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function removeTargetHandler(req: AuthRequest, res: Response) {
  try {
    const targetId = parseInt(String(req.params.targetId));
    if (!targetId || isNaN(targetId)) return res.status(400).json({ message: "Invalid target ID" });

    const [deleted] = await db
      .delete(intelligencePublicationTargets)
      .where(eq(intelligencePublicationTargets.id, targetId))
      .returning();

    if (!deleted) return res.status(404).json({ message: "Target not found" });
    return res.json({ success: true });
  } catch (err: any) {
    console.error("removeTarget error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function listClinicsForTargetHandler(req: AuthRequest, res: Response) {
  try {
    const rows = await db
      .select({ id: clinics.id, name: clinics.name, cityId: clinics.cityId })
      .from(clinics)
      .where(eq(clinics.active, true))
      .orderBy(clinics.name)
      .limit(500);

    return res.json({ clinics: rows });
  } catch (err: any) {
    console.error("listClinicsForTarget error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}
