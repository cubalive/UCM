import { z } from "zod";
import * as XLSX from "xlsx";
import { parse as csvParse } from "csv-parse/sync";

export const IMPORT_ENTITIES = ["clinics", "patients", "drivers", "vehicles"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export const ClinicCanonical = z.object({
  external_id: z.string().optional(),
  name: z.string().min(1),
  address: z.string().min(1),
  address_street: z.string().optional(),
  address_city: z.string().optional(),
  address_state: z.string().optional(),
  address_zip: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  contact_name: z.string().optional(),
  facility_type: z.enum(["clinic", "hospital", "mental", "private"]).optional(),
});

export const PatientCanonical = z.object({
  external_id: z.string().optional(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(),
  address_street: z.string().optional(),
  address_city: z.string().optional(),
  address_state: z.string().optional(),
  address_zip: z.string().optional(),
  date_of_birth: z.string().optional(),
  insurance_id: z.string().optional(),
  wheelchair_required: z.union([z.boolean(), z.string()]).optional(),
  clinic_name: z.string().optional(),
  clinic_external_id: z.string().optional(),
  notes: z.string().optional(),
});

export const DriverCanonical = z.object({
  external_id: z.string().optional(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  license_number: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE"]).optional(),
});

export const VehicleCanonical = z.object({
  external_id: z.string().optional(),
  name: z.string().min(1),
  license_plate: z.string().min(1),
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

const SUPABASE_CLINIC_MAP: MappingPreset = {
  id: "external_id", name: "name", address: "address",
  address_street: "address_street", address_city: "address_city",
  address_state: "address_state", address_zip: "address_zip",
  email: "email", phone: "phone", contact_name: "contact_name",
  facility_type: "facility_type",
};
const SUPABASE_PATIENT_MAP: MappingPreset = {
  id: "external_id", first_name: "first_name", last_name: "last_name",
  phone: "phone", email: "email", address: "address",
  date_of_birth: "date_of_birth", insurance_id: "insurance_id",
  wheelchair_required: "wheelchair_required", notes: "notes",
  clinic_id: "clinic_external_id",
};
const SUPABASE_DRIVER_MAP: MappingPreset = {
  id: "external_id", first_name: "first_name", last_name: "last_name",
  phone: "phone", email: "email", license_number: "license_number",
  status: "status",
};
const SUPABASE_VEHICLE_MAP: MappingPreset = {
  id: "external_id", name: "name", license_plate: "license_plate",
  make: "make", model: "model", year: "year", capacity: "capacity",
  wheelchair_accessible: "wheelchair_accessible", capability: "capability",
  status: "status",
};

const EXCEL_GENERIC_CLINIC_MAP: MappingPreset = {
  "Clinic Name": "name", "Name": "name", "Address": "address",
  "Street": "address_street", "City": "address_city",
  "State": "address_state", "Zip": "address_zip", "ZIP": "address_zip",
  "Email": "email", "Phone": "phone", "Contact": "contact_name",
  "Type": "facility_type", "ID": "external_id", "External ID": "external_id",
};
const EXCEL_GENERIC_PATIENT_MAP: MappingPreset = {
  "First Name": "first_name", "Last Name": "last_name", "FirstName": "first_name",
  "LastName": "last_name", "Phone": "phone", "Email": "email",
  "Address": "address", "DOB": "date_of_birth", "Date of Birth": "date_of_birth",
  "Insurance ID": "insurance_id", "Wheelchair": "wheelchair_required",
  "Clinic": "clinic_name", "Notes": "notes", "ID": "external_id",
};
const EXCEL_GENERIC_DRIVER_MAP: MappingPreset = {
  "First Name": "first_name", "Last Name": "last_name", "FirstName": "first_name",
  "LastName": "last_name", "Phone": "phone", "Email": "email",
  "License": "license_number", "License Number": "license_number",
  "Status": "status", "ID": "external_id",
};
const EXCEL_GENERIC_VEHICLE_MAP: MappingPreset = {
  "Vehicle Name": "name", "Name": "name", "License Plate": "license_plate",
  "Plate": "license_plate", "Make": "make", "Model": "model", "Year": "year",
  "Capacity": "capacity", "Wheelchair": "wheelchair_accessible",
  "Type": "capability", "Status": "status", "ID": "external_id",
};

const PRESETS: Record<string, Record<ImportEntity, MappingPreset>> = {
  supabase: { clinics: SUPABASE_CLINIC_MAP, patients: SUPABASE_PATIENT_MAP, drivers: SUPABASE_DRIVER_MAP, vehicles: SUPABASE_VEHICLE_MAP },
  excel_generic: { clinics: EXCEL_GENERIC_CLINIC_MAP, patients: EXCEL_GENERIC_PATIENT_MAP, drivers: EXCEL_GENERIC_DRIVER_MAP, vehicles: EXCEL_GENERIC_VEHICLE_MAP },
  uber_health_like: { clinics: EXCEL_GENERIC_CLINIC_MAP, patients: EXCEL_GENERIC_PATIENT_MAP, drivers: EXCEL_GENERIC_DRIVER_MAP, vehicles: EXCEL_GENERIC_VEHICLE_MAP },
};

function buildIdentityMap(keys: string[]): MappingPreset {
  const m: MappingPreset = {};
  for (const k of keys) m[k] = k;
  return m;
}

export function getMapping(sourceSystem: string, entity: ImportEntity, sampleRow: Record<string, any>): MappingPreset {
  const preset = PRESETS[sourceSystem]?.[entity];
  if (preset) return preset;
  return buildIdentityMap(Object.keys(sampleRow));
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
    case "patients": return `${row.first_name || ""}|${row.last_name || ""}|${row.date_of_birth || ""}|${row.phone || ""}`.toLowerCase();
    case "drivers": return `${row.phone || ""}|${row.email || ""}`.toLowerCase();
    case "vehicles": return `${row.license_plate || ""}`.toUpperCase();
  }
}
