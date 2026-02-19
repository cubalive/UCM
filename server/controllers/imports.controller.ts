import { Request, Response } from "express";
import { db } from "../db";
import { eq, and, desc } from "drizzle-orm";
import {
  importJobs, importJobFiles, importJobEvents, externalIdMap,
  clinics, patients, drivers, vehicles, companies, cities,
} from "@shared/schema";
import { type AuthRequest } from "../auth";
import { generatePublicId } from "../public-id";
import {
  parseFileToRows, applyHeaderMapping, dedupeRows,
  getCanonicalSchema, normalizePhone, normalizeDate, normalizeState,
  normalizeBool, normalizeRowValues, applyDefaults, dryRunEntity,
  generateTemplateCsv, TEMPLATE_HEADERS,
  IMPORT_ENTITIES, type ImportEntity, type EntityDefaults,
} from "../lib/importEngine";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
export const uploadMiddleware = upload.single("file");

export async function createImportJob(req: AuthRequest, res: Response) {
  try {
    const user = req.user!;
    const { companyId, cityId, sourceSystem, consentConfirmed } = req.body;
    if (!companyId || !sourceSystem) {
      return res.status(400).json({ error: "companyId and sourceSystem are required" });
    }
    const company = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company.length) return res.status(404).json({ error: "Company not found" });

    const [job] = await db.insert(importJobs).values({
      companyId,
      cityId: cityId || null,
      sourceSystem,
      createdBy: user.userId,
      consentConfirmed: consentConfirmed !== false,
      status: "draft",
    }).returning();

    await db.insert(importJobEvents).values({
      importJobId: job.id,
      level: "info",
      message: `Import job created for ${sourceSystem}`,
      payload: { companyId, cityId },
    });

    return res.json(job);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

export async function uploadFile(req: AuthRequest, res: Response) {
  try {
    const jobId = req.params.id;
    const entity = req.query.entity as string;
    if (!entity || !IMPORT_ENTITIES.includes(entity as ImportEntity)) {
      return res.status(400).json({ error: `entity must be one of: ${IMPORT_ENTITIES.join(", ")}` });
    }

    const job = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
    if (!job.length) return res.status(404).json({ error: "Import job not found" });
    if (!["draft", "validated"].includes(job[0].status)) {
      return res.status(400).json({ error: "Job must be in draft or validated status to upload files" });
    }

    const file = (req as any).file as Express.Multer.File;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const existing = await db.select().from(importJobFiles)
      .where(and(eq(importJobFiles.importJobId, jobId), eq(importJobFiles.entity, entity)));
    if (existing.length) {
      await db.delete(importJobFiles).where(eq(importJobFiles.id, existing[0].id));
    }

    const base64 = file.buffer.toString("base64");
    const [saved] = await db.insert(importJobFiles).values({
      importJobId: jobId,
      entity,
      filename: file.originalname,
      mimeType: file.mimetype,
      storageJson: { base64, size: file.size },
    }).returning();

    await db.update(importJobs).set({ status: "draft", updatedAt: new Date() }).where(eq(importJobs.id, jobId));

    await db.insert(importJobEvents).values({
      importJobId: jobId,
      level: "info",
      message: `File uploaded for ${entity}: ${file.originalname}`,
    });

    return res.json({ id: saved.id, entity, filename: file.originalname, size: file.size });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

export async function dryRunImport(req: AuthRequest, res: Response) {
  try {
    const jobId = req.params.id;
    const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job) return res.status(404).json({ error: "Import job not found" });

    const files = await db.select().from(importJobFiles).where(eq(importJobFiles.importJobId, jobId));
    if (!files.length) return res.status(400).json({ error: "No files uploaded yet" });

    const defaultCity = await getDefaultCityName(job.cityId);
    const defaults: EntityDefaults = { defaultCity };
    const results: Record<string, any> = {};

    for (const file of files) {
      const entity = file.entity as ImportEntity;
      const storage = file.storageJson as any;
      const buffer = Buffer.from(storage.base64, "base64");

      let rows: Record<string, any>[];
      try {
        rows = parseFileToRows(buffer, file.filename, file.mimeType);
      } catch (parseErr: any) {
        results[entity] = {
          entity,
          headerInfo: { detected: [], mapped: {}, unmapped: [] },
          totalRows: 0, validRows: 0, errorRows: 1, duplicateRows: 0,
          missingRequiredFields: [],
          rowErrors: [{ row: 0, field: "file", message: `Parse error: ${parseErr.message}` }],
          preview: [],
        };
        continue;
      }

      results[entity] = dryRunEntity(entity, rows, defaults);
    }

    await db.insert(importJobEvents).values({
      importJobId: jobId,
      level: "info",
      message: `Dry run completed`,
      payload: { entities: Object.keys(results) },
    });

    return res.json({ status: "dry_run", results });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

export async function downloadTemplate(req: AuthRequest, res: Response) {
  try {
    const entity = req.params.entity as string;
    if (!IMPORT_ENTITIES.includes(entity as ImportEntity)) {
      return res.status(400).json({ error: `entity must be one of: ${IMPORT_ENTITIES.join(", ")}` });
    }

    const csv = generateTemplateCsv(entity as ImportEntity);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${entity}_template.csv"`);
    return res.send(csv);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

export async function validateImport(req: AuthRequest, res: Response) {
  try {
    const jobId = req.params.id;
    const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job) return res.status(404).json({ error: "Import job not found" });
    if (!["draft", "validated"].includes(job.status)) {
      return res.status(400).json({ error: "Job must be in draft status to validate" });
    }

    const files = await db.select().from(importJobFiles).where(eq(importJobFiles.importJobId, jobId));
    if (!files.length) return res.status(400).json({ error: "No files uploaded yet" });

    const defaultCity = await getDefaultCityName(job.cityId);
    const defaults: EntityDefaults = { defaultCity };
    const counts: Record<string, { ok: number; error: number; skipped: number }> = {};
    const preview: Record<string, any[]> = {};
    const allErrors: { entity: string; row: number; errors: string[] }[] = [];

    for (const file of files) {
      const entity = file.entity as ImportEntity;
      const storage = file.storageJson as any;
      const buffer = Buffer.from(storage.base64, "base64");

      let rows: Record<string, any>[];
      try {
        rows = parseFileToRows(buffer, file.filename, file.mimeType);
      } catch (parseErr: any) {
        counts[entity] = { ok: 0, error: 1, skipped: 0 };
        allErrors.push({ entity, row: 0, errors: [parseErr.message] });
        await db.insert(importJobEvents).values({
          importJobId: jobId, level: "error",
          message: `Parse error for ${entity}: ${parseErr.message}`,
        });
        continue;
      }

      const { mapped, headerInfo } = applyHeaderMapping(rows, entity);
      const { unique, duplicates } = dedupeRows(mapped, entity);

      const schema = getCanonicalSchema(entity);
      let ok = 0, errorCount = 0;
      const validRows: any[] = [];

      for (let i = 0; i < unique.length; i++) {
        const withDefaults = applyDefaults(unique[i], entity, i, defaults);
        const row = normalizeRowValues(withDefaults, entity);
        const result = schema.safeParse(row);
        if (result.success) {
          ok++;
          validRows.push(row);
        } else {
          errorCount++;
          const errs = result.error.issues.map(iss => `${entity} row ${i + 1}: ${iss.path.join(".")} ${iss.message}`);
          allErrors.push({ entity, row: i + 1, errors: errs });
          await db.insert(importJobEvents).values({
            importJobId: jobId, level: "warn",
            message: errs[0] || `Row ${i + 1} in ${entity} has validation errors`,
            payload: { row: i + 1, errors: errs, unmappedHeaders: headerInfo.unmapped },
          });
        }
      }

      counts[entity] = { ok, error: errorCount, skipped: duplicates };
      preview[entity] = validRows.slice(0, 20);
    }

    const summary = { counts, totalErrors: allErrors.length, preview };
    await db.update(importJobs).set({
      status: "validated",
      summaryJson: summary,
      updatedAt: new Date(),
    }).where(eq(importJobs.id, jobId));

    await db.insert(importJobEvents).values({
      importJobId: jobId, level: "info",
      message: `Validation complete`,
      payload: { counts },
    });

    return res.json({ status: "validated", counts, preview, errors: allErrors.slice(0, 100) });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

export async function runImport(req: AuthRequest, res: Response) {
  try {
    const jobId = req.params.id;
    const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job) return res.status(404).json({ error: "Import job not found" });
    if (job.status !== "validated") {
      return res.status(400).json({ error: "Job must be validated before running" });
    }

    await db.update(importJobs).set({ status: "running", updatedAt: new Date() }).where(eq(importJobs.id, jobId));

    const files = await db.select().from(importJobFiles).where(eq(importJobFiles.importJobId, jobId));
    const entityOrder: ImportEntity[] = ["clinics", "patients", "drivers", "vehicles"];
    const results: Record<string, { inserted: number; updated: number; errors: number }> = {};
    const insertedIds: { entity: string; id: number }[] = [];

    const cityId = job.cityId || (await getDefaultCityId());
    const defaultCity = await getDefaultCityName(job.cityId);
    const defaults: EntityDefaults = { defaultCity };

    try {
      for (const entity of entityOrder) {
        const file = files.find(f => f.entity === entity);
        if (!file) continue;

        const storage = file.storageJson as any;
        const buffer = Buffer.from(storage.base64, "base64");
        const rows = parseFileToRows(buffer, file.filename, file.mimeType);
        const { mapped } = applyHeaderMapping(rows, entity);
        const { unique } = dedupeRows(mapped, entity);

        let inserted = 0, updated = 0, errors = 0;

        for (let i = 0; i < unique.length; i++) {
          const withDefaults = applyDefaults(unique[i], entity, i, defaults);
          const row = normalizeRowValues(withDefaults, entity);
          const schema = getCanonicalSchema(entity);
          const validation = schema.safeParse(row);
          if (!validation.success) {
            errors++;
            const errs = validation.error.issues.map(iss => `${iss.path.join(".")}: ${iss.message}`);
            await db.insert(importJobEvents).values({
              importJobId: jobId, level: "error",
              message: `${entity} row ${i + 1}: ${errs.join("; ")}`,
              payload: { row: i + 1, errors: errs },
            });
            continue;
          }

          try {
            const result = await upsertRow(entity, row, job.companyId, job.sourceSystem, cityId, insertedIds);
            if (result === "inserted") inserted++;
            else if (result === "updated") updated++;
          } catch (rowErr: any) {
            errors++;
            await db.insert(importJobEvents).values({
              importJobId: jobId, level: "error",
              message: `${entity} row ${i + 1}: ${rowErr.message}`,
              payload: { row: i + 1, data: row },
            });
          }
        }

        results[entity] = { inserted, updated, errors };
        await db.insert(importJobEvents).values({
          importJobId: jobId, level: "info",
          message: `${entity}: ${inserted} inserted, ${updated} updated, ${errors} errors`,
        });
      }

      await db.update(importJobs).set({
        status: "completed",
        summaryJson: { results, insertedIds },
        updatedAt: new Date(),
      }).where(eq(importJobs.id, jobId));

      return res.json({ status: "completed", results });
    } catch (e: any) {
      await db.update(importJobs).set({ status: "failed", updatedAt: new Date() }).where(eq(importJobs.id, jobId));
      await db.insert(importJobEvents).values({
        importJobId: jobId, level: "error",
        message: `Import failed: ${e.message}`,
      });
      return res.status(500).json({ error: e.message });
    }
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

async function getDefaultCityId(): Promise<number> {
  const [city] = await db.select().from(cities).limit(1);
  return city?.id || 1;
}

async function getDefaultCityName(cityId: number | null): Promise<string> {
  if (cityId) {
    const [city] = await db.select().from(cities).where(eq(cities.id, cityId));
    if (city) return city.name;
  }
  return "Las Vegas";
}

async function upsertRow(
  entity: ImportEntity, row: Record<string, any>,
  companyId: number, sourceSystem: string, cityId: number,
  insertedIds: { entity: string; id: number }[]
): Promise<"inserted" | "updated"> {
  if (row.external_id) {
    const [existing] = await db.select().from(externalIdMap)
      .where(and(
        eq(externalIdMap.companyId, companyId),
        eq(externalIdMap.entity, entity),
        eq(externalIdMap.sourceSystem, sourceSystem),
        eq(externalIdMap.externalId, String(row.external_id)),
      ));
    if (existing) {
      await updateEntity(entity, existing.ucmId, row);
      return "updated";
    }
  }

  const naturalMatch = await findNaturalMatch(entity, row, companyId, cityId);
  if (naturalMatch) {
    await updateEntity(entity, naturalMatch, row);
    if (row.external_id) {
      await db.insert(externalIdMap).values({
        companyId, entity, sourceSystem,
        externalId: String(row.external_id),
        ucmId: naturalMatch,
      }).onConflictDoNothing();
    }
    return "updated";
  }

  const newId = await insertEntity(entity, row, companyId, cityId);
  insertedIds.push({ entity, id: newId });
  if (row.external_id) {
    await db.insert(externalIdMap).values({
      companyId, entity, sourceSystem,
      externalId: String(row.external_id),
      ucmId: newId,
    }).onConflictDoNothing();
  }
  return "inserted";
}

async function findNaturalMatch(entity: ImportEntity, row: Record<string, any>, companyId: number, cityId: number): Promise<number | null> {
  switch (entity) {
    case "clinics": {
      if (row.name) {
        const matches = await db.select().from(clinics)
          .where(and(eq(clinics.name, row.name), eq(clinics.cityId, cityId)));
        if (matches.length === 1) return matches[0].id;
      }
      if (row.email) {
        const matches = await db.select().from(clinics).where(eq(clinics.email, row.email));
        if (matches.length === 1) return matches[0].id;
      }
      return null;
    }
    case "patients": {
      if (row.phone) {
        const matches = await db.select().from(patients)
          .where(and(eq(patients.phone, row.phone), eq(patients.cityId, cityId)));
        if (matches.length === 1) return matches[0].id;
      }
      if (row.first_name && row.last_name && row.date_of_birth) {
        const matches = await db.select().from(patients)
          .where(and(
            eq(patients.firstName, row.first_name),
            eq(patients.lastName, row.last_name),
            eq(patients.dateOfBirth, row.date_of_birth),
          ));
        if (matches.length === 1) return matches[0].id;
      }
      return null;
    }
    case "drivers": {
      if (row.phone) {
        const matches = await db.select().from(drivers).where(eq(drivers.phone, row.phone));
        if (matches.length === 1) return matches[0].id;
      }
      if (row.email) {
        const matches = await db.select().from(drivers).where(eq(drivers.email, row.email));
        if (matches.length === 1) return matches[0].id;
      }
      return null;
    }
    case "vehicles": {
      if (row.license_plate) {
        const matches = await db.select().from(vehicles).where(eq(vehicles.licensePlate, row.license_plate));
        if (matches.length === 1) return matches[0].id;
      }
      return null;
    }
  }
}

async function updateEntity(entity: ImportEntity, id: number, row: Record<string, any>): Promise<void> {
  switch (entity) {
    case "clinics": {
      const data: any = {};
      if (row.name) data.name = row.name;
      if (row.address) data.address = row.address;
      if (row.address_street) data.addressStreet = row.address_street;
      if (row.address_city) data.addressCity = row.address_city;
      if (row.address_state) data.addressState = row.address_state;
      if (row.address_zip) data.addressZip = row.address_zip;
      if (row.phone) data.phone = row.phone;
      if (row.contact_name) data.contactName = row.contact_name;
      if (Object.keys(data).length) await db.update(clinics).set(data).where(eq(clinics.id, id));
      break;
    }
    case "patients": {
      const data: any = {};
      if (row.first_name) data.firstName = row.first_name;
      if (row.last_name) data.lastName = row.last_name;
      if (row.phone) data.phone = row.phone;
      if (row.address) data.address = row.address;
      if (row.address_street) data.addressStreet = row.address_street;
      if (row.address_city) data.addressCity = row.address_city;
      if (row.address_state) data.addressState = row.address_state;
      if (row.address_zip) data.addressZip = row.address_zip;
      if (row.date_of_birth) data.dateOfBirth = row.date_of_birth;
      if (row.insurance_id) data.insuranceId = row.insurance_id;
      if (row.notes) data.notes = row.notes;
      if (row.wheelchair_required !== undefined) data.wheelchairRequired = row.wheelchair_required;
      if (Object.keys(data).length) await db.update(patients).set(data).where(eq(patients.id, id));
      break;
    }
    case "drivers": {
      const data: any = {};
      if (row.first_name) data.firstName = row.first_name;
      if (row.last_name) data.lastName = row.last_name;
      if (row.phone) data.phone = row.phone;
      if (row.license_number) data.licenseNumber = row.license_number;
      if (Object.keys(data).length) await db.update(drivers).set(data).where(eq(drivers.id, id));
      break;
    }
    case "vehicles": {
      const data: any = {};
      if (row.name) data.name = row.name;
      if (row.license_plate) data.licensePlate = row.license_plate;
      if (row.make) data.make = row.make;
      if (row.model) data.model = row.model;
      if (row.year) data.year = typeof row.year === "number" ? row.year : parseInt(row.year);
      if (row.capacity) data.capacity = typeof row.capacity === "number" ? row.capacity : parseInt(row.capacity);
      if (row.wheelchair_accessible !== undefined) data.wheelchairAccessible = row.wheelchair_accessible;
      if (row.capability) data.capability = row.capability;
      if (row.color) data.colorHex = row.color;
      if (Object.keys(data).length) await db.update(vehicles).set(data).where(eq(vehicles.id, id));
      break;
    }
  }
}

async function insertEntity(entity: ImportEntity, row: Record<string, any>, companyId: number, cityId: number): Promise<number> {
  const publicId = await generatePublicId();
  switch (entity) {
    case "clinics": {
      const [rec] = await db.insert(clinics).values({
        publicId, cityId, companyId,
        name: row.name,
        address: row.address || "N/A",
        addressStreet: row.address_street,
        addressCity: row.address_city,
        addressState: row.address_state,
        addressZip: row.address_zip,
        email: row.email || null,
        phone: row.phone || null,
        contactName: row.contact_name || null,
        facilityType: row.facility_type || "clinic",
      }).returning();
      return rec.id;
    }
    case "patients": {
      const [rec] = await db.insert(patients).values({
        publicId, cityId, companyId,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone || null,
        email: row.email || null,
        address: row.address || null,
        addressStreet: row.address_street,
        addressCity: row.address_city,
        addressState: row.address_state,
        addressZip: row.address_zip,
        dateOfBirth: row.date_of_birth || null,
        insuranceId: row.insurance_id || null,
        wheelchairRequired: row.wheelchair_required || false,
        notes: row.notes || null,
        clinicId: row._resolvedClinicId || null,
      }).returning();
      return rec.id;
    }
    case "drivers": {
      const [rec] = await db.insert(drivers).values({
        publicId, cityId, companyId,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone,
        email: row.email || null,
        licenseNumber: row.license_number || null,
        status: row.status || "ACTIVE",
      }).returning();
      return rec.id;
    }
    case "vehicles": {
      const [rec] = await db.insert(vehicles).values({
        publicId, cityId, companyId,
        name: row.name,
        licensePlate: row.license_plate,
        colorHex: row.color || "#3B82F6",
        make: row.make || null,
        model: row.model || null,
        makeText: row.make || null,
        modelText: row.model || null,
        year: row.year ? (typeof row.year === "number" ? row.year : parseInt(row.year)) : null,
        capacity: row.capacity ? (typeof row.capacity === "number" ? row.capacity : parseInt(row.capacity)) : 4,
        wheelchairAccessible: row.wheelchair_accessible || false,
        capability: row.capability || "SEDAN",
        status: row.status || "ACTIVE",
      }).returning();
      return rec.id;
    }
  }
}

export async function rollbackImport(req: AuthRequest, res: Response) {
  try {
    const jobId = req.params.id;
    const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job) return res.status(404).json({ error: "Import job not found" });
    if (!["completed", "failed"].includes(job.status)) {
      return res.status(400).json({ error: "Only completed or failed jobs can be rolled back" });
    }

    const summary = job.summaryJson as any;
    const insertedIds: { entity: string; id: number }[] = summary?.insertedIds || [];

    if (!insertedIds.length) {
      await db.update(importJobs).set({ status: "rolled_back", updatedAt: new Date() }).where(eq(importJobs.id, jobId));
      return res.json({ status: "rolled_back", removed: 0 });
    }

    let removed = 0;
    const entityOrder: ImportEntity[] = ["vehicles", "drivers", "patients", "clinics"];

    for (const entity of entityOrder) {
      const ids = insertedIds.filter(r => r.entity === entity).map(r => r.id);
      if (!ids.length) continue;

      for (const id of ids) {
        try {
          switch (entity) {
            case "clinics": await db.delete(clinics).where(eq(clinics.id, id)); break;
            case "patients": await db.delete(patients).where(eq(patients.id, id)); break;
            case "drivers": await db.delete(drivers).where(eq(drivers.id, id)); break;
            case "vehicles": await db.delete(vehicles).where(eq(vehicles.id, id)); break;
          }
          removed++;
        } catch (delErr: any) {
          await db.insert(importJobEvents).values({
            importJobId: jobId, level: "warn",
            message: `Could not rollback ${entity} id=${id}: ${delErr.message}`,
          });
        }
      }

      for (const id of ids) {
        await db.delete(externalIdMap).where(
          and(eq(externalIdMap.entity, entity), eq(externalIdMap.ucmId, id))
        );
      }
    }

    await db.update(importJobs).set({ status: "rolled_back", updatedAt: new Date() }).where(eq(importJobs.id, jobId));
    await db.insert(importJobEvents).values({
      importJobId: jobId, level: "info",
      message: `Rollback complete: ${removed} records removed`,
    });

    return res.json({ status: "rolled_back", removed });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

export async function listImportJobs(req: AuthRequest, res: Response) {
  try {
    const jobs = await db.select().from(importJobs).orderBy(desc(importJobs.createdAt)).limit(100);
    return res.json(jobs);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

export async function getImportJob(req: AuthRequest, res: Response) {
  try {
    const jobId = req.params.id;
    const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job) return res.status(404).json({ error: "Import job not found" });

    const files = await db.select({
      id: importJobFiles.id,
      entity: importJobFiles.entity,
      filename: importJobFiles.filename,
      mimeType: importJobFiles.mimeType,
      createdAt: importJobFiles.createdAt,
    }).from(importJobFiles).where(eq(importJobFiles.importJobId, jobId));

    const events = await db.select().from(importJobEvents)
      .where(eq(importJobEvents.importJobId, jobId))
      .orderBy(desc(importJobEvents.createdAt))
      .limit(200);

    return res.json({ ...job, files, events });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
