/**
 * UCM Import Engine
 *
 * Core parsing, column mapping, and data normalization for CSV/Excel imports.
 * Designed for maximum compatibility with external dispatch software exports.
 */
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";

// ── Column Alias Maps ─────────────────────────────────────────────────
// Each target field maps to an array of aliases (lowercase, trimmed).
// Supports English + Spanish + common dispatch software column names.

export const PATIENT_ALIASES: Record<string, string[]> = {
  firstName: ["first_name", "firstname", "first name", "fname", "nombre", "given_name", "givenname", "member_first", "patient_first", "rider_first"],
  lastName: ["last_name", "lastname", "last name", "lname", "apellido", "surname", "family_name", "familyname", "member_last", "patient_last", "rider_last"],
  dateOfBirth: ["date_of_birth", "dateofbirth", "dob", "birth_date", "birthdate", "birthday", "fecha_nacimiento", "birth date", "member_dob", "patient_dob"],
  phone: ["phone", "phone_number", "phonenumber", "telephone", "tel", "mobile", "cell", "cell_phone", "celular", "telefono", "contact_phone", "member_phone", "patient_phone", "rider_phone"],
  email: ["email", "email_address", "emailaddress", "e_mail", "e-mail", "correo", "correo_electronico", "member_email", "patient_email"],
  address: ["address", "home_address", "street_address", "direccion", "full_address", "member_address", "patient_address", "rider_address", "street", "address_line_1"],
  insuranceId: ["insurance_id", "insuranceid", "insurance_number", "insurance", "policy_number", "policyid", "medicaid_id", "medicaidid", "medicaid", "member_id", "memberid", "subscriber_id", "seguro"],
  notes: ["notes", "note", "comments", "comment", "special_needs", "special_instructions", "notas", "accommodations", "requirements"],
  externalId: ["external_id", "externalid", "source_id", "legacy_id", "old_id", "import_id", "ref", "reference", "id_externo"],
};

export const TRIP_ALIASES: Record<string, string[]> = {
  patientName: ["patient_name", "patientname", "patient", "rider", "rider_name", "member", "member_name", "nombre_paciente", "passenger", "client", "client_name"],
  patientFirstName: ["patient_first_name", "rider_first", "member_first", "passenger_first"],
  patientLastName: ["patient_last_name", "rider_last", "member_last", "passenger_last"],
  patientPhone: ["patient_phone", "rider_phone", "member_phone", "contact_phone"],
  patientEmail: ["patient_email", "rider_email", "member_email", "contact_email"],
  patientExternalId: ["patient_id", "patientid", "member_id", "memberid", "rider_id", "medicaid_id"],
  pickupAddress: ["pickup_address", "pickupaddress", "pickup", "origin", "from", "from_address", "origen", "pickup_location", "pick_up", "pu_address", "start_address"],
  dropoffAddress: ["dropoff_address", "dropoffaddress", "dropoff", "destination", "to", "to_address", "destino", "dropoff_location", "drop_off", "do_address", "end_address", "delivery_address"],
  pickupLat: ["pickup_lat", "pickup_latitude", "origin_lat", "from_lat", "pu_lat", "start_lat"],
  pickupLng: ["pickup_lng", "pickup_longitude", "pickup_lon", "origin_lng", "from_lng", "pu_lng", "start_lng"],
  dropoffLat: ["dropoff_lat", "dropoff_latitude", "dest_lat", "to_lat", "do_lat", "end_lat"],
  dropoffLng: ["dropoff_lng", "dropoff_longitude", "dropoff_lon", "dest_lng", "to_lng", "do_lng", "end_lng"],
  scheduledAt: ["scheduled_at", "scheduledat", "scheduled_date", "schedule_date", "appointment_date", "appointment_time", "appointment", "pickup_time", "pickup_date", "trip_date", "trip_time", "date", "time", "fecha", "fecha_cita"],
  scheduledTime: ["scheduled_time", "time", "pickup_time", "appointment_time", "hora", "hora_cita"],
  notes: ["notes", "note", "trip_notes", "special_instructions", "instructions", "comments", "notas", "accommodations"],
  vehicleType: ["vehicle_type", "vehicletype", "vehicle", "transport_type", "mode", "service_type", "tipo_vehiculo", "trip_type"],
  estimatedMiles: ["estimated_miles", "miles", "distance", "mileage", "distancia", "est_miles"],
  status: ["status", "trip_status", "estado"],
  externalId: ["external_id", "externalid", "trip_id", "tripid", "legacy_id", "ref", "reference", "booking_id", "confirmation"],
};

