/**
 * UCM Import Service
 *
 * Orchestrates data import: parse → map → normalize → validate → dedup → insert.
 * Supports preview/dry-run mode, row-level error reporting, tenant isolation.
 * All writes are wrapped in a database transaction for atomicity.
 */
import { getDb, getPool } from "../db/index.js";
import { patients, users, driverStatus } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";
import {
  type ParsedFile,
  type ColumnMapping,
  type RowError,
  type EntityType,
  type DedupeStrategy,
  parseFile,
  autoMapColumns,
  getAliasMap,
  extractMappedValue,
  generateDedupeKey,
  normalizePhone,
  normalizeEmail,
  normalizeDate,
  normalizeDateTime,
  normalizeName,
  normalizeAddress,
} from "./importEngine.js";
import logger from "../lib/logger.js";

// ── Constants ─────────────────────────────────────────────────────────

const MAX_IMPORT_ROWS = 10_000;

// ── Types ─────────────────────────────────────────────────────────────

export interface ImportOptions {
  tenantId: string;
  entity: EntityType;
  dryRun: boolean;
  dedupeStrategies: DedupeStrategy[];
  columnOverrides?: Record<string, string>; // sourceColumn → targetField overrides
  skipDuplicates?: boolean; // skip vs error on duplicates
  defaultTimezone?: string;
}

export interface ImportPreview {
  fileName: string;
  totalRows: number;
  headers: string[];
  mappedColumns: ColumnMapping[];
  unmappedColumns: string[];
  sampleRows: Record<string, string>[];
  entity: EntityType;
  warnings: string[];
}

export interface ImportResult {
  success: boolean;
  entity: EntityType;
  totalRows: number;
  inserted: number;
  skipped: number;
  duplicates: number;
  errors: RowError[];
  warnings: RowError[];
  dryRun: boolean;
  durationMs: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function applyColumnOverrides(mapped: ColumnMapping[], unmapped: string[], overrides: Record<string, string>) {
  for (const [source, target] of Object.entries(overrides)) {
    if (!source || !target) continue;
    const existing = mapped.find((m) => m.sourceColumn === source);
    if (existing) {
      existing.targetField = target;
      existing.confidence = "manual";
    } else {
      mapped.push({ sourceColumn: source, targetField: target, confidence: "manual" });
      const idx = unmapped.indexOf(source);
      if (idx >= 0) unmapped.splice(idx, 1);
    }
  }
}

// ── Preview (no writes) ──────────────────────────────────────────────

export async function previewImport(
  fileName: string,
  fileContent: Buffer,
  entity: EntityType,
  columnOverrides?: Record<string, string>
): Promise<ImportPreview> {
  const parsed = await parseFile(fileName, fileContent);
  const aliasMap = getAliasMap(entity);
  const { mapped, unmapped } = autoMapColumns(parsed.headers, aliasMap);
  const warnings: string[] = [];

  // Apply manual overrides
  if (columnOverrides) {
    applyColumnOverrides(mapped, unmapped, columnOverrides);
  }

  // Row count warning
  if (parsed.totalRows > MAX_IMPORT_ROWS) {
    warnings.push(`File contains ${parsed.totalRows} rows. Maximum is ${MAX_IMPORT_ROWS}. Only the first ${MAX_IMPORT_ROWS} rows will be imported.`);
  }
  if (parsed.totalRows === 0) {
    warnings.push("File contains no data rows.");
  }

  // Check required fields mapped
  const requiredByEntity: Record<EntityType, string[]> = {
    patients: ["firstName", "lastName"],
    drivers: ["firstName", "lastName", "email"],
    trips: ["pickupAddress", "dropoffAddress", "scheduledAt"],
  };
  const mappedFields = new Set(mapped.map((m) => m.targetField));
  for (const req of requiredByEntity[entity]) {
    if (!mappedFields.has(req)) {
      warnings.push(`Required field "${req}" is not mapped to any column.`);
    }
  }

  if (unmapped.length > 0) {
    warnings.push(`${unmapped.length} column(s) could not be auto-mapped: ${unmapped.join(", ")}`);
  }

  return {
    fileName,
    totalRows: parsed.totalRows,
    headers: parsed.headers,
    mappedColumns: mapped,
    unmappedColumns: unmapped,
    sampleRows: parsed.rows.slice(0, 5),
    entity,
    warnings,
  };
}

// ── Execute Import ───────────────────────────────────────────────────

export async function executeImport(
  fileName: string,
  fileContent: Buffer,
  options: ImportOptions
): Promise<ImportResult> {
  const start = Date.now();
  const parsed = await parseFile(fileName, fileContent);
  const aliasMap = getAliasMap(options.entity);
  const { mapped, unmapped } = autoMapColumns(parsed.headers, aliasMap);

  // Apply column overrides
  if (options.columnOverrides) {
    applyColumnOverrides(mapped, unmapped, options.columnOverrides);
  }

  // Enforce row limit
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    parsed.rows = parsed.rows.slice(0, MAX_IMPORT_ROWS);
    logger.warn("Import row limit enforced", { original: parsed.totalRows, limit: MAX_IMPORT_ROWS });
    parsed.totalRows = MAX_IMPORT_ROWS;
  }

