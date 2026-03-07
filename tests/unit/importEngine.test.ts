/**
 * UCM Import Engine Tests
 * Covers: CSV/Excel parsing, column mapping, data normalizers, dedup keys
 */
import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  normalizeEmail,
  normalizeDate,
  normalizeDateTime,
  normalizeBoolean,
  normalizeName,
  normalizeAddress,
  parseCSV,
  autoMapColumns,
  extractMappedValue,
  generateDedupeKey,
  PATIENT_ALIASES,
  TRIP_ALIASES,
  DRIVER_ALIASES,
} from "../../src/services/importEngine.js";

// ============================================================
// PHONE NORMALIZATION
// ============================================================
describe("normalizePhone", () => {
  it("normalizes 10-digit US phone", () => {
    expect(normalizePhone("3055551234")).toBe("+13055551234");
  });

  it("normalizes 11-digit with leading 1", () => {
    expect(normalizePhone("13055551234")).toBe("+13055551234");
  });

  it("strips formatting characters", () => {
    expect(normalizePhone("(305) 555-1234")).toBe("+13055551234");
    expect(normalizePhone("305.555.1234")).toBe("+13055551234");
    expect(normalizePhone("305-555-1234")).toBe("+13055551234");
  });

  it("handles international prefix +1", () => {
    expect(normalizePhone("+1 305 555 1234")).toBe("+13055551234");
  });

  it("returns null for empty/null", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("returns null for too-short numbers", () => {
    expect(normalizePhone("12345")).toBeNull();
  });

  it("handles 8+ digit international numbers", () => {
    expect(normalizePhone("5215551234567")).toBe("+5215551234567");
  });
});

// ============================================================
// EMAIL NORMALIZATION
// ============================================================
describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  John@Example.COM  ")).toBe("john@example.com");
  });

  it("returns null for invalid emails", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("missing@dot")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("accepts valid emails", () => {
    expect(normalizeEmail("user@company.co")).toBe("user@company.co");
  });
});

// ============================================================
// DATE NORMALIZATION
// ============================================================
describe("normalizeDate", () => {
  it("parses ISO format", () => {
    expect(normalizeDate("2023-03-15")).toBe("2023-03-15");
    expect(normalizeDate("2023-3-5")).toBe("2023-03-05");
  });

  it("parses US format MM/DD/YYYY", () => {
    expect(normalizeDate("03/15/2023")).toBe("2023-03-15");
    expect(normalizeDate("3/5/2023")).toBe("2023-03-05");
  });

  it("parses MM-DD-YYYY", () => {
    expect(normalizeDate("03-15-2023")).toBe("2023-03-15");
  });

  it("parses short year MM/DD/YY", () => {
    expect(normalizeDate("03/15/85")).toBe("1985-03-15");
    expect(normalizeDate("03/15/23")).toBe("2023-03-15");
  });

  it("returns null for empty/invalid", () => {
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("   ")).toBeNull();
  });
});

// ============================================================
// DATETIME NORMALIZATION
// ============================================================
describe("normalizeDateTime", () => {
  it("parses ISO datetime", () => {
    const d = normalizeDateTime("2023-03-15T09:30:00");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBe(2023);
  });

  it("combines date and 12h time", () => {
    const d = normalizeDateTime("03/15/2023", "9:30 AM");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getHours()).toBe(9);
    expect(d!.getMinutes()).toBe(30);
  });

  it("combines date and PM time", () => {
    const d = normalizeDateTime("2023-03-15", "2:00 PM");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getHours()).toBe(14);
  });

  it("combines date and 24h time", () => {
    const d = normalizeDateTime("2023-03-15", "14:30");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getHours()).toBe(14);
    expect(d!.getMinutes()).toBe(30);
  });

  it("defaults to 09:00 when no time given", () => {
    const d = normalizeDateTime("2023-03-15");
    expect(d!.getHours()).toBe(9);
  });

  it("returns null for invalid", () => {
    expect(normalizeDateTime(null)).toBeNull();
    expect(normalizeDateTime("")).toBeNull();
  });
});