export const DRIVER_ALIASES: Record<string, string[]> = {
  firstName: ["first_name", "firstname", "first name", "fname", "nombre", "given_name"],
  lastName: ["last_name", "lastname", "last name", "lname", "apellido", "surname", "family_name"],
  email: ["email", "email_address", "e_mail", "correo", "driver_email"],
  phone: ["phone", "phone_number", "mobile", "cell", "celular", "telefono", "driver_phone"],
  vehicleType: ["vehicle_type", "vehicletype", "vehicle", "car_type", "tipo_vehiculo"],
  licenseNumber: ["license_number", "license", "license_plate", "plate", "tag", "placa", "driver_license"],
  externalId: ["external_id", "externalid", "driver_id", "driverid", "legacy_id", "employee_id", "badge"],
};

// ── Data Normalizers ──────────────────────────────────────────────────

export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 7) return `+${digits}`;
  return null; // too short to be valid
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed.includes("@") || !trimmed.includes(".")) return null;
  return trimmed;
}

export function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Try ISO format first (YYYY-MM-DD)
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  }

  // MM/DD/YYYY or MM-DD-YYYY
  const usMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (usMatch) {
    return `${usMatch[3]}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
  }

  // MM/DD/YY
  const usShortMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (usShortMatch) {
    const year = parseInt(usShortMatch[3]) > 50 ? `19${usShortMatch[3]}` : `20${usShortMatch[3]}`;
    return `${year}-${usShortMatch[1].padStart(2, "0")}-${usShortMatch[2].padStart(2, "0")}`;
  }

  // DD/MM/YYYY (European) — only if month > 12 so we know it's DD first
  const euroMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (euroMatch && parseInt(euroMatch[1]) > 12) {
    return `${euroMatch[3]}-${euroMatch[2].padStart(2, "0")}-${euroMatch[1].padStart(2, "0")}`;
  }

  // Try native Date parse as last resort
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1900) {
    return parsed.toISOString().split("T")[0];
  }

  return null;
}

export function normalizeDateTime(dateStr: string | null | undefined, timeStr?: string | null): Date | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();

  // If it already looks like a full ISO datetime
  if (trimmed.includes("T") || trimmed.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/)) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }

  const dateOnly = normalizeDate(trimmed);
  if (!dateOnly) return null;

  if (timeStr) {
    const time = timeStr.trim();
    // Handle 12h format
    const match12 = time.match(/^(\d{1,2}):(\d{2})\s*(am|pm|AM|PM)$/);
    if (match12) {
      let h = parseInt(match12[1]);
      const m = parseInt(match12[2]);
      if (match12[3].toLowerCase() === "pm" && h < 12) h += 12;
      if (match12[3].toLowerCase() === "am" && h === 12) h = 0;
      return new Date(`${dateOnly}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
    }
    // Handle 24h format
    const match24 = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (match24) {
      return new Date(`${dateOnly}T${match24[1].padStart(2, "0")}:${match24[2]}:${match24[3] || "00"}`);
    }
  }

  // Default to midnight
  return new Date(`${dateOnly}T09:00:00`);
}

export function normalizeBoolean(raw: string | null | undefined): boolean | null {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (["true", "yes", "1", "si", "sí", "y", "t", "on", "active", "activo"].includes(v)) return true;
  if (["false", "no", "0", "n", "f", "off", "inactive", "inactivo", ""].includes(v)) return false;
  return null;
}

export function normalizeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Title case
  return trimmed
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Mc|Mac|O')(\w)/g, (_, prefix, letter) => prefix + letter.toUpperCase());
}

export function normalizeAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 5) return null;
  // Normalize common abbreviations
  return trimmed
    .replace(/\bSt\b\.?(?!\w)/gi, "St")
    .replace(/\bAve\b\.?(?!\w)/gi, "Ave")
    .replace(/\bBlvd\b\.?(?!\w)/gi, "Blvd")
    .replace(/\bDr\b\.?(?!\w)/gi, "Dr")
    .replace(/\bLn\b\.?(?!\w)/gi, "Ln")
    .replace(/\bRd\b\.?(?!\w)/gi, "Rd")
    .replace(/\bCt\b\.?(?!\w)/gi, "Ct")
    .replace(/\s+/g, " ");
}

// ── File Parsing ──────────────────────────────────────────────────────

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
}

export function parseCSV(content: string | Buffer): ParsedFile {
  const text = typeof content === "string" ? content : content.toString("utf-8");
  // Strip BOM
  const clean = text.replace(/^\uFEFF/, "");

  // Detect delimiter
  const firstLine = clean.split("\n")[0] || "";
  const delimiter = firstLine.split("\t").length > firstLine.split(",").length ? "\t" : ",";

  const records: string[][] = parse(clean, {
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (records.length < 2) {
    return { headers: records[0] || [], rows: [], totalRows: 0 };
  }

  const headers = records[0].map((h: string) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < records.length; i++) {
    const row: Record<string, string> = {};
    let hasValue = false;
    for (let j = 0; j < headers.length; j++) {
      const val = (records[i][j] || "").trim();
      row[headers[j]] = val;
      if (val) hasValue = true;
    }
    if (hasValue) rows.push(row);
  }

  return { headers, rows, totalRows: rows.length };
}

export async function parseExcel(buffer: Buffer): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) {
    return { headers: [], rows: [], totalRows: 0 };
  }

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value || "").trim();
  });

  const rows: Record<string, string>[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const sheetRow = sheet.getRow(r);
    const row: Record<string, string> = {};
    let hasValue = false;
    sheetRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header) {
        let val: string;
        if (cell.value instanceof Date) {
          val = cell.value.toISOString();
        } else {
          val = String(cell.value ?? "").trim();
        }
        row[header] = val;
        if (val) hasValue = true;
      }
    });
    if (hasValue) rows.push(row);
  }

  return { headers, rows, totalRows: rows.length };
}

