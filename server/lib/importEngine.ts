import { z } from "zod";
import * as XLSX from "xlsx";
import { parse as csvParse } from "csv-parse/sync";

export const IMPORT_ENTITIES = ["clinics", "patients", "drivers", "vehicles"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const ClinicCanonical = z.object({
  external_id: z.string().optional(),
  name: z.string().min(1, "name is required"),
  service_city: z.string().optional(),
  address: z.string().optional(),
  address_street: z.string().optional(),
  address_city: z.string().optional(),
  address_state: z.string().optional(),
  address_zip: z.string().optional(),
  email: z.string().email("invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  contact_name: z.string().optional(),
  facility_type: z.enum(["clinic", "hospital", "mental", "private"]).optional(),
});

export const PatientCanonical = z.object({
  external_id: z.string().optional(),
  first_name: z.string().min(1, "first_name is required"),
  last_name: z.string().min(1, "last_name is required"),
  phone: z.string().optional(),
  email: z.string().email("invalid email").optional().or(z.literal("")),
  address: z.string().optional(),
  address_street: z.string().optional(),
  address_city: z.string().optional(),
  address_state: z.string().optional(),
  address_zip: z.string().optional(),
  date_of_birth: z.string().optional(),
  dob: z.string().optional(),
  insurance_id: z.string().optional(),
  wheelchair_required: z.union([z.boolean(), z.string()]).optional(),
  mobility_type: z.string().optional(),
  clinic_name: z.string().optional(),
  clinic_external_id: z.string().optional(),
  notes: z.string().optional(),
});

export const DriverCanonical = z.object({
  external_id: z.string().optional(),
  first_name: z.string().min(1, "first_name is required"),
  last_name: z.string().min(1, "last_name is required"),
  phone: z.string().min(1, "phone is required"),
  email: z.string().email("invalid email").optional().or(z.literal("")),
  license_number: z.string().optional(),
  city: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE"]).optional(),
});

export const VehicleCanonical = z.object({
  external_id: z.string().optional(),
  city: z.string().optional(),
  name: z.string().min(1, "name is required"),
  license_plate: z.string().min(1, "license_plate is required"),
  color: z.string().optional(),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.union([z.number(), z.string()]).optional(),
  capacity: z.union([z.number(), z.string()]).optional(),
  wheelchair_accessible: z.union([z.boolean(), z.string()]).optional(),
  capability: z.string().optional(),
  status: z.enum(["ACTIVE", "MAINTENANCE", "OUT_OF_SERVICE"]).optional(),
});

export type ClinicCanonicalType = z.infer<typeof ClinicCanonical>;
export type PatientCanonicalType = z.infer<typeof PatientCanonical>;
export type DriverCanonicalType = z.infer<typeof DriverCanonical>;
export type VehicleCanonicalType = z.infer<typeof VehicleCanonical>;

export function getCanonicalSchema(entity: ImportEntity) {
  switch (entity) {
    case "clinics": return ClinicCanonical;
    case "patients": return PatientCanonical;
    case "drivers": return DriverCanonical;
    case "vehicles": return VehicleCanonical;
  }
}

export const TEMPLATE_HEADERS: Record<ImportEntity, string[]> = {
  clinics: ["name", "service_city", "email", "address", "facility_type", "phone", "contact_name"],
  drivers: ["email", "first_name", "last_name", "phone", "license_number", "city"],
  vehicles: ["city", "name", "license_plate", "color", "make", "model", "year", "capacity", "wheelchair_accessible", "capability"],
  patients: ["first_name", "last_name", "phone", "email", "address", "dob", "insurance_id", "mobility_type"],
};

export function generateTemplateCsv(entity: ImportEntity): string {
  const headers = TEMPLATE_HEADERS[entity];
  return headers.join(",") + "\n";
}

export function normalizeHeader(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

const CLINIC_ALIASES: Record<string, string> = {
  clinic_name: "name",
  clinic: "name",
  facility_name: "name",
  service_city: "service_city",
  city: "service_city",
  address: "address",
  street: "address_street",
  street_address: "address_street",
  address_street: "address_street",
  address_city: "address_city",
  state: "address_state",
  address_state: "address_state",
  zip: "address_zip",
  zip_code: "address_zip",
  zipcode: "address_zip",
  address_zip: "address_zip",
  postal_code: "address_zip",
  email: "email",
  email_address: "email",
  phone: "phone",
  phone_number: "phone",
  telephone: "phone",
  contact: "contact_name",
  contact_name: "contact_name",
  contact_person: "contact_name",
  type: "facility_type",
  facility_type: "facility_type",
  facility: "facility_type",
  id: "external_id",
  external_id: "external_id",
  ext_id: "external_id",
  name: "name",
};

const PATIENT_ALIASES: Record<string, string> = {
  first_name: "first_name",
  firstname: "first_name",
  first: "first_name",
  given_name: "first_name",
  last_name: "last_name",
  lastname: "last_name",
  last: "last_name",
  surname: "last_name",
  family_name: "last_name",
  phone: "phone",
  phone_number: "phone",
  telephone: "phone",
  mobile: "phone",
  cell: "phone",
  email: "email",
  email_address: "email",
  address: "address",
  street: "address_street",
  address_street: "address_street",
  city: "address_city",
  address_city: "address_city",
  state: "address_state",
  address_state: "address_state",
  zip: "address_zip",
  zip_code: "address_zip",
  address_zip: "address_zip",
  dob: "dob",
  date_of_birth: "dob",
  dateofbirth: "dob",
  birth_date: "dob",
  birthdate: "dob",
  birthday: "dob",
  insurance_id: "insurance_id",
  insurance: "insurance_id",
  insurance_number: "insurance_id",
  policy_number: "insurance_id",
  wheelchair: "wheelchair_required",
  wheelchair_required: "wheelchair_required",
  mobility: "mobility_type",
  mobility_type: "mobility_type",
  mobility_requirement: "mobility_type",
  transport_type: "mobility_type",
  clinic: "clinic_name",
  clinic_name: "clinic_name",
  notes: "notes",
  id: "external_id",
  external_id: "external_id",
  ext_id: "external_id",
};

const DRIVER_ALIASES: Record<string, string> = {
  first_name: "first_name",
  firstname: "first_name",
  first: "first_name",
  given_name: "first_name",
  last_name: "last_name",
  lastname: "last_name",
  last: "last_name",
  surname: "last_name",
  family_name: "last_name",
  phone: "phone",
  phone_number: "phone",
  telephone: "phone",
  mobile: "phone",
  cell: "phone",
  email: "email",
  email_address: "email",
  license: "license_number",
  license_number: "license_number",
  licence: "license_number",
  licence_number: "license_number",
  dl_number: "license_number",
  drivers_license: "license_number",
  city: "city",
  service_city: "city",
  status: "status",
  id: "external_id",
  external_id: "external_id",
  ext_id: "external_id",
};

const VEHICLE_ALIASES: Record<string, string> = {
  city: "city",
  service_city: "city",
  name: "name",
  vehicle_name: "name",
  vehicle: "name",
  unit_name: "name",
  license_plate: "license_plate",
  plate: "license_plate",
  plate_number: "license_plate",
  tag: "license_plate",
  tag_number: "license_plate",
  registration: "license_plate",
  color: "color",
  colour: "color",
  vehicle_color: "color",
  color_hex: "color",
  make: "make",
  manufacturer: "make",
  brand: "make",
  model: "model",
  vehicle_model: "model",
  year: "year",
  model_year: "year",
  capacity: "capacity",
  seats: "capacity",
  passenger_capacity: "capacity",
  wheelchair: "wheelchair_accessible",
  wheelchair_accessible: "wheelchair_accessible",
  ada: "wheelchair_accessible",
  ada_accessible: "wheelchair_accessible",
  type: "capability",
  capability: "capability",
  vehicle_type: "capability",
  transport_type: "capability",
  status: "status",
  id: "external_id",
  external_id: "external_id",
  ext_id: "external_id",
};

const ALIAS_MAPS: Record<ImportEntity, Record<string, string>> = {
  clinics: CLINIC_ALIASES,
  patients: PATIENT_ALIASES,
  drivers: DRIVER_ALIASES,
  vehicles: VEHICLE_ALIASES,
};

export function resolveAlias(normalizedHeader: string, entity: ImportEntity): string | null {
  return ALIAS_MAPS[entity][normalizedHeader] || null;
}

export function normalizeHeaders(rawHeaders: string[], entity: ImportEntity): { normalized: string[]; mapping: Record<string, string>; unmapped: string[] } {
  const mapping: Record<string, string> = {};
  const unmapped: string[] = [];
  const normalized: string[] = [];

  for (const raw of rawHeaders) {
    const norm = normalizeHeader(raw);
    const canonical = resolveAlias(norm, entity);
    if (canonical) {
      mapping[raw] = canonical;
      normalized.push(canonical);
    } else {
      unmapped.push(raw);
      normalized.push(norm);
    }
  }

  return { normalized, mapping, unmapped };
}

export function applyHeaderMapping(rows: Record<string, any>[], entity: ImportEntity): { mapped: Record<string, any>[]; headerInfo: { detected: string[]; mapped: Record<string, string>; unmapped: string[] } } {
  if (rows.length === 0) return { mapped: [], headerInfo: { detected: [], mapped: {}, unmapped: [] } };

  const rawHeaders = Object.keys(rows[0]);
  const { mapping, unmapped } = normalizeHeaders(rawHeaders, entity);

  const mapped = rows.map(row => {
    const result: Record<string, any> = {};
    for (const [rawCol, value] of Object.entries(row)) {
      const canonicalKey = mapping[rawCol];
      if (canonicalKey) {
        const v = typeof value === "string" ? value.trim() : value;
        if (v !== "" && v !== undefined && v !== null) {
          result[canonicalKey] = v;
        }
      }
    }
    return result;
  });

  return {
    mapped,
    headerInfo: {
      detected: rawHeaders,
      mapped: mapping,
      unmapped,
    },
  };
}

export interface EntityDefaults {
  defaultCity?: string;
}

export function applyDefaults(row: Record<string, any>, entity: ImportEntity, rowIndex: number, defaults?: EntityDefaults): Record<string, any> {
  const r = { ...row };
  const city = defaults?.defaultCity || "Las Vegas";

  switch (entity) {
    case "clinics":
      if (!r.service_city) r.service_city = city;
      if (!r.facility_type) r.facility_type = "clinic";
      if (!r.address) r.address = r.address_street ? `${r.address_street}, ${r.address_city || city}, ${r.address_state || "NV"}` : "N/A";
      if (!r.email) r.email = `seed.clinic.${rowIndex + 1}@ucm.test`;
      break;
    case "drivers":
      if (!r.city) r.city = city;
      if (!r.email) r.email = `seed.driver.${rowIndex + 1}@ucm.test`;
      break;
    case "vehicles":
      if (!r.city) r.city = city;
      if (!r.color) r.color = "#3B82F6";
      if (r.capacity === undefined || r.capacity === "") r.capacity = 4;
      if (r.wheelchair_accessible === undefined || r.wheelchair_accessible === "") r.wheelchair_accessible = false;
      if (!r.capability) r.capability = "SEDAN";
      break;
    case "patients":
      if (!r.email) r.email = `seed.patient.${rowIndex + 1}@ucm.test`;
      if (r.dob && !r.date_of_birth) r.date_of_birth = r.dob;
      if (r.mobility_type) {
        r.wheelchair_required = normalizeMobility(r.mobility_type) === "WHEELCHAIR";
      }
      break;
  }

  return r;
}

export function normalizePhone(raw: string | undefined | null): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

export function normalizeDate(raw: string | undefined | null): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toISOString().split("T")[0];
}

export function normalizeState(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw.trim().toUpperCase().slice(0, 2);
}

export function normalizeBool(raw: any): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const lower = raw.toLowerCase().trim();
    return ["true", "yes", "1", "y"].includes(lower);
  }
  if (typeof raw === "number") return raw !== 0;
  return false;
}