// ============================================================
// BOOLEAN NORMALIZATION
// ============================================================
describe("normalizeBoolean", () => {
  it("recognizes truthy values", () => {
    for (const v of ["true", "True", "YES", "1", "si", "y", "on", "active"]) {
      expect(normalizeBoolean(v)).toBe(true);
    }
  });

  it("recognizes falsy values", () => {
    for (const v of ["false", "False", "NO", "0", "n", "off", "inactive"]) {
      expect(normalizeBoolean(v)).toBe(false);
    }
  });

  it("returns null for unrecognized", () => {
    expect(normalizeBoolean("maybe")).toBeNull();
    expect(normalizeBoolean(null)).toBeNull();
  });
});

// ============================================================
// NAME NORMALIZATION
// ============================================================
describe("normalizeName", () => {
  it("title-cases names", () => {
    expect(normalizeName("john")).toBe("John");
    expect(normalizeName("JANE DOE")).toBe("Jane Doe");
  });

  it("handles McNames and O'Names", () => {
    expect(normalizeName("mcdonald")).toBe("McDonald");
    expect(normalizeName("o'brien")).toBe("O'Brien");
  });

  it("returns null for empty", () => {
    expect(normalizeName("")).toBeNull();
    expect(normalizeName(null)).toBeNull();
    expect(normalizeName("  ")).toBeNull();
  });
});

// ============================================================
// ADDRESS NORMALIZATION
// ============================================================
describe("normalizeAddress", () => {
  it("collapses whitespace", () => {
    expect(normalizeAddress("123  Main   St")).toBe("123 Main St");
  });

  it("returns null for too-short addresses", () => {
    expect(normalizeAddress("abc")).toBeNull();
    expect(normalizeAddress(null)).toBeNull();
  });

  it("accepts valid addresses", () => {
    expect(normalizeAddress("123 Main St, Miami, FL 33101")).toBe("123 Main St, Miami, FL 33101");
  });
});

// ============================================================
// CSV PARSING
// ============================================================
describe("parseCSV", () => {
  it("parses basic CSV with headers", () => {
    const csv = "first_name,last_name,phone\nJohn,Doe,3055551234\nJane,Smith,3055555678";
    const result = parseCSV(csv);
    expect(result.headers).toEqual(["first_name", "last_name", "phone"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].first_name).toBe("John");
    expect(result.rows[1].last_name).toBe("Smith");
  });

  it("handles BOM character", () => {
    const csv = "\uFEFFname,email\nJohn,j@e.com";
    const result = parseCSV(csv);
    expect(result.headers[0]).toBe("name");
  });

  it("skips empty rows", () => {
    const csv = "name\nJohn\n\n\nJane";
    const result = parseCSV(csv);
    expect(result.rows).toHaveLength(2);
  });

  it("handles TSV (tab-separated)", () => {
    const tsv = "first_name\tlast_name\nJohn\tDoe";
    const result = parseCSV(tsv);
    expect(result.headers).toEqual(["first_name", "last_name"]);
    expect(result.rows[0].first_name).toBe("John");
  });

  it("handles quoted fields with commas", () => {
    const csv = 'name,address\nJohn,"123 Main St, Miami, FL"';
    const result = parseCSV(csv);
    expect(result.rows[0].address).toBe("123 Main St, Miami, FL");
  });

  it("returns empty for header-only file", () => {
    const csv = "name,email";
    const result = parseCSV(csv);
    expect(result.headers).toEqual(["name", "email"]);
    expect(result.rows).toHaveLength(0);
  });
});

