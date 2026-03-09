import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import type { Response } from "express";
import { db } from "../db";
import { ehrConnections, ehrAppointmentSync } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  syncClinicAppointments,
  createTripsFromAppointments,
  checkEhrConnectionHealth,
  matchFhirPatient,
} from "../lib/ehrFhirEngine";

export function registerEhrRoutes(app: Express) {
  // List EHR connections for a clinic
  app.get("/api/ehr/connections", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "CLINIC_ADMIN") as any, async (req: AuthRequest, res: Response) => {
    try {
      const clinicId = parseInt(req.query.clinicId as string);
      if (!clinicId) return res.status(400).json({ message: "clinicId required" });

      const connections = await db.select().from(ehrConnections)
        .where(eq(ehrConnections.clinicId, clinicId))
        .orderBy(desc(ehrConnections.createdAt));
      res.json(connections.map(c => ({ ...c, clientSecret: c.clientSecret ? "***" : null, accessToken: undefined, refreshToken: undefined })));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Create a new EHR connection
  app.post("/api/ehr/connections", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN") as any, async (req: AuthRequest, res: Response) => {
    try {
      const { clinicId, companyId, provider, fhirBaseUrl, clientId, clientSecret, scopes } = req.body;
      if (!clinicId || !provider || !fhirBaseUrl) {
        return res.status(400).json({ message: "clinicId, provider, and fhirBaseUrl are required" });
      }

      const [conn] = await db.insert(ehrConnections).values({
        clinicId,
        companyId: companyId || null,
        provider: provider.toUpperCase(),
        fhirBaseUrl,
        clientId: clientId || null,
        clientSecret: clientSecret || null,
        scopes: scopes || null,
        status: "pending",
      }).returning();

      res.status(201).json(conn);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Trigger sync for a connection
  app.post("/api/ehr/connections/:id/sync", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "CLINIC_ADMIN") as any, async (req: AuthRequest, res: Response) => {
    try {
      const connectionId = parseInt(req.params.id as string);
      const result = await syncClinicAppointments(connectionId);
      const tripResult = await createTripsFromAppointments(
        (await db.select({ clinicId: ehrConnections.clinicId }).from(ehrConnections).where(eq(ehrConnections.id, connectionId)))[0]?.clinicId || 0
      );
      res.json({ ok: true, sync: result, trips: tripResult });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Health check for a connection
  app.get("/api/ehr/connections/:id/health", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "CLINIC_ADMIN") as any, async (req: AuthRequest, res: Response) => {
    try {
      const connectionId = parseInt(req.params.id as string);
      const health = await checkEhrConnectionHealth(connectionId);
      res.json(health);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // List synced appointments
  app.get("/api/ehr/appointments", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "CLINIC_ADMIN") as any, async (req: AuthRequest, res: Response) => {
    try {
      const clinicId = parseInt(req.query.clinicId as string);
      if (!clinicId) return res.status(400).json({ message: "clinicId required" });

      const appts = await db.select().from(ehrAppointmentSync)
        .where(eq(ehrAppointmentSync.clinicId, clinicId))
        .orderBy(desc(ehrAppointmentSync.appointmentDate))
        .limit(200);
      res.json(appts);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Match a FHIR patient to local patient
  app.post("/api/ehr/match-patient", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "CLINIC_ADMIN") as any, async (req: AuthRequest, res: Response) => {
    try {
      const { connectionId, fhirPatientId } = req.body;
      const localPatientId = await matchFhirPatient(connectionId, fhirPatientId);
      res.json({ matched: !!localPatientId, patientId: localPatientId });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // Update connection
  app.patch("/api/ehr/connections/:id", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN") as any, async (req: AuthRequest, res: Response) => {
    try {
      const connectionId = parseInt(req.params.id as string);
      const { status, fhirBaseUrl, clientId, clientSecret, scopes } = req.body;
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (status) updates.status = status;
      if (fhirBaseUrl) updates.fhirBaseUrl = fhirBaseUrl;
      if (clientId !== undefined) updates.clientId = clientId;
      if (clientSecret !== undefined) updates.clientSecret = clientSecret;
      if (scopes !== undefined) updates.scopes = scopes;

      await db.update(ehrConnections).set(updates).where(eq(ehrConnections.id, connectionId));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });
}