  switch (options.entity) {
    case "patients":
      return importPatients(parsed, mapped, options, start);
    case "drivers":
      return importDrivers(parsed, mapped, options, start);
    case "trips":
      return importTrips(parsed, mapped, options, start);
    default:
      return {
        success: false,
        entity: options.entity,
        totalRows: parsed.totalRows,
        inserted: 0,
        skipped: 0,
        duplicates: 0,
        errors: [{ row: 0, field: "", value: null, message: `Unsupported entity: ${options.entity}`, severity: "error" }],
        warnings: [],
        dryRun: options.dryRun,
        durationMs: Date.now() - start,
      };
  }
}

// ── Patient Import ───────────────────────────────────────────────────

async function importPatients(
  parsed: ParsedFile,
  mapping: ColumnMapping[],
  options: ImportOptions,
  startTime: number
): Promise<ImportResult> {
  const db = getDb();
  const errors: RowError[] = [];
  const warnings: RowError[] = [];
  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;

  // Build existing patient lookup for dedup
  const existingPatients = await db
    .select({
      id: patients.id,
      email: patients.email,
      phone: patients.phone,
      firstName: patients.firstName,
      lastName: patients.lastName,
      dateOfBirth: patients.dateOfBirth,
      insuranceId: patients.insuranceId,
    })
    .from(patients)
    .where(eq(patients.tenantId, options.tenantId));

  const existingKeys = new Set<string>();
  for (const p of existingPatients) {
    for (const strat of options.dedupeStrategies) {
      const key = generateDedupeKey(
        { email: p.email, phone: p.phone, firstName: p.firstName, lastName: p.lastName, dateOfBirth: p.dateOfBirth, externalId: p.insuranceId, address: null },
        strat
      );
      if (key) existingKeys.add(key);
    }
  }

  // Track within-file duplicates (add ALL strategy keys per row, not just first match)
  const fileKeys = new Set<string>();

  // Collect validated rows for batch insert
  const validRows: Array<{ rowNum: number; data: typeof patients.$inferInsert }> = [];

  for (let i = 0; i < parsed.rows.length; i++) {
    const rowNum = i + 2; // 1-indexed + header
    const raw = extractMappedValue(parsed.rows[i], mapping);

    // Normalize
    const firstName = normalizeName(raw.firstName);
    const lastName = normalizeName(raw.lastName);
    const phone = normalizePhone(raw.phone);
    const email = normalizeEmail(raw.email);
    const dob = normalizeDate(raw.dateOfBirth);
    const address = normalizeAddress(raw.address);
    const insuranceId = raw.insuranceId?.trim() || null;
    const notes = raw.notes?.trim() || null;

    // Validate required fields
    if (!firstName) {
      errors.push({ row: rowNum, field: "firstName", value: raw.firstName, message: "First name is required", severity: "error" });
      skipped++;
      continue;
    }
    if (!lastName) {
      errors.push({ row: rowNum, field: "lastName", value: raw.lastName, message: "Last name is required", severity: "error" });
      skipped++;
      continue;
    }

    // Warnings for data quality
    if (raw.phone && !phone) {
      warnings.push({ row: rowNum, field: "phone", value: raw.phone, message: "Invalid phone number format, skipped", severity: "warning" });
    }
    if (raw.email && !email) {
      warnings.push({ row: rowNum, field: "email", value: raw.email, message: "Invalid email format, skipped", severity: "warning" });
    }
    if (raw.dateOfBirth && !dob) {
      warnings.push({ row: rowNum, field: "dateOfBirth", value: raw.dateOfBirth, message: "Could not parse date of birth", severity: "warning" });
    }

    // Dedup check — generate ALL keys first, then check, then add all
    const dedupeData = { email, phone, firstName: firstName?.toLowerCase(), lastName: lastName?.toLowerCase(), dateOfBirth: dob, externalId: insuranceId, address };
    let isDuplicate = false;
    const rowKeys: string[] = [];

    for (const strat of options.dedupeStrategies) {
      const key = generateDedupeKey(dedupeData, strat);
      if (key) {
        if (existingKeys.has(key) || fileKeys.has(key)) {
          isDuplicate = true;
          break;
        }
        rowKeys.push(key);
      }
    }

    if (isDuplicate) {
      duplicates++;
      if (options.skipDuplicates !== false) {
        continue;
      }
      warnings.push({ row: rowNum, field: "", value: null, message: "Duplicate record detected, skipping", severity: "warning" });
      continue;
    }

    // Add all keys for this row after dedup check passes
    for (const key of rowKeys) fileKeys.add(key);

    validRows.push({
      rowNum,
      data: {
        tenantId: options.tenantId,
        firstName,
        lastName,
        dateOfBirth: dob,
        phone,
        email,
        address,
        insuranceId,
        notes,
      },
    });
  }

  // Execute inserts in a transaction (unless dry-run)
  if (!options.dryRun && validRows.length > 0) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const txDb = drizzle(client as any, { schema });

      for (const row of validRows) {
        try {
          await txDb.insert(patients).values(row.data);
          inserted++;
        } catch (err: any) {
          errors.push({ row: row.rowNum, field: "", value: null, message: `DB insert failed: ${err.message}`, severity: "error" });
          skipped++;
        }
      }

      // If any DB errors occurred, roll back the entire import
      if (errors.some((e) => e.message.startsWith("DB insert failed"))) {
        await client.query("ROLLBACK");
        logger.warn("Import rolled back due to DB errors", { entity: "patients", errorCount: errors.length });
        // Reset inserted count since we rolled back
        inserted = 0;
        skipped = validRows.length;
      } else {
        await client.query("COMMIT");
      }
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error("Import transaction failed", { error: err.message });
      errors.push({ row: 0, field: "", value: null, message: `Transaction failed: ${err.message}`, severity: "error" });
      inserted = 0;
      skipped = validRows.length;
    } finally {
      client.release();
    }
  } else if (options.dryRun) {
    inserted = validRows.length;
  }

  return {
    success: errors.filter((e) => e.severity === "error").length === 0,
    entity: "patients",
    totalRows: parsed.rows.length,
    inserted,
    skipped,
    duplicates,
    errors,
    warnings,
    dryRun: options.dryRun,
    durationMs: Date.now() - startTime,
  };
}

