import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import type { Response } from "express";
import { db } from "../db";
import { complianceDocuments, complianceAlerts } from "@shared/schema";
import { eq, and, desc, isNull } from "drizzle-orm";
import {
  getEntityCompliance,
  getCompanyComplianceSummary,
  generateComplianceAlerts,
  isDriverDispatchEligible,
  DOCUMENT_REQUIREMENTS,
} from "../lib/complianceEngine";

export function registerComplianceRoutes(app: Express) {
  // Get document requirements list
  app.get("/api/compliance/requirements", authMiddleware, async (_req: AuthRequest, res: Response) => {
    res.json(DOCUMENT_REQUIREMENTS);
  });

  // Get company compliance summary
  app.get("/api/compliance/summary/:companyId", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN") as any, async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(req.params.companyId as string);
      // Enforce tenant: non-SUPER_ADMIN can only access their own company
      if (req.user!.role !== "SUPER_ADMIN" && req.user!.companyId && req.user!.companyId !== companyId) {
        return res.status(403).json({ message: "Access denied: wrong company" });
      }
      const summary = await getCompanyComplianceSummary(companyId);
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get entity compliance report
  app.get("/api/compliance/:entityType/:entityId", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const entityType = req.params.entityType as string;
      const entityId = req.params.entityId as string;
      // Use the user's own companyId, falling back to query param only for SUPER_ADMIN
      const companyId = req.user!.role === "SUPER_ADMIN"
        ? parseInt(req.query.companyId as string) || req.user!.companyId
        : req.user!.companyId;
      if (!companyId) return res.status(400).json({ message: "companyId required" });

      const report = await getEntityCompliance(
        entityType as "driver" | "vehicle",
        parseInt(entityId),
        companyId
      );
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Check driver dispatch eligibility
  app.get("/api/compliance/driver/:driverId/eligible", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const driverId = parseInt(req.params.driverId as string);
      const companyId = req.user!.role === "SUPER_ADMIN"
        ? parseInt(req.query.companyId as string) || req.user!.companyId
        : req.user!.companyId;
      if (!companyId) return res.status(400).json({ message: "companyId required" });

      const result = await isDriverDispatchEligible(driverId, companyId);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // List documents for an entity
  app.get("/api/compliance/documents/:entityType/:entityId", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const entityType = req.params.entityType as string;
      const entityId = req.params.entityId as string;
      const companyId = parseInt(req.query.companyId as string);
      if (!companyId) return res.status(400).json({ message: "companyId required" });

      const docs = await db.select().from(complianceDocuments).where(
        and(
          eq(complianceDocuments.entityType, entityType),
          eq(complianceDocuments.entityId, parseInt(entityId)),
          eq(complianceDocuments.companyId, companyId)
        )
      ).orderBy(desc(complianceDocuments.createdAt));
      res.json(docs);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Add/update a compliance document
  app.post("/api/compliance/documents", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN") as any, async (req: AuthRequest, res: Response) => {
    try {
      const { companyId, entityType, entityId, documentType, documentNumber, issuedAt, expiresAt, fileUrl, notes } = req.body;
      if (!companyId || !entityType || !entityId || !documentType) {
        return res.status(400).json({ message: "companyId, entityType, entityId, documentType required" });
      }

      // Check if document exists, update if so
      const [existing] = await db.select().from(complianceDocuments).where(
        and(
          eq(complianceDocuments.entityType, entityType),
          eq(complianceDocuments.entityId, entityId),
          eq(complianceDocuments.companyId, companyId),
          eq(complianceDocuments.documentType, documentType)
        )
      );

      const docData = {
        documentNumber: documentNumber || null,
        issuedAt: issuedAt || null,
        expiresAt: expiresAt || null,
        fileUrl: fileUrl || null,
        notes: notes || null,
        status: "valid" as const,
        verifiedBy: req.user!.userId,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      };

      // Auto-determine status based on expiry
      if (expiresAt) {
        const expiryDate = new Date(expiresAt);
        const daysUntil = Math.ceil((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        if (daysUntil < 0) docData.status = "expired" as any;
        else if (daysUntil <= 30) docData.status = "expiring_soon" as any;
      }

      if (existing) {
        await db.update(complianceDocuments).set(docData).where(eq(complianceDocuments.id, existing.id));
        res.json({ ok: true, id: existing.id, updated: true });
      } else {
        const [doc] = await db.insert(complianceDocuments).values({
          companyId,
          entityType,
          entityId,
          documentType,
          ...docData,
        }).returning();
        res.status(201).json({ ok: true, id: doc.id, created: true });
      }
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Delete a compliance document
  app.delete("/api/compliance/documents/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN") as any, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      await db.delete(complianceDocuments).where(eq(complianceDocuments.id, id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Get compliance alerts
  app.get("/api/compliance/alerts/:companyId", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(req.params.companyId as string);
      const acknowledged = req.query.acknowledged === "true";

      const alerts = await db.select().from(complianceAlerts).where(
        and(
          eq(complianceAlerts.companyId, companyId),
          eq(complianceAlerts.acknowledged, acknowledged)
        )
      ).orderBy(desc(complianceAlerts.createdAt)).limit(100);
      res.json(alerts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Acknowledge an alert
  app.patch("/api/compliance/alerts/:id/acknowledge", authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const id = parseInt(req.params.id as string);
      await db.update(complianceAlerts).set({
        acknowledged: true,
        acknowledgedBy: req.user!.userId,
        acknowledgedAt: new Date(),
      }).where(eq(complianceAlerts.id, id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Trigger compliance alert generation
  app.post("/api/compliance/alerts/generate/:companyId", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN") as any, async (req: AuthRequest, res: Response) => {
    try {
      const companyId = parseInt(req.params.companyId as string);
      const count = await generateComplianceAlerts(companyId);
      res.json({ ok: true, alertsCreated: count });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
