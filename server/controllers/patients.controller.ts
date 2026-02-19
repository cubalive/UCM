import type { Response } from "express";
import { storage } from "../storage";
import { getCompanyIdFromAuth, applyCompanyFilter, type AuthRequest } from "../auth";
import { insertPatientSchema, patients } from "@shared/schema";
import { db } from "../db";
import { eq, and, isNull } from "drizzle-orm";
import { generatePublicId } from "../public-id";
import { enforceCityContext, getAllowedCityId, checkCityAccess } from "../middleware/cityContext";

export async function getPatientsHandler(req: AuthRequest, res: Response) {
  try {
    const user = await storage.getUser(req.user!.userId);
    if ((user?.role === "VIEWER" || user?.role === "CLINIC_USER") && user.clinicId) {
      const clinicPatients = await db.select().from(patients).where(
        and(eq(patients.clinicId, user.clinicId), eq(patients.active, true), isNull(patients.deletedAt))
      ).orderBy(patients.firstName);
      return res.json(clinicPatients);
    }
    const enforced = enforceCityContext(req, res);
    if (enforced === false) return;
    const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
    if (cityId === -1) return res.status(403).json({ message: "Access denied" });
    const companyId = getCompanyIdFromAuth(req);

    const source = req.query.source as string | undefined;
    const conditions: any[] = [isNull(patients.deletedAt), eq(patients.active, true)];
    if (cityId && cityId > 0) conditions.push(eq(patients.cityId, cityId));
    if (companyId) conditions.push(eq(patients.companyId, companyId));

    if (source === "clinic") {
      conditions.push(eq(patients.source, "clinic"));
      const clinicIdFilter = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
      if (clinicIdFilter) conditions.push(eq(patients.clinicId, clinicIdFilter));
    } else if (source === "internal") {
      conditions.push(eq(patients.source, "internal"));
    } else if (source === "private") {
      conditions.push(eq(patients.source, "private"));
    }

    const result = await db.select().from(patients).where(and(...conditions)).orderBy(patients.firstName);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getPatientClinicGroupsHandler(req: AuthRequest, res: Response) {
  try {
    const enforced = enforceCityContext(req, res);
    if (enforced === false) return;
    const cityId = enforced !== undefined ? enforced : await getAllowedCityId(req);
    if (cityId === -1) return res.status(403).json({ message: "Access denied" });
    const companyId = getCompanyIdFromAuth(req);

    const conditions: any[] = [isNull(patients.deletedAt), eq(patients.active, true), eq(patients.source, "clinic")];
    if (cityId && cityId > 0) conditions.push(eq(patients.cityId, cityId));
    if (companyId) conditions.push(eq(patients.companyId, companyId));

    const clinicPatients = await db.select().from(patients).where(and(...conditions)).orderBy(patients.firstName);

    const allClinics = await storage.getClinics(cityId || undefined);
    const filteredClinics = applyCompanyFilter(allClinics, companyId).filter((c: any) => !c.deletedAt);

    const groups = filteredClinics.map((clinic: any) => {
      const pts = clinicPatients.filter((p: any) => p.clinicId === clinic.id);
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
    const user = await storage.getUser(req.user!.userId);
    if ((user?.role === "VIEWER" || user?.role === "CLINIC_USER") && user.clinicId) {
      const clinic = await storage.getClinic(user.clinicId);
      if (!clinic) return res.status(403).json({ message: "No clinic linked" });
      req.body.clinicId = user.clinicId;
      req.body.cityId = clinic.cityId;
    }
    const parsed = insertPatientSchema.omit({ publicId: true }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid patient data" });
    }
    if (parsed.data.address && !parsed.data.addressZip) {
      return res.status(400).json({ message: "ZIP code is required when providing an address" });
    }
    if (parsed.data.address && (parsed.data.lat == null || parsed.data.lng == null)) {
      return res.status(400).json({ message: "Address must be selected from autocomplete (lat/lng required)" });
    }
    if (!(await checkCityAccess(req, parsed.data.cityId))) {
      return res.status(403).json({ message: "No access to this city" });
    }
    const publicId = await generatePublicId();
    const callerCompanyId = getCompanyIdFromAuth(req);
    if (parsed.data.clinicId) {
      const clinic = await storage.getClinic(parsed.data.clinicId);
      if (!clinic) return res.status(400).json({ message: "Selected clinic not found" });
      if (clinic.deletedAt || !clinic.active) return res.status(400).json({ message: "Cannot assign patient to an archived clinic" });
      if (callerCompanyId && clinic.companyId && clinic.companyId !== callerCompanyId) {
        return res.status(403).json({ message: "Clinic does not belong to your company" });
      }
    }
    const autoSource = (user?.role === "CLINIC_USER" || user?.role === "VIEWER") && user.clinicId ? "clinic" : "internal";
    const patientData = { ...parsed.data, publicId, companyId: callerCompanyId, source: parsed.data.source || autoSource };
    const effectiveSource = patientData.source;
    if ((effectiveSource === "private" || effectiveSource === "internal") && !patientData.email?.trim()) {
      return res.status(400).json({ message: "Email is required for Private/Internal patients to receive invoices and payment links." });
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
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "Invalid patient ID" });

    const existing = await storage.getPatient(id);
    if (!existing) return res.status(404).json({ message: "Patient not found" });

    const user = await storage.getUser(req.user!.userId);
    if (user?.role === "VIEWER" && user.clinicId) {
      if (existing.clinicId !== user.clinicId) {
        return res.status(403).json({ message: "You can only edit patients belonging to your clinic" });
      }
    }

    if (!(await checkCityAccess(req, existing.cityId))) {
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
      if (!(await checkCityAccess(req, updateData.cityId))) {
        return res.status(403).json({ message: "No access to target city" });
      }
    }

    if (updateData.address !== undefined) {
      if (!updateData.addressZip || !String(updateData.addressZip).trim()) {
        return res.status(400).json({ message: "ZIP code is required when providing an address" });
      }
      if (updateData.lat == null || updateData.lng == null) {
        return res.status(400).json({ message: "Address must be selected from autocomplete (lat/lng required)" });
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
      if ((effectiveSource === "private" || effectiveSource === "internal") && !updateData.email?.trim()) {
        return res.status(400).json({ message: "Email is required for Private/Internal patients." });
      }
    } else {
      const effectiveSource = existing.source;
      if ((effectiveSource === "private" || effectiveSource === "internal") && !existing.email?.trim()) {
        return res.status(400).json({ message: "Email is required for Private/Internal patients. Please add an email address." });
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
