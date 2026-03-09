import type { Response } from "express";
import { storage } from "../storage";
import { type AuthRequest } from "../auth";
import { insertPatientSchema, patients } from "@shared/schema";
import { db } from "../db";
import { eq, and, isNull, ilike, or, sql } from "drizzle-orm";
import { generatePublicId } from "../public-id";
import { getScope, requireScope, buildScopeFilters, forceCompanyOnCreate } from "../middleware/scopeContext";

export async function getPatientsHandler(req: AuthRequest, res: Response) {
  try {
    const scope = await getScope(req);
    if (!scope) return res.status(401).json({ message: "Unauthorized" });

    const user = await storage.getUser(req.user!.userId);
    if ((user?.role === "VIEWER" || user?.role === "CLINIC_USER") && user.clinicId) {
      const conditions: any[] = [
        eq(patients.clinicId, user.clinicId),
        eq(patients.active, true),
        isNull(patients.deletedAt),
      ];
      if (scope.companyId) conditions.push(eq(patients.companyId, scope.companyId));
      const q = (req.query.q as string)?.trim();
      if (q) {
        const pattern = `%${q}%`;
        conditions.push(or(
          ilike(patients.firstName, pattern),
          ilike(patients.lastName, pattern),
          ilike(patients.phone, pattern),
          ilike(patients.publicId, pattern),
        )!);
      }
      const cPage = parseInt(req.query.page as string) || 1;
      const cLimit = Math.min(parseInt(req.query.limit as string) || 200, 500);
      const cOffset = (cPage - 1) * cLimit;
      const clinicPatients = await db.select().from(patients).where(
        and(...conditions)
      ).orderBy(patients.firstName).limit(cLimit).offset(cOffset);
      return res.json(clinicPatients);
    }

    if (!requireScope(scope, res)) return;
    const filters = buildScopeFilters(scope);

    const source = req.query.source as string | undefined;
    const conditions: any[] = [isNull(patients.deletedAt), eq(patients.active, true)];
    if (filters.companyId) conditions.push(eq(patients.companyId, filters.companyId));
    if (filters.cityId) conditions.push(eq(patients.cityId, filters.cityId));
    if (filters.clinicId) conditions.push(eq(patients.clinicId, filters.clinicId));

    if (source === "clinic") {
      conditions.push(eq(patients.source, "clinic"));
      const clinicIdFilter = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
      if (clinicIdFilter) conditions.push(eq(patients.clinicId, clinicIdFilter));
    } else if (source === "internal") {
      conditions.push(eq(patients.source, "internal"));
    } else if (source === "private") {
      conditions.push(eq(patients.source, "private"));
    }

    const q = (req.query.q as string)?.trim();
    if (q) {
      const pattern = `%${q}%`;
      conditions.push(or(
        ilike(patients.firstName, pattern),
        ilike(patients.lastName, pattern),
        ilike(patients.phone, pattern),
        ilike(patients.publicId, pattern),
      )!);
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 500);
    const offset = (page - 1) * limit;

    const result = await db.select().from(patients).where(and(...conditions)).orderBy(patients.firstName).limit(limit).offset(offset);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getPatientClinicGroupsHandler(req: AuthRequest, res: Response) {
  try {
    const scope = await getScope(req);
    if (!scope) return res.status(401).json({ message: "Unauthorized" });
    if (!requireScope(scope, res)) return;
    const filters = buildScopeFilters(scope);

    const conditions: any[] = [isNull(patients.deletedAt), eq(patients.active, true), eq(patients.source, "clinic")];
    if (filters.companyId) conditions.push(eq(patients.companyId, filters.companyId));
    if (filters.cityId) conditions.push(eq(patients.cityId, filters.cityId));

    const clinicPatients = await db.select().from(patients).where(and(...conditions)).orderBy(patients.firstName).limit(2000);

    const allClinics = await storage.getClinics(filters.cityId || undefined);
    const filteredClinics = (filters.companyId
      ? allClinics.filter((c: any) => c.companyId === filters.companyId)
      : allClinics
    ).filter((c: any) => !c.deletedAt);

    // Group patients by clinicId using Map instead of O(n²) nested filter
    const patientsByClinic = new Map<number, any[]>();
    for (const p of clinicPatients) {
      if (p.clinicId) {
        const arr = patientsByClinic.get(p.clinicId) || [];
        arr.push(p);
        patientsByClinic.set(p.clinicId, arr);
      }
    }

    const groups = filteredClinics.map((clinic: any) => {
      const pts = patientsByClinic.get(clinic.id) || [];
      return {
        clinic_id: clinic.id,
        clinic_name: clinic.name,
        patient_count: pts.length,
        patients: pts,
      };
    }).filter((g: any) => g.patient_count > 0 || true);

    res.json(groups);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function createPatientHandler(req: AuthRequest, res: Response) {
  try {
    const scope = await getScope(req);
    if (!scope) return res.status(401).json({ message: "Unauthorized" });

    const user = await storage.getUser(req.user!.userId);
    if ((user?.role === "VIEWER" || user?.role === "CLINIC_USER" || user?.role === "CLINIC_ADMIN" || user?.role === "CLINIC_VIEWER") && user.clinicId) {
      const clinic = await storage.getClinic(user.clinicId);
      if (!clinic) return res.status(403).json({ message: "No clinic linked" });
      req.body.clinicId = user.clinicId;
      req.body.cityId = clinic.cityId;
      req.body.companyId = clinic.companyId;
      req.body.source = "clinic";
    } else {
      forceCompanyOnCreate(scope, req.body);
    }
    const parsed = insertPatientSchema.omit({ publicId: true }).safeParse(req.body);
    if (!parsed.success) {
      const fieldErrors = parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
      return res.status(400).json({ message: `Invalid patient data: ${fieldErrors}` });
    }
    if (parsed.data.address && !parsed.data.addressZip) {
      return res.status(400).json({ message: "ZIP code is required when providing an address" });
    }
    if (parsed.data.address && (parsed.data.lat == null || parsed.data.lng == null)) {
      try {
        const { geocodeAddress } = await import("../lib/googleMaps");
        const geo = await geocodeAddress(parsed.data.address);
        (parsed.data as any).lat = geo.lat;
        (parsed.data as any).lng = geo.lng;
      } catch (geoErr: any) {
        return res.status(400).json({ message: `Could not geocode patient address: ${geoErr.message}. Please select from autocomplete.` });
      }
    }
    if (!scope.isSuperAdmin && scope.allowedCityIds.length > 0 && !scope.allowedCityIds.includes(parsed.data.cityId)) {
      return res.status(403).json({ message: "No access to this city" });
    }
    const publicId = await generatePublicId();
    const callerCompanyId = scope.companyId;
    if (parsed.data.clinicId) {
      const clinic = await storage.getClinic(parsed.data.clinicId);
      if (!clinic) return res.status(400).json({ message: "Selected clinic not found" });
      if (clinic.deletedAt || !clinic.active) return res.status(400).json({ message: "Cannot assign patient to an archived clinic" });
      if (callerCompanyId && clinic.companyId && clinic.companyId !== callerCompanyId) {
        return res.status(403).json({ message: "Clinic does not belong to your company" });
      }
    }
    const autoSource = (user?.role === "CLINIC_USER" || user?.role === "VIEWER") && user.clinicId ? "clinic" : "internal";
    const effectiveCompanyId = parsed.data.companyId || callerCompanyId;
    if (!effectiveCompanyId) return res.status(400).json({ message: "Company is required to create a patient" });
    const patientData = { ...parsed.data, publicId, companyId: effectiveCompanyId, source: parsed.data.source || autoSource };
    const effectiveSource = patientData.source;
    if (effectiveSource === "private" && !patientData.email?.trim()) {
      return res.status(400).json({ message: "Email is required for Private-pay patients to receive invoices and payment links." });
    }
    if (patientData.email) {
      patientData.email = patientData.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientData.email)) {
        return res.status(400).json({ message: "Invalid email address format." });
      }
    }
    if (patientData.phone) {
      const { normalizePhone } = await import("../lib/twilioSms");
      patientData.phone = normalizePhone(patientData.phone) || patientData.phone;
    }
    const patient = await storage.createPatient(patientData);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CREATE",
      entity: "patient",
      entityId: patient.id,
      details: `Created patient ${patient.firstName} ${patient.lastName}`,
      cityId: patient.cityId,
    });
    res.json(patient);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function updatePatientHandler(req: AuthRequest, res: Response) {
  try {
    const scope = await getScope(req);
    if (!scope) return res.status(401).json({ message: "Unauthorized" });

    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid patient ID" });

    const existing = await storage.getPatient(id);
    if (!existing) return res.status(404).json({ message: "Patient not found" });

    if (!scope.isSuperAdmin && scope.companyId && existing.companyId && existing.companyId !== scope.companyId) {
      return res.status(403).json({ message: "Access denied" });
    }

    const user = await storage.getUser(req.user!.userId);
    if ((user?.role === "VIEWER" || user?.role === "CLINIC_USER") && user.clinicId) {
      if (existing.clinicId !== user.clinicId) {
        return res.status(403).json({ message: "You can only edit patients belonging to your clinic" });
      }
    }

    if (!scope.isSuperAdmin && scope.allowedCityIds.length > 0 && !scope.allowedCityIds.includes(existing.cityId)) {
      return res.status(403).json({ message: "No access to this city" });
    }

    const allowedFields = ["phone", "email", "address", "addressStreet", "addressCity", "addressState", "addressZip", "addressPlaceId", "lat", "lng", "notes", "insuranceId", "wheelchairRequired", "active", "firstName", "lastName", "dateOfBirth", "cityId"];
    const updateData: Record<string, any> = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        updateData[key] = req.body[key];
      }
    }

    if (updateData.cityId && updateData.cityId !== existing.cityId) {
      if (!scope.isSuperAdmin && scope.allowedCityIds.length > 0 && !scope.allowedCityIds.includes(updateData.cityId)) {
        return res.status(403).json({ message: "No access to target city" });
      }
    }

    if (updateData.address !== undefined) {
      if (!updateData.addressZip || !String(updateData.addressZip).trim()) {
        return res.status(400).json({ message: "ZIP code is required when providing an address" });
      }
      if (updateData.lat == null || updateData.lng == null) {
        try {
          const { geocodeAddress } = await import("../lib/googleMaps");
          const geo = await geocodeAddress(updateData.address);
          updateData.lat = geo.lat;
          updateData.lng = geo.lng;
        } catch (geoErr: any) {
          return res.status(400).json({ message: `Could not geocode address: ${geoErr.message}. Please select from autocomplete.` });
        }
      }
    }

    if (updateData.email !== undefined) {
      if (updateData.email) {
        updateData.email = updateData.email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updateData.email)) {
          return res.status(400).json({ message: "Invalid email address format." });
        }
      }
      const effectiveSource = existing.source;
      if (effectiveSource === "private" && !updateData.email?.trim()) {
        return res.status(400).json({ message: "Email is required for Private-pay patients." });
      }
    } else {
      const effectiveSource = existing.source;
      if (effectiveSource === "private" && !existing.email?.trim()) {
        return res.status(400).json({ message: "Email is required for Private-pay patients. Please add an email address." });
      }
    }

    if (updateData.phone) {
      const { normalizePhone } = await import("../lib/twilioSms");
      updateData.phone = normalizePhone(updateData.phone) || updateData.phone;
    }

    const patient = await storage.updatePatient(id, updateData as any);
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "UPDATE",
      entity: "patient",
      entityId: id,
      details: `Updated patient fields: ${Object.keys(updateData).join(", ")}`,
      cityId: patient?.cityId ?? existing.cityId,
    });
    res.json(patient);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getPatientByIdHandler(req: AuthRequest, res: Response) {
  try {
    const scope = await getScope(req);
    if (!scope) return res.status(401).json({ message: "Unauthorized" });

    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid patient ID" });

    const result = await db.select().from(patients).where(eq(patients.id, id));
    if (!result.length) return res.status(404).json({ message: "Patient not found" });

    const patient = result[0];
    if (!scope.isSuperAdmin && scope.companyId && patient.companyId !== scope.companyId) {
      return res.status(403).json({ message: "No access to this patient" });
    }
    if (!scope.isSuperAdmin && scope.allowedCityIds.length > 0 && !scope.allowedCityIds.includes(patient.cityId)) {
      return res.status(403).json({ message: "No access to this patient" });
    }

    res.json(patient);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
