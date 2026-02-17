import type { Response } from "express";
import type { AuthRequest } from "../auth";
import { getActorContext } from "../auth";
import { db } from "../db";
import {
  clinicCertifications,
  quarterlyRankings,
  quarterlyRankingEntries,
  clinics,
  clinicQuarterlyReports,
  clinicQuarterlyReportMetrics,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { computeCertifications, saveCertifications, getQuarterDates, getCurrentQuarterKey } from "../lib/certificationEngine";
import { computeRankings, saveRankings } from "../lib/rankingEngine";
import { computeAuditReadiness } from "../lib/auditShieldEngine";
import { computePredictions } from "../lib/predictionEngine";
import { checkPublicationAccess, type PublicationConfig } from "../lib/publicationGate";
import {
  generateCertificationPdf,
  generateRankingPdf,
  generateAuditPdf,
  generatePredictionPdf,
  generateQuarterlyReportPdf,
} from "../lib/intelligencePdfGenerators";

export async function getCertificationsModuleHandler(req: AuthRequest, res: Response) {
  try {
    const quarterKey = (req.query.quarter_key as string) || getCurrentQuarterKey();
    const scope = (req.query.scope as string) || "general";
    const stateFilter = req.query.state as string | undefined;
    const cityFilter = req.query.city as string | undefined;

    const { periodStart, periodEnd } = getQuarterDates(quarterKey);

    const results = await computeCertifications({
      quarterKey,
      periodStart,
      periodEnd,
      computedBy: req.user!.userId,
    });

    return res.json({
      quarterKey,
      periodStart,
      periodEnd,
      certifications: results,
      summary: {
        total: results.length,
        platinum: results.filter((r) => r.certLevel === "PLATINUM").length,
        gold: results.filter((r) => r.certLevel === "GOLD").length,
        silver: results.filter((r) => r.certLevel === "SILVER").length,
        atRisk: results.filter((r) => r.certLevel === "AT_RISK").length,
      },
    });
  } catch (err: any) {
    console.error("getCertificationsModule error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function computeAndSaveCertificationsHandler(req: AuthRequest, res: Response) {
  try {
    const { quarterKey } = req.body;
    if (!quarterKey) return res.status(400).json({ message: "quarterKey required (e.g. 2026-Q1)" });

    const { periodStart, periodEnd } = getQuarterDates(quarterKey);
    const results = await computeCertifications({
      quarterKey,
      periodStart,
      periodEnd,
      computedBy: req.user!.userId,
    });

    await saveCertifications({ quarterKey, periodStart, periodEnd, computedBy: req.user!.userId }, results);

    return res.json({ quarterKey, saved: results.length, certifications: results });
  } catch (err: any) {
    console.error("computeAndSaveCertifications error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getCertificationPdfHandler(req: AuthRequest, res: Response) {
  try {
    const quarterKey = (req.query.quarter_key as string) || getCurrentQuarterKey();
    const { periodStart, periodEnd } = getQuarterDates(quarterKey);

    const results = await computeCertifications({
      quarterKey,
      periodStart,
      periodEnd,
      computedBy: req.user!.userId,
    });

    const pdf = await generateCertificationPdf({ quarterKey, certifications: results });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="UCM_Certification_${quarterKey}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    console.error("getCertificationPdf error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getRankingsModuleHandler(req: AuthRequest, res: Response) {
  try {
    const quarterKey = (req.query.quarter_key as string) || getCurrentQuarterKey();
    const scope = (req.query.scope as "city" | "state" | "national") || "national";
    const state = req.query.state as string | undefined;
    const city = req.query.city as string | undefined;
    const metricKey = (req.query.metric_key as string) || "tri";

    const { periodStart, periodEnd } = getQuarterDates(quarterKey);

    const entries = await computeRankings({
      quarterKey,
      periodStart,
      periodEnd,
      scope,
      state,
      city,
      metricKey,
    });

    return res.json({ quarterKey, scope, metricKey, entries });
  } catch (err: any) {
    console.error("getRankingsModule error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function computeAndSaveRankingsHandler(req: AuthRequest, res: Response) {
  try {
    const { quarterKey, scope, state, city, metricKey } = req.body;
    if (!quarterKey) return res.status(400).json({ message: "quarterKey required" });

    const { periodStart, periodEnd } = getQuarterDates(quarterKey);
    const entries = await computeRankings({
      quarterKey, periodStart, periodEnd,
      scope: scope || "national",
      state, city, metricKey: metricKey || "tri",
    });

    const ranking = await saveRankings(
      { quarterKey, periodStart, periodEnd, scope: scope || "national", state, city, metricKey: metricKey || "tri" },
      entries
    );

    return res.json({ quarterKey, rankingId: ranking.id, saved: entries.length, entries });
  } catch (err: any) {
    console.error("computeAndSaveRankings error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getRankingPdfHandler(req: AuthRequest, res: Response) {
  try {
    const quarterKey = (req.query.quarter_key as string) || getCurrentQuarterKey();
    const scope = (req.query.scope as "city" | "state" | "national") || "national";
    const state = req.query.state as string | undefined;
    const city = req.query.city as string | undefined;
    const metricKey = (req.query.metric_key as string) || "tri";

    const { periodStart, periodEnd } = getQuarterDates(quarterKey);
    const entries = await computeRankings({ quarterKey, periodStart, periodEnd, scope, state, city, metricKey });

    const pdf = await generateRankingPdf({ quarterKey, scope, metricKey, entries });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="UCM_Ranking_${quarterKey}_${scope}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    console.error("getRankingPdf error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getAuditShieldHandler(req: AuthRequest, res: Response) {
  try {
    const dateFrom = (req.query.dateFrom as string) || (req.query.period_start as string);
    const dateTo = (req.query.dateTo as string) || (req.query.period_end as string);
    const scope = (req.query.scope as string) || "general";
    const state = req.query.state as string | undefined;
    const city = req.query.city as string | undefined;

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ message: "dateFrom and dateTo required" });
    }

    const results = await computeAuditReadiness({
      periodStart: dateFrom,
      periodEnd: dateTo,
      scope: scope as any,
      state,
      city,
    });

    const avgScore = results.length > 0 ? results.reduce((a, b) => a + b.score, 0) / results.length : 0;

    return res.json({
      dateFrom,
      dateTo,
      scope,
      avgScore: Math.round(avgScore * 10) / 10,
      clinicCount: results.length,
      results,
    });
  } catch (err: any) {
    console.error("getAuditShield error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getAuditPdfHandler(req: AuthRequest, res: Response) {
  try {
    const dateFrom = (req.query.dateFrom as string) || (req.query.period_start as string);
    const dateTo = (req.query.dateTo as string) || (req.query.period_end as string);

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ message: "dateFrom and dateTo required" });
    }

    const results = await computeAuditReadiness({
      periodStart: dateFrom,
      periodEnd: dateTo,
      scope: (req.query.scope as any) || "general",
      state: req.query.state as string | undefined,
      city: req.query.city as string | undefined,
    });

    const pdf = await generateAuditPdf({ periodStart: dateFrom, periodEnd: dateTo, results });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="UCM_AuditShield_${dateFrom}_${dateTo}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    console.error("getAuditPdf error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getPredictionsHandler(req: AuthRequest, res: Response) {
  try {
    const dateFrom = (req.query.dateFrom as string);
    const dateTo = (req.query.dateTo as string);
    const scope = (req.query.scope as string) || "general";
    const state = req.query.state as string | undefined;
    const city = req.query.city as string | undefined;

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ message: "dateFrom and dateTo required" });
    }

    const result = await computePredictions({ dateFrom, dateTo, scope: scope as any, state, city });
    return res.json({ dateFrom, dateTo, scope, ...result });
  } catch (err: any) {
    console.error("getPredictions error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getPredictionPdfHandler(req: AuthRequest, res: Response) {
  try {
    const dateFrom = (req.query.dateFrom as string);
    const dateTo = (req.query.dateTo as string);

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ message: "dateFrom and dateTo required" });
    }

    const result = await computePredictions({
      dateFrom, dateTo,
      scope: (req.query.scope as any) || "general",
      state: req.query.state as string | undefined,
      city: req.query.city as string | undefined,
    });

    const pdf = await generatePredictionPdf({ dateFrom, dateTo, ...result });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="UCM_Prediction_${dateFrom}_${dateTo}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    console.error("getPredictionPdf error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function generateQuarterlyReportHandler(req: AuthRequest, res: Response) {
  try {
    const { quarterKey, clinicId } = req.body;
    if (!quarterKey || !clinicId) return res.status(400).json({ message: "quarterKey and clinicId required" });

    const { periodStart, periodEnd } = getQuarterDates(quarterKey);

    const clinic = await db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, clinicId)).then((r) => r[0]);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const certs = await computeCertifications({ quarterKey, periodStart, periodEnd, computedBy: req.user!.userId });
    const clinicCert = certs.find((c) => c.clinicId === clinicId);

    const rankings = await computeRankings({ quarterKey, periodStart, periodEnd, scope: "national" });
    const clinicRank = rankings.find((r) => r.clinicId === clinicId);

    const auditResults = await computeAuditReadiness({ periodStart, periodEnd, clinicId });
    const clinicAudit = auditResults[0];

    const predictions = await computePredictions({ dateFrom: periodStart, dateTo: periodEnd });
    const clinicPrediction = {
      summaryRed: predictions.lateRisk.summaryRed,
      summaryYellow: predictions.lateRisk.summaryYellow,
      summaryGreen: predictions.lateRisk.summaryGreen,
    };

    const metrics: Record<string, any> = {};
    if (clinicCert) metrics.certification = { certLevel: clinicCert.certLevel, score: clinicCert.score, breakdown: clinicCert.breakdown };
    if (clinicRank) metrics.ranking = { rank: clinicRank.rank, percentile: clinicRank.percentile, score: clinicRank.score };
    if (clinicAudit) metrics.auditReadiness = { score: clinicAudit.score, totalTrips: clinicAudit.totalTrips, completeTrips: clinicAudit.completeTrips };
    metrics.prediction = clinicPrediction;

    const [report] = await db
      .insert(clinicQuarterlyReports)
      .values({ clinicId, quarterKey, periodStart, periodEnd })
      .onConflictDoUpdate({
        target: [clinicQuarterlyReports.clinicId, clinicQuarterlyReports.quarterKey],
        set: { computedAt: new Date() },
      })
      .returning();

    for (const [key, value] of Object.entries(metrics)) {
      await db
        .insert(clinicQuarterlyReportMetrics)
        .values({
          reportId: report.id,
          metricKey: key,
          metricValue: typeof value?.score === "number" ? String(value.score) : null,
          payloadJson: value,
        })
        .onConflictDoUpdate({
          target: [clinicQuarterlyReportMetrics.reportId, clinicQuarterlyReportMetrics.metricKey],
          set: {
            metricValue: typeof value?.score === "number" ? String(value.score) : null,
            payloadJson: value,
          },
        });
    }

    return res.json({ report, metrics });
  } catch (err: any) {
    console.error("generateQuarterlyReport error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function getQuarterlyReportPdfHandler(req: AuthRequest, res: Response) {
  try {
    const quarterKey = req.query.quarter_key as string;
    const clinicId = parseInt(String(req.query.clinic_id));

    if (!quarterKey || !clinicId || isNaN(clinicId)) {
      return res.status(400).json({ message: "quarter_key and clinic_id required" });
    }

    const clinic = await db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, clinicId)).then((r) => r[0]);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    const report = await db
      .select()
      .from(clinicQuarterlyReports)
      .where(and(eq(clinicQuarterlyReports.clinicId, clinicId), eq(clinicQuarterlyReports.quarterKey, quarterKey)))
      .then((r) => r[0]);

    if (!report) return res.status(404).json({ message: "Report not found. Generate it first." });

    const metricRows = await db
      .select()
      .from(clinicQuarterlyReportMetrics)
      .where(eq(clinicQuarterlyReportMetrics.reportId, report.id));

    const metrics: Record<string, any> = {};
    for (const m of metricRows) {
      metrics[m.metricKey] = m.payloadJson;
    }

    const pdf = await generateQuarterlyReportPdf({
      clinicName: clinic.name,
      quarterKey,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      metrics,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="UCM_QuarterlyReport_${clinic.name}_${quarterKey}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    console.error("getQuarterlyReportPdf error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function clinicCertificationHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor || !actor.clinicId) return res.status(404).json({ message: "Not found" });

    const quarterKey = (req.params.quarter_key || req.query.quarter_key) as string;
    if (!quarterKey) return res.status(400).json({ message: "quarter_key required" });

    const access = await checkPublicationAccess("certification", actor.clinicId, quarterKey);
    if (!access.allowed) return res.status(404).json({ message: "Not found" });

    const cert = await db
      .select()
      .from(clinicCertifications)
      .where(and(eq(clinicCertifications.clinicId, actor.clinicId), eq(clinicCertifications.quarterKey, quarterKey)))
      .then((r) => r[0]);

    if (!cert) return res.status(404).json({ message: "Not found" });

    const clinic = await db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, actor.clinicId)).then((r) => r[0]);

    return res.json({
      certification: {
        ...cert,
        clinicName: clinic?.name || "Unknown",
      },
      config: access.config,
    });
  } catch (err: any) {
    console.error("clinicCertification error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function clinicCertificationPdfHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor || !actor.clinicId) return res.status(404).json({ message: "Not found" });

    const quarterKey = req.params.quarter_key as string;
    if (!quarterKey) return res.status(400).json({ message: "quarter_key required" });

    const access = await checkPublicationAccess("certification", actor.clinicId, quarterKey);
    if (!access.allowed) return res.status(404).json({ message: "Not found" });
    if (!access.config.allow_pdf_download) return res.status(403).json({ message: "PDF download not enabled" });

    const cert = await db
      .select()
      .from(clinicCertifications)
      .where(and(eq(clinicCertifications.clinicId, actor.clinicId), eq(clinicCertifications.quarterKey, quarterKey)))
      .then((r) => r[0]);

    if (!cert) return res.status(404).json({ message: "Not found" });

    const clinic = await db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, actor.clinicId)).then((r) => r[0]);

    const pdf = await generateCertificationPdf({
      quarterKey,
      certifications: [{
        clinicName: clinic?.name || "Unknown",
        certLevel: cert.certLevel,
        score: Number(cert.score),
        breakdown: cert.breakdownJson,
      }],
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="UCM_Certification_${quarterKey}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    console.error("clinicCertificationPdf error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function clinicRankingHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor || !actor.clinicId) return res.status(404).json({ message: "Not found" });

    const quarterKey = (req.params.quarter_key || req.query.quarter_key) as string;
    const scope = (req.query.scope as string) || "national";
    if (!quarterKey) return res.status(400).json({ message: "quarter_key required" });

    const access = await checkPublicationAccess("ranking", actor.clinicId, quarterKey);
    if (!access.allowed) return res.status(404).json({ message: "Not found" });

    const ranking = await db
      .select()
      .from(quarterlyRankings)
      .where(and(eq(quarterlyRankings.quarterKey, quarterKey), eq(quarterlyRankings.scope, scope)))
      .then((r) => r[0]);

    if (!ranking) return res.status(404).json({ message: "Not found" });

    const myEntry = await db
      .select()
      .from(quarterlyRankingEntries)
      .where(and(eq(quarterlyRankingEntries.rankingId, ranking.id), eq(quarterlyRankingEntries.clinicId, actor.clinicId)))
      .then((r) => r[0]);

    if (!myEntry) return res.status(404).json({ message: "Not found" });

    let topEntries: any[] = [];
    if (access.config.show_full_ranking_list) {
      const allEntries = await db
        .select()
        .from(quarterlyRankingEntries)
        .where(eq(quarterlyRankingEntries.rankingId, ranking.id))
        .orderBy(quarterlyRankingEntries.rank);

      topEntries = await Promise.all(
        allEntries.map(async (e) => {
          if (!access.config.show_peer_names && e.clinicId !== actor.clinicId) {
            return { ...e, clinicName: `Clinic (Rank #${e.rank})` };
          }
          const c = await db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, e.clinicId)).then((r) => r[0]);
          return { ...e, clinicName: c?.name || `Clinic #${e.clinicId}` };
        })
      );
    }

    return res.json({
      myRanking: myEntry,
      topEntries: topEntries.length > 0 ? topEntries : undefined,
      config: access.config,
    });
  } catch (err: any) {
    console.error("clinicRanking error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function clinicRankingPdfHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor || !actor.clinicId) return res.status(404).json({ message: "Not found" });

    const quarterKey = req.params.quarter_key as string;
    if (!quarterKey) return res.status(400).json({ message: "quarter_key required" });

    const access = await checkPublicationAccess("ranking", actor.clinicId, quarterKey);
    if (!access.allowed) return res.status(404).json({ message: "Not found" });
    if (!access.config.allow_pdf_download) return res.status(403).json({ message: "PDF download not enabled" });

    const ranking = await db
      .select()
      .from(quarterlyRankings)
      .where(eq(quarterlyRankings.quarterKey, quarterKey))
      .then((r) => r[0]);

    if (!ranking) return res.status(404).json({ message: "Not found" });

    const myEntry = await db
      .select()
      .from(quarterlyRankingEntries)
      .where(and(eq(quarterlyRankingEntries.rankingId, ranking.id), eq(quarterlyRankingEntries.clinicId, actor.clinicId)))
      .then((r) => r[0]);

    if (!myEntry) return res.status(404).json({ message: "Not found" });

    const clinic = await db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, actor.clinicId)).then((r) => r[0]);

    const pdf = await generateRankingPdf({
      quarterKey,
      scope: ranking.scope,
      metricKey: ranking.metricKey,
      entries: [{
        clinicName: clinic?.name || "Unknown",
        rank: myEntry.rank,
        score: Number(myEntry.score),
        percentile: Number(myEntry.percentile),
        payload: myEntry.payloadJson,
      }],
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="UCM_Ranking_${quarterKey}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    console.error("clinicRankingPdf error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function clinicAuditHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor || !actor.clinicId) return res.status(404).json({ message: "Not found" });

    const quarterKey = (req.query.quarter_key as string);
    const access = await checkPublicationAccess("audit", actor.clinicId, quarterKey);
    if (!access.allowed) return res.status(404).json({ message: "Not found" });

    let periodStart: string, periodEnd: string;
    if (quarterKey) {
      const dates = getQuarterDates(quarterKey);
      periodStart = dates.periodStart;
      periodEnd = dates.periodEnd;
    } else {
      periodStart = (req.query.dateFrom as string) || "";
      periodEnd = (req.query.dateTo as string) || "";
    }

    if (!periodStart || !periodEnd) return res.status(400).json({ message: "quarter_key or dateFrom/dateTo required" });

    const results = await computeAuditReadiness({ periodStart, periodEnd, clinicId: actor.clinicId });

    return res.json({
      result: results[0] || null,
      config: access.config,
    });
  } catch (err: any) {
    console.error("clinicAudit error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function clinicAuditPdfHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor || !actor.clinicId) return res.status(404).json({ message: "Not found" });

    const quarterKey = req.params.quarter_key as string;
    if (!quarterKey) return res.status(400).json({ message: "quarter_key required" });

    const access = await checkPublicationAccess("audit", actor.clinicId, quarterKey);
    if (!access.allowed) return res.status(404).json({ message: "Not found" });
    if (!access.config.allow_pdf_download) return res.status(403).json({ message: "PDF download not enabled" });

    const { periodStart, periodEnd } = getQuarterDates(quarterKey);
    const results = await computeAuditReadiness({ periodStart, periodEnd, clinicId: actor.clinicId });

    const pdf = await generateAuditPdf({ periodStart, periodEnd, results });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="UCM_AuditShield_${quarterKey}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    console.error("clinicAuditPdf error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}

export async function clinicQuarterlyReportPdfHandler(req: AuthRequest, res: Response) {
  try {
    const actor = await getActorContext(req);
    if (!actor || !actor.clinicId) return res.status(404).json({ message: "Not found" });

    const quarterKey = req.params.quarter_key as string;
    if (!quarterKey) return res.status(400).json({ message: "quarter_key required" });

    const access = await checkPublicationAccess("certification", actor.clinicId, quarterKey);
    if (!access.allowed) return res.status(404).json({ message: "Not found" });
    if (!access.config.allow_pdf_download) return res.status(403).json({ message: "PDF download not enabled" });

    const report = await db
      .select()
      .from(clinicQuarterlyReports)
      .where(and(eq(clinicQuarterlyReports.clinicId, actor.clinicId), eq(clinicQuarterlyReports.quarterKey, quarterKey)))
      .then((r) => r[0]);

    if (!report) return res.status(404).json({ message: "Not found" });

    const metricRows = await db
      .select()
      .from(clinicQuarterlyReportMetrics)
      .where(eq(clinicQuarterlyReportMetrics.reportId, report.id));

    const metrics: Record<string, any> = {};
    for (const m of metricRows) {
      metrics[m.metricKey] = m.payloadJson;
    }

    const clinic = await db.select({ name: clinics.name }).from(clinics).where(eq(clinics.id, actor.clinicId)).then((r) => r[0]);

    const pdf = await generateQuarterlyReportPdf({
      clinicName: clinic?.name || "Unknown",
      quarterKey,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      metrics,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="UCM_QuarterlyReport_${quarterKey}.pdf"`);
    res.send(pdf);
  } catch (err: any) {
    console.error("clinicQuarterlyReportPdf error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}
