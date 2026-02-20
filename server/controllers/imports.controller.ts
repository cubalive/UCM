import { Request, Response } from "express";
import { db } from "../db";
import { getDbSource } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
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

const importProgress = new Map<string, { phase: string; entity: string; current: number; total: number; results: Record<string, any> }>();

export async function runImport(req: AuthRequest, res: Response) {
  try {
    const jobId = req.params.id;
    const user = req.user!;
    const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job) return res.status(404).json({ error: "Import job not found" });

    const [company] = await db.select().from(companies).where(eq(companies.id, job.companyId));
    if (!company) {
      console.error(`[IMPORT] HARD_FAIL job=${jobId} companyId=${job.companyId} does not exist in companies table`);
      return res.status(400).json({ ok: false, error: `Company ${job.companyId} does not exist. Import aborted.` });
    }

    console.log(JSON.stringify({
      event: "import_start",
      jobId,
      companyId: job.companyId,
      companyName: company.name,
      userId: user.userId,
      role: user.role,
      sourceSystem: job.sourceSystem,
      dbProvider: getDbSource(),
    }));

    if (job.status === "running") {
      const stuckMinutes = (Date.now() - new Date(job.updatedAt).getTime()) / 60000;
      if (stuckMinutes < 10) {
        return res.status(409).json({ error: "Import is already running", status: "running" });
      }
      console.log(`[IMPORT] Job ${jobId} stuck in running for ${stuckMinutes.toFixed(0)}min, resetting to validated`);
      await db.update(importJobs).set({ status: "validated", updatedAt: new Date() }).where(eq(importJobs.id, jobId));
    } else if (job.status !== "validated") {
      return res.status(400).json({ error: `Job must be validated before running (current: ${job.status})` });
    }

    await db.update(importJobs).set({ status: "running", updatedAt: new Date() }).where(eq(importJobs.id, jobId));

    res.json({ status: "running", jobId, message: "Import started. Poll GET /api/admin/imports/" + jobId + "/status for progress." });

    executeImportAsync(jobId, job.companyId, job.cityId, job.sourceSystem).catch(err => {
      console.error(`[IMPORT] Async execution failed for job ${jobId}:`, err);
    });
  } catch (e: any) {
    console.error(`[IMPORT] runImport error:`, e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}

async function executeImportAsync(jobId: string, companyId: number, jobCityId: number | null, sourceSystem: string) {
  const dbSource = getDbSource();
  console.log(JSON.stringify({
    event: "import_async_start",
    jobId, companyId, cityId: jobCityId, sourceSystem, dbProvider: dbSource,
  }));

  const files = await db.select().from(importJobFiles).where(eq(importJobFiles.importJobId, jobId));
  const entityOrder: ImportEntity[] = ["clinics", "patients", "drivers", "vehicles"];
  const results: Record<string, { attempted: number; inserted: number; updated: number; skipped: number; failed: number; topFailReasons: string[] }> = {};
  const insertedIds: { entity: string; id: number }[] = [];

  const cityId = jobCityId || (await getDefaultCityId(companyId));
  console.log(`[IMPORT] job=${jobId} resolved cityId=${cityId}`);
  const defaultCity = await getDefaultCityName(jobCityId);
  const defaults: EntityDefaults = { defaultCity };

  let totalRows = 0;
  let processedRows = 0;

  const fileParsed: { entity: ImportEntity; unique: any[]; duplicates: number }[] = [];
  for (const entity of entityOrder) {
    const file = files.find(f => f.entity === entity);
    if (!file) continue;
    const storage = file.storageJson as any;
    const buffer = Buffer.from(storage.base64, "base64");
    const rows = parseFileToRows(buffer, file.filename, file.mimeType);
    const { mapped } = applyHeaderMapping(rows, entity);
    const { unique, duplicates } = dedupeRows(mapped, entity);
    fileParsed.push({ entity, unique, duplicates });
    totalRows += unique.length;
    console.log(JSON.stringify({
      event: "import_entity_parsed",
      jobId, entity, rawRows: rows.length, uniqueRows: unique.length, duplicates,
    }));
  }

  importProgress.set(jobId, { phase: "processing", entity: "", current: 0, total: totalRows, results: {} });

  try {
    for (const { entity, unique, duplicates } of fileParsed) {
      let inserted = 0, updated = 0, failed = 0;
      const failReasons: Record<string, number> = {};
      const attempted = unique.length;
      console.log(`[IMPORT] job=${jobId} processing entity=${entity} rows=${unique.length}`);

      importProgress.set(jobId, { phase: "processing", entity, current: processedRows, total: totalRows, results: { ...results } });

      for (let i = 0; i < unique.length; i++) {
        const withDefaults = applyDefaults(unique[i], entity, i, defaults);
        const row = normalizeRowValues(withDefaults, entity);
        row.company_id = companyId;
        const schema = getCanonicalSchema(entity);
        const validation = schema.safeParse(row);
        if (!validation.success) {
          failed++;
          const errs = validation.error.issues.map(iss => `${iss.path.join(".")}: ${iss.message}`);
          const reason = `validation: ${errs[0] || "unknown"}`;
          failReasons[reason] = (failReasons[reason] || 0) + 1;
          console.warn(`[IMPORT] job=${jobId} entity=${entity} row=${i + 1} VALIDATION_ERROR: ${errs.join("; ")}`);
          await db.insert(importJobEvents).values({
            importJobId: jobId, level: "error",
            message: `${entity} row ${i + 1}: ${errs.join("; ")}`,
            payload: { row: i + 1, errors: errs, phase: "validation" },
          });
          processedRows++;
          continue;
        }

        try {
          const result = await upsertRow(entity, row, companyId, sourceSystem, cityId, insertedIds);
          if (result === "inserted") inserted++;
          else if (result === "updated") updated++;
        } catch (rowErr: any) {
          failed++;
          const dbCode = rowErr.code || "";
          const constraint = rowErr.constraint || "";
          const detail = rowErr.detail || "";
          const reason = `db: ${constraint || dbCode || rowErr.message}`.slice(0, 80);
          failReasons[reason] = (failReasons[reason] || 0) + 1;
          console.error(`[IMPORT] job=${jobId} entity=${entity} row=${i + 1} DB_ERROR code=${dbCode} constraint=${constraint} detail=${detail} msg=${rowErr.message}`);
          await db.insert(importJobEvents).values({
            importJobId: jobId, level: "error",
            message: `${entity} row ${i + 1}: ${rowErr.message}`,
            payload: { row: i + 1, phase: "insert", sqlCode: dbCode, constraint, detail, rowData: row },
          });
        }
        processedRows++;

        if (processedRows % 25 === 0 || processedRows === totalRows) {
          await db.update(importJobs).set({ updatedAt: new Date() }).where(eq(importJobs.id, jobId));
          importProgress.set(jobId, { phase: "processing", entity, current: processedRows, total: totalRows, results: { ...results, [entity]: { attempted, inserted, updated, skipped: duplicates, failed, topFailReasons: [] } } });
        }
      }

      const topFailReasons = Object.entries(failReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => `${reason} (x${count})`);

      results[entity] = { attempted, inserted, updated, skipped: duplicates, failed, topFailReasons };

      console.log(JSON.stringify({
        event: "import_entity_done",
        jobId, entity, attempted, inserted, updated, skipped: duplicates, failed, topFailReasons,
      }));

      await db.insert(importJobEvents).values({
        importJobId: jobId, level: inserted + updated === 0 && attempted > 0 ? "error" : "info",
        message: `${entity}: ${inserted} inserted, ${updated} updated, ${failed} errors, ${duplicates} skipped`,
        payload: { entity, attempted, inserted, updated, skipped: duplicates, failed, topFailReasons },
      });
    }

    const allInserted = Object.values(results).reduce((sum, r) => sum + r.inserted, 0);
    const allUpdated = Object.values(results).reduce((sum, r) => sum + r.updated, 0);
    const allFailed = Object.values(results).reduce((sum, r) => sum + r.failed, 0);
    const allAttempted = Object.values(results).reduce((sum, r) => sum + r.attempted, 0);

    const importOk = allInserted + allUpdated > 0 || allAttempted === 0;
    const zeroInsertEntities = Object.entries(results)
      .filter(([, r]) => r.inserted + r.updated === 0 && r.attempted > 0)
      .map(([e]) => e);

    const finalStatus = importOk ? "completed" : "failed";
    const summaryJson: any = {
      ok: importOk,
      jobId,
      summary: results,
      insertedIds,
      totals: { attempted: allAttempted, inserted: allInserted, updated: allUpdated, failed: allFailed },
    };

    if (!importOk) {
      summaryJson.error = `Zero records persisted for: ${zeroInsertEntities.join(", ")}. All ${allAttempted} rows failed.`;
      summaryJson.zeroInsertEntities = zeroInsertEntities;
    }

    await db.update(importJobs).set({
      status: finalStatus,
      summaryJson,
      updatedAt: new Date(),
    }).where(eq(importJobs.id, jobId));

    importProgress.set(jobId, { phase: finalStatus, entity: "", current: totalRows, total: totalRows, results });

    console.log(JSON.stringify({
      event: "import_complete",
      jobId, ok: importOk, status: finalStatus,
      totals: { attempted: allAttempted, inserted: allInserted, updated: allUpdated, failed: allFailed },
      zeroInsertEntities,
    }));

    setTimeout(() => importProgress.delete(jobId), 120000);
  } catch (e: any) {
    const dbCode = (e as any).code || "";
    const constraint = (e as any).constraint || "";
    console.error(JSON.stringify({
      event: "import_crash",
      jobId, error: e.message, sqlCode: dbCode, constraint,
      stack: e.stack?.slice(0, 500),
    }));
    try {
      await db.update(importJobs).set({
        status: "failed",
        summaryJson: { ok: false, jobId, summary: results, insertedIds, error: e.message, rollbackReason: `${dbCode} ${constraint} ${e.message}`.trim() },
        updatedAt: new Date(),
      }).where(eq(importJobs.id, jobId));
      await db.insert(importJobEvents).values({
        importJobId: jobId, level: "error",
        message: `Import failed: ${e.message}`,
        payload: { sqlCode: dbCode, constraint, results, rollbackReason: e.message },
      });
    } catch (updateErr: any) {
      console.error(`[IMPORT] job=${jobId} Could not update job status after failure:`, updateErr.message);
    }
    importProgress.set(jobId, { phase: "failed", entity: "", current: processedRows, total: totalRows, results });
    setTimeout(() => importProgress.delete(jobId), 120000);
  }
}

export async function getImportStatus(req: AuthRequest, res: Response) {
  try {
    const jobId = req.params.id;
    const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job) return res.status(404).json({ error: "Import job not found" });

    const progress = importProgress.get(jobId);
    const percent = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : null;

    return res.json({
      id: job.id,
      status: job.status,
      companyId: job.companyId,
      summaryJson: job.summaryJson,
      updatedAt: job.updatedAt,
      progress: progress ? {
        phase: progress.phase,
        entity: progress.entity,
        current: progress.current,
        total: progress.total,
        percent: percent,
        results: progress.results,
      } : null,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

async function getDefaultCityId(companyId?: number): Promise<number> {
  if (companyId) {
    const existing = await db.select({ cityId: clinics.cityId }).from(clinics).where(eq(clinics.companyId, companyId)).limit(1);
    if (existing.length && existing[0].cityId) return existing[0].cityId;
    const existingDrv = await db.select({ cityId: drivers.cityId }).from(drivers).where(eq(drivers.companyId, companyId)).limit(1);
    if (existingDrv.length && existingDrv[0].cityId) return existingDrv[0].cityId;
  }
  const lv = await db.select().from(cities).where(eq(cities.name, "Las Vegas")).limit(1);
  if (lv.length) return lv[0].id;
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
      await updateEntity(entity, existing.ucmId, row, companyId);
      return "updated";
    }
  }

  const naturalMatch = await findNaturalMatch(entity, row, companyId, cityId);
  if (naturalMatch) {
    await updateEntity(entity, naturalMatch, row, companyId);
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
          .where(and(eq(clinics.companyId, companyId), eq(clinics.name, row.name), eq(clinics.cityId, cityId)));
        if (matches.length === 1) return matches[0].id;
      }
      if (row.email) {
        const matches = await db.select().from(clinics)
          .where(and(eq(clinics.companyId, companyId), eq(clinics.email, row.email)));
        if (matches.length === 1) return matches[0].id;
      }
      return null;
    }
    case "patients": {
      if (row.phone) {
        const matches = await db.select().from(patients)
          .where(and(eq(patients.companyId, companyId), eq(patients.phone, row.phone), eq(patients.cityId, cityId)));
        if (matches.length === 1) return matches[0].id;
      }
      if (row.first_name && row.last_name && row.date_of_birth) {
        const matches = await db.select().from(patients)
          .where(and(
            eq(patients.companyId, companyId),
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
        const matches = await db.select().from(drivers)
          .where(and(eq(drivers.companyId, companyId), eq(drivers.phone, row.phone)));
        if (matches.length === 1) return matches[0].id;
      }
      if (row.email) {
        const matches = await db.select().from(drivers)
          .where(and(eq(drivers.companyId, companyId), eq(drivers.email, row.email)));
        if (matches.length === 1) return matches[0].id;
      }
      return null;
    }
    case "vehicles": {
      if (row.license_plate) {
        const matches = await db.select().from(vehicles)
          .where(and(eq(vehicles.companyId, companyId), eq(vehicles.licensePlate, row.license_plate)));
        if (matches.length === 1) return matches[0].id;
      }
      return null;
    }
  }
}

async function updateEntity(entity: ImportEntity, id: number, row: Record<string, any>, companyId?: number): Promise<void> {
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
      if (Object.keys(data).length) {
        const condition = companyId
          ? and(eq(clinics.id, id), eq(clinics.companyId, companyId))
          : eq(clinics.id, id);
        await db.update(clinics).set(data).where(condition);
      }
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
      if (Object.keys(data).length) {
        const condition = companyId
          ? and(eq(patients.id, id), eq(patients.companyId, companyId))
          : eq(patients.id, id);
        await db.update(patients).set(data).where(condition);
      }
      break;
    }
    case "drivers": {
      const data: any = {};
      if (row.first_name) data.firstName = row.first_name;
      if (row.last_name) data.lastName = row.last_name;
      if (row.phone) data.phone = row.phone;
      if (row.license_number) data.licenseNumber = row.license_number;
      if (Object.keys(data).length) {
        const condition = companyId
          ? and(eq(drivers.id, id), eq(drivers.companyId, companyId))
          : eq(drivers.id, id);
        await db.update(drivers).set(data).where(condition);
      }
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
      if (Object.keys(data).length) {
        const condition = companyId
          ? and(eq(vehicles.id, id), eq(vehicles.companyId, companyId))
          : eq(vehicles.id, id);
        await db.update(vehicles).set(data).where(condition);
      }
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

export async function getCompanyImportHealth(req: AuthRequest, res: Response) {
  try {
    const companyId = parseInt(String(req.params.companyId));
    if (isNaN(companyId)) return res.status(400).json({ error: "Invalid company ID" });

    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (!company) return res.status(404).json({ error: "Company not found" });

    const clinicCount = await db.select({ count: sql<number>`count(*)` }).from(clinics).where(eq(clinics.companyId, companyId));
    const driverCount = await db.select({ count: sql<number>`count(*)` }).from(drivers).where(eq(drivers.companyId, companyId));
    const vehicleCount = await db.select({ count: sql<number>`count(*)` }).from(vehicles).where(eq(vehicles.companyId, companyId));
    const patientCount = await db.select({ count: sql<number>`count(*)` }).from(patients).where(eq(patients.companyId, companyId));

    const orphanedClinics = await db.select({ id: clinics.id, name: clinics.name })
      .from(clinics)
      .where(sql`${clinics.companyId} IS NULL`);

    const recentJobs = await db.select({
      id: importJobs.id,
      status: importJobs.status,
      sourceSystem: importJobs.sourceSystem,
      summaryJson: importJobs.summaryJson,
      createdAt: importJobs.createdAt,
      updatedAt: importJobs.updatedAt,
    }).from(importJobs)
      .where(eq(importJobs.companyId, companyId))
      .orderBy(desc(importJobs.createdAt))
      .limit(5);

    return res.json({
      companyId,
      companyName: company.name,
      dbProvider: getDbSource(),
      counts: {
        clinics: Number(clinicCount[0]?.count || 0),
        drivers: Number(driverCount[0]?.count || 0),
        vehicles: Number(vehicleCount[0]?.count || 0),
        patients: Number(patientCount[0]?.count || 0),
      },
      orphanedClinics: orphanedClinics.map(c => ({ id: c.id, name: c.name })),
      recentImportJobs: recentJobs,
    });
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