export function normalizeMobility(raw: string | undefined | null): string {
  if (!raw) return "SEDAN";
  const upper = raw.toUpperCase().trim();
  if (upper.includes("WHEEL")) return "WHEELCHAIR";
  if (upper.includes("STRETCH")) return "STRETCHER";
  if (upper.includes("BARIATRIC")) return "BARIATRIC";
  return "SEDAN";
}

export function normalizeCapability(raw: string | undefined | null): string {
  if (!raw) return "SEDAN";
  const upper = raw.toUpperCase().trim();
  if (upper.includes("WHEEL")) return "WHEELCHAIR";
  if (upper.includes("STRETCH")) return "STRETCHER";
  if (upper === "SEDAN" || upper === "STANDARD") return "SEDAN";
  return raw;
}

export function detectFileType(filename: string, mimeType: string): "csv" | "xlsx" | "json" | "unknown" {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "csv" || mimeType === "text/csv") return "csv";
  if (ext === "xlsx" || ext === "xls" || mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "xlsx";
  if (ext === "json" || mimeType === "application/json") return "json";
  return "unknown";
}

export function parseFileToRows(buffer: Buffer, filename: string, mimeType: string): Record<string, any>[] {
  const type = detectFileType(filename, mimeType);
  switch (type) {
    case "csv": return parseCsv(buffer);
    case "xlsx": return parseXlsx(buffer);
    case "json": return parseJson(buffer);
    default: throw new Error(`Unsupported file type: ${filename}`);
  }
}

