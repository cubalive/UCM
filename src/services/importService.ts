/**
 * UCM Import Service
 *
 * Orchestrates data import: parse → map → normalize → validate → dedup → insert.
 * Supports preview/dry-run mode, row-level error reporting, tenant isolation.
 */
import { getDb } from "../db/index.js";
import { patients, users, driverStatus } from "../db/schema.js";
import { eq, and, ilike, sql } from "drizzle-orm";
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

  // Apply manual overrides
  if (columnOverrides) {
    for (const [source, target] of Object.entries(columnOverrides)) {
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

  return {
    fileName,
    totalRows: parsed.totalRows,
    headers: parsed.headers,
    mappedColumns: mapped,
    unmappedColumns: unmapped,
    sampleRows: parsed.rows.slice(0, 5),
    entity,
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
  const { mapped } = autoMapColumns(parsed.headers, aliasMap);

  // Apply column overrides
  if (options.columnOverrides) {
    for (const [source, target] of Object.entries(options.columnOverrides)) {
      const existing = mapped.find((m) => m.sourceColumn === source);
      if (existing) {
        existing.targetField = target;
        existing.confidence = "manual";
      } else {
        mapped.push({ sourceColumn: source, targetField: target, confidence: "manual" });
      }
    }
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

  // Also track within-file duplicates
  const fileKeys = new Set<string>();

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

    // Dedup check
    const dedupeData = { email, phone, firstName: firstName?.toLowerCase(), lastName: lastName?.toLowerCase(), dateOfBirth: dob, externalId: insuranceId, address };
    let isDuplicate = false;
    for (const strat of options.dedupeStrategies) {
      const key = generateDedupeKey(dedupeData, strat);
      if (key && (existingKeys.has(key) || fileKeys.has(key))) {
        isDuplicate = true;
        break;
      }
      if (key) fileKeys.add(key);
    }

    if (isDuplicate) {
      duplicates++;
      if (options.skipDuplicates !== false) {
        continue;
      }
      warnings.push({ row: rowNum, field: "", value: null, message: "Duplicate record detected, skipping", severity: "warning" });
      continue;
    }

    if (!options.dryRun) {
      try {
        await db.insert(patients).values({
          tenantId: options.tenantId,
          firstName,
          lastName,
          dateOfBirth: dob,
          phone,
          email,
          address,
          insuranceId,
          notes,
        });
        inserted++;
      } catch (err: any) {
        errors.push({ row: rowNum, field: "", value: null, message: `DB insert failed: ${err.message}`, severity: "error" });
        skipped++;
      }
    } else {
      inserted++; // Would be inserted
    }
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
    existingEmails.add(email);

    if (!options.dryRun) {
      try {
        // Use a placeholder password hash — drivers must reset password on first login
        const [driver] = await db.insert(users).values({
          tenantId: options.tenantId,
          email,
          passwordHash: "$2b$10$importPlaceholderMustResetPassword000000000000000000",
          role: "driver",
          firstName,
          lastName,
          active: true,
        }).returning({ id: users.id });

        // Create driver status
        await db.insert(driverStatus).values({
          driverId: driver.id,
          tenantId: options.tenantId,
          availability: "offline",
        });

        inserted++;
      } catch (err: any) {
        errors.push({ row: rowNum, field: "", value: null, message: `DB insert failed: ${err.message}`, severity: "error" });
        skipped++;
      }
    } else {
      inserted++;
    }
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

    // Resolve patient
    let patientId: string | null = null;

    // Try external ID / insurance ID
    if (raw.patientExternalId) {
      patientId = patientByInsurance.get(raw.patientExternalId.toLowerCase()) || null;
    }

    // Try email
    if (!patientId && raw.patientPhone) {
      const normalized = normalizePhone(raw.patientPhone);
      if (normalized) patientId = patientByPhone.get(normalized) || null;
    }

    // Try name match
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

    const pickupLat = raw.pickupLat ? parseFloat(raw.pickupLat) : null;
    const pickupLng = raw.pickupLng ? parseFloat(raw.pickupLng) : null;
    const dropoffLat = raw.dropoffLat ? parseFloat(raw.dropoffLat) : null;
    const dropoffLng = raw.dropoffLng ? parseFloat(raw.dropoffLng) : null;
    const estimatedMiles = raw.estimatedMiles ? parseFloat(raw.estimatedMiles) : null;

    if (!options.dryRun) {
      try {
        await db.insert(trips).values({
          tenantId: options.tenantId,
          patientId,
          status: "requested",
          pickupAddress,
          dropoffAddress,
          pickupLat: pickupLat?.toFixed(7) ?? null,
          pickupLng: pickupLng?.toFixed(7) ?? null,
          dropoffLat: dropoffLat?.toFixed(7) ?? null,
          dropoffLng: dropoffLng?.toFixed(7) ?? null,
          scheduledAt,
          timezone: options.defaultTimezone || "America/New_York",
          estimatedMiles: estimatedMiles?.toFixed(2) ?? null,
          notes: raw.notes?.trim() || null,
          vehicleType: raw.vehicleType?.trim() || null,
          metadata: { imported: true, externalId: raw.externalId?.trim() || undefined },
        });
        inserted++;
      } catch (err: any) {
        errors.push({ row: rowNum, field: "", value: null, message: `DB insert failed: ${err.message}`, severity: "error" });
        skipped++;
      }
    } else {
      inserted++;
    }
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