export function parseFile(filename: string, content: Buffer): Promise<ParsedFile> | ParsedFile {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xls") {
    return parseExcel(content);
  }
  return parseCSV(content);
}

// ── Column Mapping ────────────────────────────────────────────────────

export interface ColumnMapping {
  sourceColumn: string;
  targetField: string;
  confidence: "exact" | "alias" | "fuzzy" | "manual";
}

export function autoMapColumns(
  sourceHeaders: string[],
  aliasMap: Record<string, string[]>
): { mapped: ColumnMapping[]; unmapped: string[] } {
  const mapped: ColumnMapping[] = [];
  const used = new Set<string>();
  const unmapped: string[] = [];

  for (const header of sourceHeaders) {
    const normalized = header.toLowerCase().trim().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    let found = false;

    for (const [targetField, aliases] of Object.entries(aliasMap)) {
      if (used.has(targetField)) continue;

      // Exact match on target field name
      if (normalized === targetField.toLowerCase()) {
        mapped.push({ sourceColumn: header, targetField, confidence: "exact" });
        used.add(targetField);
        found = true;
        break;
      }

      // Alias match
      if (aliases.some((a) => a.replace(/\s+/g, "_") === normalized || a.replace(/[_\s]+/g, "") === normalized.replace(/_/g, ""))) {
        mapped.push({ sourceColumn: header, targetField, confidence: "alias" });
        used.add(targetField);
        found = true;
        break;
      }
    }

    if (!found) {
      // Fuzzy: check if header contains target field name or vice versa
      for (const [targetField, aliases] of Object.entries(aliasMap)) {
        if (used.has(targetField)) continue;
        const allTerms = [targetField.toLowerCase(), ...aliases];
        if (allTerms.some((t) => normalized.includes(t.replace(/\s+/g, "_")) || t.replace(/\s+/g, "_").includes(normalized))) {
          if (normalized.length >= 3) {
            mapped.push({ sourceColumn: header, targetField, confidence: "fuzzy" });
            used.add(targetField);
            found = true;
            break;
          }
        }
      }
    }

    if (!found) {
      unmapped.push(header);
    }
  }

  return { mapped, unmapped };
}

// ── Row Validation ────────────────────────────────────────────────────

export interface RowError {
  row: number;
  field: string;
  value: string | null;
  message: string;
  severity: "error" | "warning";
}

export interface ValidatedRow<T> {
  rowNumber: number;
  data: T;
  errors: RowError[];
  warnings: RowError[];
}

export function extractMappedValue(row: Record<string, string>, mapping: ColumnMapping[]): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const m of mapping) {
    const val = row[m.sourceColumn];
    result[m.targetField] = val && val.trim() ? val.trim() : null;
  }
  return result;
}

// ── Deduplication ─────────────────────────────────────────────────────

export type DedupeStrategy = "email" | "phone" | "name_dob" | "external_id" | "name_address";

export function generateDedupeKey(
  data: Record<string, string | null>,
  strategy: DedupeStrategy
): string | null {
  switch (strategy) {
    case "email": {
      const email = normalizeEmail(data.email);
      return email ? `email:${email}` : null;
    }
    case "phone": {
      const phone = normalizePhone(data.phone);
      return phone ? `phone:${phone}` : null;
    }
    case "name_dob": {
      const fn = (data.firstName || "").toLowerCase().trim();
      const ln = (data.lastName || "").toLowerCase().trim();
      const dob = normalizeDate(data.dateOfBirth);
      return fn && ln && dob ? `name_dob:${fn}|${ln}|${dob}` : null;
    }
    case "external_id": {
      const eid = (data.externalId || "").trim();
      return eid ? `ext:${eid}` : null;
    }
    case "name_address": {
      const fn = (data.firstName || "").toLowerCase().trim();
      const ln = (data.lastName || "").toLowerCase().trim();
      const addr = (data.address || "").toLowerCase().trim().slice(0, 30);
      return fn && ln && addr ? `name_addr:${fn}|${ln}|${addr}` : null;
    }
  }
}

export type EntityType = "patients" | "trips" | "drivers";

export function getAliasMap(entity: EntityType): Record<string, string[]> {
  switch (entity) {
    case "patients": return PATIENT_ALIASES;
    case "trips": return TRIP_ALIASES;
    case "drivers": return DRIVER_ALIASES;
  }
}