function parseCsv(buffer: Buffer): Record<string, any>[] {
  return csvParse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
}

function parseXlsx(buffer: Buffer): Record<string, any>[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
}

function parseJson(buffer: Buffer): Record<string, any>[] {
  const data = JSON.parse(buffer.toString("utf-8"));
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && Array.isArray(data.data)) return data.data;
  if (data && typeof data === "object" && Array.isArray(data.rows)) return data.rows;
  throw new Error("JSON must be an array of objects or contain a data/rows array");
}

type MappingPreset = Record<string, string>;

export function getMapping(sourceSystem: string, entity: ImportEntity, sampleRow: Record<string, any>): MappingPreset {
  return buildIdentityMap(Object.keys(sampleRow));
}

function buildIdentityMap(keys: string[]): MappingPreset {
  const m: MappingPreset = {};
  for (const k of keys) m[k] = k;
  return m;
}

export function applyMapping(row: Record<string, any>, mapping: MappingPreset): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [sourceCol, canonicalKey] of Object.entries(mapping)) {
    if (row[sourceCol] !== undefined && row[sourceCol] !== "") {
      result[canonicalKey] = typeof row[sourceCol] === "string" ? row[sourceCol].trim() : row[sourceCol];
    }
  }
  return result;
}

export function dedupeRows(rows: Record<string, any>[], entity: ImportEntity): { unique: Record<string, any>[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: Record<string, any>[] = [];
  let duplicates = 0;
  for (const row of rows) {
    const key = getDedupeKey(row, entity);
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    unique.push(row);
  }
  return { unique, duplicates };
}

function getDedupeKey(row: Record<string, any>, entity: ImportEntity): string {
  switch (entity) {
    case "clinics": return `${row.name || ""}|${row.phone || ""}|${row.email || ""}`.toLowerCase();
    case "patients": return `${row.first_name || ""}|${row.last_name || ""}|${row.date_of_birth || row.dob || ""}|${row.phone || ""}`.toLowerCase();
    case "drivers": return `${row.phone || ""}|${row.email || ""}`.toLowerCase();
    case "vehicles": return `${row.license_plate || ""}`.toUpperCase();
  }
}

export interface DryRunResult {
  entity: string;
  headerInfo: {
    detected: string[];
    mapped: Record<string, string>;
    unmapped: string[];
  };
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  missingRequiredFields: string[];
  rowErrors: { row: number; field: string; message: string }[];
  preview: Record<string, any>[];
}

export function dryRunEntity(
  entity: ImportEntity,
  rows: Record<string, any>[],
  defaults?: EntityDefaults,
): DryRunResult {
  const { mapped, headerInfo } = applyHeaderMapping(rows, entity);
  const { unique, duplicates } = dedupeRows(mapped, entity);

  const schema = getCanonicalSchema(entity);
  let validRows = 0;
  let errorRows = 0;
  const rowErrors: { row: number; field: string; message: string }[] = [];
  const missingFieldSet = new Set<string>();
  const previewRows: Record<string, any>[] = [];

  for (let i = 0; i < unique.length; i++) {
    const normalized = normalizeRowValues(applyDefaults(unique[i], entity, i, defaults), entity);
    const result = schema.safeParse(normalized);

    if (result.success) {
      validRows++;
      if (previewRows.length < 10) previewRows.push(normalized);
    } else {
      errorRows++;
      for (const issue of result.error.issues) {
        const field = issue.path.join(".");
        const msg = issue.message;
        rowErrors.push({ row: i + 1, field, message: `${entity} row ${i + 1}: ${field} ${msg}` });
        if (msg.includes("required") || msg === "Required") {
          missingFieldSet.add(field);
        }
      }
      if (previewRows.length < 10) previewRows.push(normalized);
    }
  }

  return {
    entity,
    headerInfo,
    totalRows: rows.length,
    validRows,
    errorRows,
    duplicateRows: duplicates,
    missingRequiredFields: [...missingFieldSet],
    rowErrors: rowErrors.slice(0, 50),
    preview: previewRows,
  };
}

export function normalizeRowValues(row: Record<string, any>, entity: ImportEntity): Record<string, any> {
  const r = { ...row };
  if (r.phone) r.phone = normalizePhone(r.phone);
  if (r.date_of_birth) r.date_of_birth = normalizeDate(r.date_of_birth);
  if (r.dob) {
    r.date_of_birth = normalizeDate(r.dob);
    if (!r.dob_original) r.dob = r.date_of_birth;
  }
  if (r.address_state) r.address_state = normalizeState(r.address_state);
  if (entity === "vehicles" && r.license_plate) r.license_plate = r.license_plate.toUpperCase().trim();
  if (r.wheelchair_required !== undefined) r.wheelchair_required = normalizeBool(r.wheelchair_required);
  if (r.wheelchair_accessible !== undefined) r.wheelchair_accessible = normalizeBool(r.wheelchair_accessible);
  if (r.year && typeof r.year === "string") r.year = parseInt(r.year, 10) || undefined;
  if (r.capacity && typeof r.capacity === "string") r.capacity = parseInt(r.capacity, 10) || 4;
  if (r.email === "") delete r.email;
  if (entity === "vehicles" && r.capability) r.capability = normalizeCapability(r.capability);
  if (entity === "clinics" && r.facility_type) {
    r.facility_type = r.facility_type.toLowerCase().trim();
    if (!["clinic", "hospital", "mental", "private"].includes(r.facility_type)) {
      r.facility_type = "clinic";
    }
  }
  return r;
}
