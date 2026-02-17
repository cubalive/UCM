import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../auth";
import { getActorContext } from "../auth";
import { db } from "../db";
import {
  intelligencePublications,
  intelligencePublicationTargets,
} from "@shared/schema";
import { eq, and, or, isNull } from "drizzle-orm";

export interface PublicationConfig {
  show_full_ranking_list?: boolean;
  show_peer_names?: boolean;
  show_counts?: boolean;
  show_thresholds?: boolean;
  show_trends?: boolean;
  allow_pdf_download?: boolean;
  visible_metrics?: string[];
  notes?: string;
}

const DEFAULT_CONFIG: PublicationConfig = {
  show_full_ranking_list: false,
  show_peer_names: false,
  show_counts: true,
  show_thresholds: true,
  show_trends: true,
  allow_pdf_download: true,
};

export function mergeConfig(raw: any): PublicationConfig {
  return { ...DEFAULT_CONFIG, ...(raw || {}) };
}

export async function checkPublicationAccess(
  module: string,
  clinicId: number,
  quarterKey?: string,
): Promise<{ allowed: boolean; config: PublicationConfig; publicationId?: number }> {
  const conditions: any[] = [
    eq(intelligencePublications.module, module),
    eq(intelligencePublications.published, true),
  ];
  if (quarterKey) {
    conditions.push(
      or(
        eq(intelligencePublications.quarterKey, quarterKey),
        isNull(intelligencePublications.quarterKey),
      )
    );
  }

  const pubs = await db
    .select()
    .from(intelligencePublications)
    .where(and(...conditions));

  for (const pub of pubs) {
    const targets = await db
      .select()
      .from(intelligencePublicationTargets)
      .where(
        and(
          eq(intelligencePublicationTargets.publicationId, pub.id),
          eq(intelligencePublicationTargets.enabled, true),
        )
      );

    const hasAccess = targets.some((t) => {
      if (t.targetType === "all_clinics") return true;
      if (t.targetType === "clinic" && t.clinicId === clinicId) return true;
      return false;
    });

    if (hasAccess) {
      return {
        allowed: true,
        config: mergeConfig(pub.configJson),
        publicationId: pub.id,
      };
    }
  }

  return { allowed: false, config: DEFAULT_CONFIG };
}

export function requirePublicationAccess(module: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });

    if (req.user.role === "SUPER_ADMIN") {
      (req as any).publicationConfig = { ...DEFAULT_CONFIG, allow_pdf_download: true, show_full_ranking_list: true, show_peer_names: true };
      return next();
    }

    const actor = await getActorContext(req);
    if (!actor || !actor.clinicId) {
      return res.status(404).json({ message: "Not found" });
    }

    const quarterKey = (req.query.quarter_key || req.params.quarter_key) as string | undefined;
    const result = await checkPublicationAccess(module, actor.clinicId, quarterKey);

    if (!result.allowed) {
      return res.status(404).json({ message: "Not found" });
    }

    (req as any).publicationConfig = result.config;
    (req as any).actorContext = actor;
    next();
  };
}