// ── Driver Import ────────────────────────────────────────────────────

async function importDrivers(
  parsed: ParsedFile,
  mapping: ColumnMapping[],
  options: ImportOptions,
  startTime: number
): Promise<ImportResult> {
  const db = getDb();
  const errors: RowError[] = [];
  const warnings: RowError[] = [];
  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;

  // Check existing drivers by email
  const existingDrivers = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, options.tenantId), eq(users.role, "driver")));

  const existingEmails = new Set(existingDrivers.map((d) => d.email.toLowerCase()));

  // Validate all rows first
  const validRows: Array<{ rowNum: number; firstName: string; lastName: string; email: string; phone: string | null }> = [];

  for (let i = 0; i < parsed.rows.length; i++) {
    const rowNum = i + 2;
    const raw = extractMappedValue(parsed.rows[i], mapping);

    const firstName = normalizeName(raw.firstName);
    const lastName = normalizeName(raw.lastName);
    const email = normalizeEmail(raw.email);
    const phone = normalizePhone(raw.phone);

    if (!firstName) {
      errors.push({ row: rowNum, field: "firstName", value: raw.firstName, message: "First name is required", severity: "error" });
      skipped++;
      continue;
    }
    if (!lastName) {
      errors.push({ row: rowNum, field: "lastName", value: raw.lastName, message: "Last name is required", severity: "error" });
      skipped++;
      continue;
    }
    if (!email) {
      errors.push({ row: rowNum, field: "email", value: raw.email, message: "Valid email is required for drivers", severity: "error" });
      skipped++;
      continue;
    }

    if (existingEmails.has(email)) {
      duplicates++;
      if (options.skipDuplicates !== false) continue;
      warnings.push({ row: rowNum, field: "email", value: email, message: "Driver with this email already exists", severity: "warning" });
      continue;
    }
    existingEmails.add(email); // Track within-file duplicates

    validRows.push({ rowNum, firstName, lastName, email, phone });
  }

  // Execute inserts in a transaction (unless dry-run)
  if (!options.dryRun && validRows.length > 0) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const txDb = drizzle(client as any, { schema });

      for (const row of validRows) {
        try {
          // Use a placeholder password hash — drivers must reset password on first login
          const [driver] = await txDb.insert(users).values({
            tenantId: options.tenantId,
            email: row.email,
            passwordHash: "$2b$10$importPlaceholderMustResetPassword000000000000000000",
            role: "driver",
            firstName: row.firstName,
            lastName: row.lastName,
            active: true,
            mustResetPassword: true,
          }).returning({ id: users.id });

          // Create driver status
          await txDb.insert(driverStatus).values({
            driverId: driver.id,
            tenantId: options.tenantId,
            availability: "offline",
          });

          inserted++;
        } catch (err: any) {
          errors.push({ row: row.rowNum, field: "", value: null, message: `DB insert failed: ${err.message}`, severity: "error" });
          skipped++;
        }
      }

      if (errors.some((e) => e.message.startsWith("DB insert failed"))) {
        await client.query("ROLLBACK");
        logger.warn("Import rolled back due to DB errors", { entity: "drivers", errorCount: errors.length });
        inserted = 0;
        skipped = validRows.length;
      } else {
        await client.query("COMMIT");
      }
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error("Import transaction failed", { error: err.message });
      errors.push({ row: 0, field: "", value: null, message: `Transaction failed: ${err.message}`, severity: "error" });
      inserted = 0;
      skipped = validRows.length;
    } finally {
      client.release();
    }
  } else if (options.dryRun) {
    inserted = validRows.length;
  }

  return {
    success: errors.filter((e) => e.severity === "error").length === 0,
    entity: "drivers",
    totalRows: parsed.rows.length,
    inserted,
    skipped,
    duplicates,
    errors,
    warnings,
    dryRun: options.dryRun,
    durationMs: Date.now() - startTime,
  };
}