// ============================================================
// COLUMN AUTO-MAPPING
// ============================================================
describe("autoMapColumns", () => {
  it("maps exact field names", () => {
    const { mapped } = autoMapColumns(["firstName", "lastName", "email"], PATIENT_ALIASES);
    expect(mapped).toHaveLength(3);
    expect(mapped.find(m => m.targetField === "firstName")?.confidence).toBe("exact");
  });

  it("maps common aliases", () => {
    const { mapped } = autoMapColumns(["fname", "lname", "dob", "cell"], PATIENT_ALIASES);
    expect(mapped.find(m => m.targetField === "firstName")?.sourceColumn).toBe("fname");
    expect(mapped.find(m => m.targetField === "lastName")?.sourceColumn).toBe("lname");
    expect(mapped.find(m => m.targetField === "dateOfBirth")?.sourceColumn).toBe("dob");
    expect(mapped.find(m => m.targetField === "phone")?.sourceColumn).toBe("cell");
  });

  it("maps Spanish aliases", () => {
    const { mapped } = autoMapColumns(["nombre", "apellido", "telefono", "correo"], PATIENT_ALIASES);
    expect(mapped.find(m => m.targetField === "firstName")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "lastName")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "phone")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "email")).toBeTruthy();
  });

  it("maps dispatch software column names", () => {
    const { mapped } = autoMapColumns(["rider_first", "rider_last", "member_phone", "medicaid_id"], PATIENT_ALIASES);
    expect(mapped.find(m => m.targetField === "firstName")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "lastName")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "phone")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "insuranceId")).toBeTruthy();
  });

  it("reports unmapped columns", () => {
    const { unmapped } = autoMapColumns(["first_name", "random_column", "foo_bar"], PATIENT_ALIASES);
    expect(unmapped).toContain("random_column");
    expect(unmapped).toContain("foo_bar");
  });

  it("maps trip columns", () => {
    const { mapped } = autoMapColumns(["pickup", "destination", "appointment_date", "rider_name"], TRIP_ALIASES);
    expect(mapped.find(m => m.targetField === "pickupAddress")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "dropoffAddress")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "scheduledAt")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "patientName")).toBeTruthy();
  });

  it("maps driver columns", () => {
    const { mapped } = autoMapColumns(["first_name", "last_name", "driver_email", "badge"], DRIVER_ALIASES);
    expect(mapped.find(m => m.targetField === "firstName")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "email")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "externalId")).toBeTruthy();
  });

  it("handles columns with spaces and special chars", () => {
    const { mapped } = autoMapColumns(["First Name", "Last Name", "Date of Birth"], PATIENT_ALIASES);
    expect(mapped.find(m => m.targetField === "firstName")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "lastName")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "dateOfBirth")).toBeTruthy();
  });
});

// ============================================================
// EXTRACT MAPPED VALUE
// ============================================================
describe("extractMappedValue", () => {
  it("extracts values using mapping", () => {
    const row = { "First Name": "John", "Last Name": "Doe", "Phone": "305-555-1234" };
    const mapping = [
      { sourceColumn: "First Name", targetField: "firstName", confidence: "alias" as const },
      { sourceColumn: "Last Name", targetField: "lastName", confidence: "alias" as const },
      { sourceColumn: "Phone", targetField: "phone", confidence: "alias" as const },
    ];
    const result = extractMappedValue(row, mapping);
    expect(result.firstName).toBe("John");
    expect(result.lastName).toBe("Doe");
    expect(result.phone).toBe("305-555-1234");
  });

  it("returns null for missing columns", () => {
    const row = { name: "John" };
    const mapping = [
      { sourceColumn: "email", targetField: "email", confidence: "exact" as const },
    ];
    const result = extractMappedValue(row, mapping);
    expect(result.email).toBeNull();
  });
});

// ============================================================
// DEDUPLICATION KEYS
// ============================================================
describe("generateDedupeKey", () => {
  it("generates email-based key", () => {
    const key = generateDedupeKey({ email: "John@Example.COM", phone: null, firstName: null, lastName: null, dateOfBirth: null, externalId: null, address: null }, "email");
    expect(key).toBe("email:john@example.com");
  });

  it("generates phone-based key", () => {
    const key = generateDedupeKey({ email: null, phone: "(305) 555-1234", firstName: null, lastName: null, dateOfBirth: null, externalId: null, address: null }, "phone");
    expect(key).toBe("phone:+13055551234");
  });

  it("generates name+DOB key", () => {
    const key = generateDedupeKey({ email: null, phone: null, firstName: "John", lastName: "Doe", dateOfBirth: "03/15/1985", externalId: null, address: null }, "name_dob");
    expect(key).toBe("name_dob:john|doe|1985-03-15");
  });

  it("generates external ID key", () => {
    const key = generateDedupeKey({ email: null, phone: null, firstName: null, lastName: null, dateOfBirth: null, externalId: "INS-123", address: null }, "external_id");
    expect(key).toBe("ext:INS-123");
  });

  it("returns null when required data missing", () => {
    expect(generateDedupeKey({ email: null, phone: null, firstName: null, lastName: null, dateOfBirth: null, externalId: null, address: null }, "email")).toBeNull();
    expect(generateDedupeKey({ email: null, phone: null, firstName: "John", lastName: null, dateOfBirth: null, externalId: null, address: null }, "name_dob")).toBeNull();
  });
});

// ============================================================
// END-TO-END: CSV → Map → Normalize pipeline
// ============================================================
describe("Import Pipeline Integration", () => {
  it("full pipeline: CSV → autoMap → extract → normalize", () => {
    const csv = "First Name,Last Name,DOB,Cell Phone,Email,Home Address,Medicaid ID\nJohn,DOE,03/15/1985,(305) 555-1234,john@example.com,\"123 Main St, Miami, FL\",INS-999";
    const parsed = parseCSV(csv);
    const { mapped } = autoMapColumns(parsed.headers, PATIENT_ALIASES);

    expect(mapped.length).toBeGreaterThanOrEqual(6);

    const raw = extractMappedValue(parsed.rows[0], mapped);
    expect(normalizeName(raw.firstName)).toBe("John");
    expect(normalizeName(raw.lastName)).toBe("Doe");
    expect(normalizeDate(raw.dateOfBirth)).toBe("1985-03-15");
    expect(normalizePhone(raw.phone)).toBe("+13055551234");
    expect(normalizeEmail(raw.email)).toBe("john@example.com");
  });

  it("handles dispatch software export format", () => {
    const csv = "rider_first,rider_last,member_phone,medicaid_id,notes\nMaria,Garcia,7865551234,MCD-456789,Wheelchair\nCarlos,Rodriguez,,MCD-123456,";
    const parsed = parseCSV(csv);
    const { mapped, unmapped } = autoMapColumns(parsed.headers, PATIENT_ALIASES);

    expect(mapped.find(m => m.targetField === "firstName")?.sourceColumn).toBe("rider_first");
    expect(mapped.find(m => m.targetField === "insuranceId")?.sourceColumn).toBe("medicaid_id");
    expect(parsed.rows).toHaveLength(2);

    const raw0 = extractMappedValue(parsed.rows[0], mapped);
    expect(normalizePhone(raw0.phone)).toBe("+17865551234");
  });

  it("handles trip import from external system", () => {
    const csv = "pickup,destination,appointment_date,appointment_time,rider_name,vehicle\n\"100 NW 1st Ave, Miami\",\"200 S Dixie Hwy, Miami\",03/20/2025,9:30 AM,\"Garcia, Maria\",Wheelchair Van";
    const parsed = parseCSV(csv);
    const { mapped } = autoMapColumns(parsed.headers, TRIP_ALIASES);

    expect(mapped.find(m => m.targetField === "pickupAddress")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "dropoffAddress")).toBeTruthy();
    expect(mapped.find(m => m.targetField === "scheduledAt")).toBeTruthy();

    const raw = extractMappedValue(parsed.rows[0], mapped);
    const scheduledAt = normalizeDateTime(raw.scheduledAt, raw.scheduledTime);
    expect(scheduledAt).toBeInstanceOf(Date);
  });
});