// ── Trip Import ──────────────────────────────────────────────────────

async function importTrips(
  parsed: ParsedFile,
  mapping: ColumnMapping[],
  options: ImportOptions,
  startTime: number
): Promise<ImportResult> {
  const db = getDb();
  const errors: RowError[] = [];
  const warnings: RowError[] = [];
  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;

  // Load tenant patients for matching
  const tenantPatients = await db
    .select({
      id: patients.id,
      firstName: patients.firstName,
      lastName: patients.lastName,
      phone: patients.phone,
      email: patients.email,
      insuranceId: patients.insuranceId,
    })
    .from(patients)
    .where(eq(patients.tenantId, options.tenantId));

  if (tenantPatients.length === 0) {
    return {
      success: false,
      entity: "trips",
      totalRows: parsed.rows.length,
      inserted: 0,
      skipped: parsed.rows.length,
      duplicates: 0,
      errors: [{ row: 0, field: "", value: null, message: "No patients found for this tenant. Import patients first.", severity: "error" }],
      warnings: [],
      dryRun: options.dryRun,
      durationMs: Date.now() - startTime,
    };
  }

  // Build lookup indexes
  const patientByEmail = new Map<string, string>();
  const patientByPhone = new Map<string, string>();
  const patientByName = new Map<string, string>();
  const patientByInsurance = new Map<string, string>();

  for (const p of tenantPatients) {
    if (p.email) patientByEmail.set(p.email.toLowerCase(), p.id);
    if (p.phone) patientByPhone.set(normalizePhone(p.phone) || "", p.id);
    patientByName.set(`${p.firstName.toLowerCase()}|${p.lastName.toLowerCase()}`, p.id);
    if (p.insuranceId) patientByInsurance.set(p.insuranceId.toLowerCase(), p.id);
  }

  const { trips } = await import("../db/schema.js");

  // Validate all rows first
  const validRows: Array<{ rowNum: number; data: typeof trips.$inferInsert }> = [];

  for (let i = 0; i < parsed.rows.length; i++) {
    const rowNum = i + 2;
    const raw = extractMappedValue(parsed.rows[i], mapping);

    const pickupAddress = normalizeAddress(raw.pickupAddress);
    const dropoffAddress = normalizeAddress(raw.dropoffAddress);

    if (!pickupAddress) {
      errors.push({ row: rowNum, field: "pickupAddress", value: raw.pickupAddress, message: "Pickup address is required", severity: "error" });
      skipped++;
      continue;
    }
    if (!dropoffAddress) {
      errors.push({ row: rowNum, field: "dropoffAddress", value: raw.dropoffAddress, message: "Dropoff address is required", severity: "error" });
      skipped++;
      continue;
    }

    // Resolve patient — try multiple strategies in priority order
    let patientId: string | null = null;

    // 1. Try external ID / insurance ID
    if (raw.patientExternalId) {
      patientId = patientByInsurance.get(raw.patientExternalId.toLowerCase()) || null;
    }

    // 2. Try email
    if (!patientId && raw.patientEmail) {
      const normalized = normalizeEmail(raw.patientEmail);
      if (normalized) patientId = patientByEmail.get(normalized) || null;
    }

    // 3. Try phone
    if (!patientId && raw.patientPhone) {
      const normalized = normalizePhone(raw.patientPhone);
      if (normalized) patientId = patientByPhone.get(normalized) || null;
    }

    // 4. Try name match
    if (!patientId) {
      let fn = raw.patientFirstName;
      let ln = raw.patientLastName;

      // Parse "Last, First" or "First Last" from combined name
      if (!fn && !ln && raw.patientName) {
        const name = raw.patientName.trim();
        if (name.includes(",")) {
          const parts = name.split(",").map((s: string) => s.trim());
          ln = parts[0];
          fn = parts[1];
        } else {
          const parts = name.split(/\s+/);
          fn = parts[0];
          ln = parts.slice(1).join(" ");
        }
      }

      if (fn && ln) {
        patientId = patientByName.get(`${fn.toLowerCase().trim()}|${ln.toLowerCase().trim()}`) || null;
      }
    }

    if (!patientId) {
      errors.push({ row: rowNum, field: "patient", value: raw.patientName || raw.patientExternalId || null, message: "Could not match patient to existing records. Import patients first.", severity: "error" });
      skipped++;
      continue;
    }

    // Parse scheduled date/time
    const scheduledAt = normalizeDateTime(raw.scheduledAt, raw.scheduledTime);
    if (!scheduledAt) {
      errors.push({ row: rowNum, field: "scheduledAt", value: raw.scheduledAt, message: "Valid scheduled date/time is required", severity: "error" });
      skipped++;
      continue;
    }

    // Validate coordinates if provided
    const pickupLat = raw.pickupLat ? parseFloat(raw.pickupLat) : null;
    const pickupLng = raw.pickupLng ? parseFloat(raw.pickupLng) : null;
    const dropoffLat = raw.dropoffLat ? parseFloat(raw.dropoffLat) : null;
    const dropoffLng = raw.dropoffLng ? parseFloat(raw.dropoffLng) : null;
    const estimatedMiles = raw.estimatedMiles ? parseFloat(raw.estimatedMiles) : null;

    if (pickupLat !== null && (pickupLat < -90 || pickupLat > 90)) {
      warnings.push({ row: rowNum, field: "pickupLat", value: raw.pickupLat, message: "Invalid pickup latitude, ignored", severity: "warning" });
    }
    if (pickupLng !== null && (pickupLng < -180 || pickupLng > 180)) {
      warnings.push({ row: rowNum, field: "pickupLng", value: raw.pickupLng, message: "Invalid pickup longitude, ignored", severity: "warning" });
    }

    const safeLat = (v: number | null, min: number, max: number) => v !== null && v >= min && v <= max ? v.toFixed(7) : null;

    validRows.push({
      rowNum,
      data: {
        tenantId: options.tenantId,
        patientId,
        status: "requested",
        pickupAddress,
        dropoffAddress,
        pickupLat: safeLat(pickupLat, -90, 90),
        pickupLng: safeLat(pickupLng, -180, 180),
        dropoffLat: safeLat(dropoffLat, -90, 90),
        dropoffLng: safeLat(dropoffLng, -180, 180),
        scheduledAt,
        timezone: options.defaultTimezone || "America/New_York",
        estimatedMiles: estimatedMiles && estimatedMiles > 0 ? estimatedMiles.toFixed(2) : null,
        notes: raw.notes?.trim() || null,
        vehicleType: raw.vehicleType?.trim() || null,
        metadata: { imported: true, externalId: raw.externalId?.trim() || undefined },
      },
    });
  }

  // Execute inserts in a transaction (unless dry-run)
  if (!options.dryRun && validRows.length > 0) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const txDb = drizzle(client as any, { schema });

      for (const row of validRows) {
        try {
          await txDb.insert(trips).values(row.data);
          inserted++;
        } catch (err: any) {
          errors.push({ row: row.rowNum, field: "", value: null, message: `DB insert failed: ${err.message}`, severity: "error" });
          skipped++;
        }
      }

      if (errors.some((e) => e.message.startsWith("DB insert failed"))) {
        await client.query("ROLLBACK");
        logger.warn("Import rolled back due to DB errors", { entity: "trips", errorCount: errors.length });
        inserted = 0;
        skipped = validRows.length;
      } else {
        await client.query("COMMIT");
      }
    } catch (err: any) {
      await client.query("ROLLBACK").catch(() => {});
      logger.error("Import transaction failed", { error: err.message });
      errors.push({ row: 0, field: "", value: null, message: `Transaction failed: ${err.message}`, severity: "error" });
      inserted = 0;
      skipped = validRows.length;
    } finally {
      client.release();
    }
  } else if (options.dryRun) {
    inserted = validRows.length;
  }

  return {
    success: errors.filter((e) => e.severity === "error").length === 0,
    entity: "trips",
    totalRows: parsed.rows.length,
    inserted,
    skipped,
    duplicates,
    errors,
    warnings,
    dryRun: options.dryRun,
    durationMs: Date.now() - startTime,
  };
}
