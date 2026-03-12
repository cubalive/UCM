import { describe, it, expect } from "vitest";

// =========================================================
// HIPAA Audit Compliance Tests — Pure Logic (no DB)
// =========================================================
// Tests PHI access audit patterns, encryption validation,
// and compliance rules per HIPAA §164.312

// ─── PHI Encryption Validation ───────────────────────────────────────────────

function isValidEncryptionKey(key: string): { valid: boolean; error: string | null } {
  if (!key) return { valid: false, error: "Encryption key is required" };
  if (key.length !== 64) return { valid: false, error: `Key must be 64 hex characters (got ${key.length})` };
  if (!/^[a-f0-9]+$/i.test(key)) return { valid: false, error: "Key must be hexadecimal only" };
  return { valid: true, error: null };
}

function isEncryptedFormat(value: string): boolean {
  // Encrypted PHI format: base64(iv:authTag:ciphertext)
  try {
    const decoded = Buffer.from(value, "base64").toString("utf-8");
    const parts = decoded.split(":");
    return parts.length === 3 && parts.every(p => p.length > 0);
  } catch {
    return false;
  }
}

function detectUnencryptedPHI(fields: Record<string, string | null>): string[] {
  const phiFieldNames = ["ssn", "dateOfBirth", "medicalRecordNumber", "insuranceId", "phoneNumber", "address"];
  const unencrypted: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (!phiFieldNames.includes(key)) continue;
    if (value === null || value === "") continue;

    // Check if value looks like plain text (not encrypted)
    if (!isEncryptedFormat(value)) {
      // Plain SSN pattern
      if (key === "ssn" && /^\d{3}-?\d{2}-?\d{4}$/.test(value)) {
        unencrypted.push(key);
      }
      // Plain phone pattern
      else if (key === "phoneNumber" && /^\+?\d[\d\s()-]{8,}$/.test(value)) {
        unencrypted.push(key);
      }
      // Any short plain text for other PHI fields
      else if (value.length < 200 && !value.includes(":")) {
        unencrypted.push(key);
      }
    }
  }

  return unencrypted;
}

// ─── PHI Access Audit Entry Validation ──────────────────────────────────────

interface AuditEntry {
  event: string;
  timestamp: string;
  userId: number | null;
  userRole: string | null;
  method: string;
  path: string;
  resourceType: string;
  resourceId: string | null;
  ip: string;
  statusCode: number;
  outcome: "success" | "denied" | "error";
}

function isValidAuditEntry(entry: AuditEntry): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (entry.event !== "phi_access") errors.push("Invalid event type");
  if (!entry.timestamp || isNaN(Date.parse(entry.timestamp))) errors.push("Invalid timestamp");
  if (!entry.method || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(entry.method)) {
    errors.push("Invalid HTTP method");
  }
  if (!entry.path || !entry.path.startsWith("/")) errors.push("Invalid path");
  if (!entry.resourceType) errors.push("Missing resource type");
  if (!entry.ip || entry.ip === "unknown") errors.push("Client IP required for audit");
  if (typeof entry.statusCode !== "number" || entry.statusCode < 100 || entry.statusCode > 599) {
    errors.push("Invalid status code");
  }
  if (!["success", "denied", "error"].includes(entry.outcome)) errors.push("Invalid outcome");

  return { valid: errors.length === 0, errors };
}

// ─── PHI Route Pattern Matching ──────────────────────────────────────────────

const PHI_PATTERNS: Array<{ pattern: RegExp; resourceType: string }> = [
  { pattern: /^\/api\/patients\/?/, resourceType: "patient" },
  { pattern: /^\/api\/trips\/\d+/, resourceType: "trip" },
  { pattern: /^\/api\/trips\/?$/, resourceType: "trip_list" },
  { pattern: /^\/api\/driver-portal\/trips/, resourceType: "driver_trip" },
  { pattern: /^\/api\/clinic-portal\/trips/, resourceType: "clinic_trip" },
  { pattern: /^\/api\/clinic-portal\/patients/, resourceType: "clinic_patient" },
  { pattern: /^\/api\/invoices/, resourceType: "invoice" },
  { pattern: /^\/api\/billing/, resourceType: "billing" },
  { pattern: /^\/api\/drivers\/\d+/, resourceType: "driver" },
  { pattern: /^\/api\/import/, resourceType: "data_import" },
  { pattern: /^\/api\/reports/, resourceType: "report" },
  { pattern: /^\/api\/tracking/, resourceType: "tracking" },
  { pattern: /^\/api\/pharmacy\/orders/, resourceType: "pharmacy_order" },
  { pattern: /^\/api\/pharmacy\/active-deliveries/, resourceType: "pharmacy_delivery" },
];

function matchPhiRoute(path: string): string | null {
  for (const entry of PHI_PATTERNS) {
    if (entry.pattern.test(path)) return entry.resourceType;
  }
  return null;
}

function extractResourceId(path: string): string | null {
  const match = path.match(/\/(\d+)(?:\/|$)/);
  return match ? match[1] : null;
}

// ─── Access Control Matrix ──────────────────────────────────────────────────

const PHI_ACCESS_RULES: Record<string, string[]> = {
  patient: ["SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH", "DRIVER", "CLINIC_ADMIN", "CLINIC_USER"],
  trip: ["SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH", "DRIVER"],
  invoice: ["SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"],
  billing: ["SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"],
  pharmacy_order: ["SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "PHARMACY_ADMIN", "PHARMACY_USER"],
  report: ["SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"],
};

function canAccessPHI(role: string, resourceType: string): boolean {
  const allowedRoles = PHI_ACCESS_RULES[resourceType];
  if (!allowedRoles) return false;
  return allowedRoles.includes(role);
}

// ─── Audit Retention Check ──────────────────────────────────────────────────

function isWithinRetentionPeriod(auditDate: string, retentionYears: number = 6): boolean {
  const audit = new Date(auditDate);
  const now = new Date();
  const diffYears = (now.getTime() - audit.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return diffYears <= retentionYears;
}

// =========================================================
// Tests
// =========================================================

describe("HIPAA Audit — PHI Encryption Key Validation", () => {
  it("valid 64-char hex key passes", () => {
    const key = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const result = isValidEncryptionKey(key);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it("empty key fails", () => {
    const result = isValidEncryptionKey("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("required");
  });

  it("too short key fails", () => {
    const result = isValidEncryptionKey("abc123");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("64 hex characters");
  });

  it("non-hex characters fail", () => {
    const result = isValidEncryptionKey("g".repeat(64));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("hexadecimal");
  });

  it("63-char key fails", () => {
    const result = isValidEncryptionKey("a".repeat(63));
    expect(result.valid).toBe(false);
  });

  it("65-char key fails", () => {
    const result = isValidEncryptionKey("a".repeat(65));
    expect(result.valid).toBe(false);
  });
});

describe("HIPAA Audit — Encrypted Format Detection", () => {
  it("detects valid encrypted format (base64 of iv:authTag:ciphertext)", () => {
    const encrypted = Buffer.from("randomiv123:authtag456:encrypteddata789").toString("base64");
    expect(isEncryptedFormat(encrypted)).toBe(true);
  });

  it("plain text is NOT encrypted format", () => {
    expect(isEncryptedFormat("John Smith")).toBe(false);
  });

  it("SSN is NOT encrypted format", () => {
    expect(isEncryptedFormat("123-45-6789")).toBe(false);
  });

  it("empty string is NOT encrypted", () => {
    expect(isEncryptedFormat("")).toBe(false);
  });
});

describe("HIPAA Audit — Unencrypted PHI Detection", () => {
  it("detects plain text SSN", () => {
    const fields = { ssn: "123-45-6789", name: "John" };
    const result = detectUnencryptedPHI(fields);
    expect(result).toContain("ssn");
  });

  it("detects plain phone number", () => {
    const fields = { phoneNumber: "+1 (555) 123-4567" };
    const result = detectUnencryptedPHI(fields);
    expect(result).toContain("phoneNumber");
  });

  it("null fields are safe", () => {
    const fields = { ssn: null, phoneNumber: null };
    const result = detectUnencryptedPHI(fields);
    expect(result).toEqual([]);
  });

  it("non-PHI fields are ignored", () => {
    const fields = { name: "John", email: "john@example.com" };
    const result = detectUnencryptedPHI(fields);
    expect(result).toEqual([]);
  });

  it("detects multiple unencrypted fields", () => {
    const fields = {
      ssn: "123-45-6789",
      phoneNumber: "555-123-4567",
      dateOfBirth: "1990-01-15",
      address: "123 Main St",
    };
    const result = detectUnencryptedPHI(fields);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});

describe("HIPAA Audit — Audit Entry Validation (§164.312(b))", () => {
  const validEntry: AuditEntry = {
    event: "phi_access",
    timestamp: "2026-03-12T15:30:00Z",
    userId: 42,
    userRole: "ADMIN",
    method: "GET",
    path: "/api/patients/123",
    resourceType: "patient",
    resourceId: "123",
    ip: "192.168.1.100",
    statusCode: 200,
    outcome: "success",
  };

  it("valid entry passes all checks", () => {
    const result = isValidAuditEntry(validEntry);
    expect(result.valid).toBe(true);
  });

  it("invalid event type fails", () => {
    const entry = { ...validEntry, event: "other_event" };
    const result = isValidAuditEntry(entry);
    expect(result.valid).toBe(false);
  });

  it("invalid timestamp fails", () => {
    const entry = { ...validEntry, timestamp: "not-a-date" };
    const result = isValidAuditEntry(entry);
    expect(result.valid).toBe(false);
  });

  it("missing IP fails", () => {
    const entry = { ...validEntry, ip: "unknown" };
    const result = isValidAuditEntry(entry);
    expect(result.valid).toBe(false);
  });

  it("invalid HTTP method fails", () => {
    const entry = { ...validEntry, method: "INVALID" };
    const result = isValidAuditEntry(entry);
    expect(result.valid).toBe(false);
  });

  it("denied outcome is valid", () => {
    const entry = { ...validEntry, statusCode: 403, outcome: "denied" as const };
    const result = isValidAuditEntry(entry);
    expect(result.valid).toBe(true);
  });

  it("error outcome is valid", () => {
    const entry = { ...validEntry, statusCode: 500, outcome: "error" as const };
    const result = isValidAuditEntry(entry);
    expect(result.valid).toBe(true);
  });
});

describe("HIPAA Audit — PHI Route Matching", () => {
  it("matches patient routes", () => {
    expect(matchPhiRoute("/api/patients")).toBe("patient");
    expect(matchPhiRoute("/api/patients/123")).toBe("patient");
  });

  it("matches trip routes", () => {
    expect(matchPhiRoute("/api/trips/456")).toBe("trip");
  });

  it("matches trip list route", () => {
    expect(matchPhiRoute("/api/trips")).toBe("trip_list");
  });

  it("matches pharmacy routes", () => {
    expect(matchPhiRoute("/api/pharmacy/orders")).toBe("pharmacy_order");
    expect(matchPhiRoute("/api/pharmacy/active-deliveries")).toBe("pharmacy_delivery");
  });

  it("matches clinic portal routes", () => {
    expect(matchPhiRoute("/api/clinic-portal/trips")).toBe("clinic_trip");
    expect(matchPhiRoute("/api/clinic-portal/patients")).toBe("clinic_patient");
  });

  it("does not match non-PHI routes", () => {
    expect(matchPhiRoute("/api/auth/login")).toBeNull();
    expect(matchPhiRoute("/api/cities")).toBeNull();
    expect(matchPhiRoute("/api/health/live")).toBeNull();
  });

  it("extracts resource IDs from paths", () => {
    expect(extractResourceId("/api/patients/123")).toBe("123");
    expect(extractResourceId("/api/trips/456/status")).toBe("456");
    expect(extractResourceId("/api/patients")).toBeNull();
  });
});

describe("HIPAA Audit — Access Control Matrix", () => {
  it("SUPER_ADMIN can access all PHI resources", () => {
    const resources = Object.keys(PHI_ACCESS_RULES);
    for (const resource of resources) {
      expect(canAccessPHI("SUPER_ADMIN", resource)).toBe(true);
    }
  });

  it("DRIVER can access patient and trip PHI", () => {
    expect(canAccessPHI("DRIVER", "patient")).toBe(true);
    expect(canAccessPHI("DRIVER", "trip")).toBe(true);
  });

  it("DRIVER cannot access billing or invoice PHI", () => {
    expect(canAccessPHI("DRIVER", "billing")).toBe(false);
    expect(canAccessPHI("DRIVER", "invoice")).toBe(false);
  });

  it("PHARMACY_USER can access pharmacy orders", () => {
    expect(canAccessPHI("PHARMACY_USER", "pharmacy_order")).toBe(true);
  });

  it("PHARMACY_USER cannot access patient records", () => {
    expect(canAccessPHI("PHARMACY_USER", "patient")).toBe(false);
  });

  it("VIEWER cannot access any PHI", () => {
    const resources = Object.keys(PHI_ACCESS_RULES);
    for (const resource of resources) {
      expect(canAccessPHI("VIEWER", resource)).toBe(false);
    }
  });

  it("unknown resource returns false", () => {
    expect(canAccessPHI("SUPER_ADMIN", "unknown_resource")).toBe(false);
  });
});

describe("HIPAA Audit — Retention Period (§164.530(j))", () => {
  it("audit from today is within 6-year retention", () => {
    expect(isWithinRetentionPeriod(new Date().toISOString())).toBe(true);
  });

  it("audit from 5 years ago is within retention", () => {
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    expect(isWithinRetentionPeriod(fiveYearsAgo.toISOString())).toBe(true);
  });

  it("audit from 7 years ago exceeds retention", () => {
    const sevenYearsAgo = new Date();
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);
    expect(isWithinRetentionPeriod(sevenYearsAgo.toISOString())).toBe(false);
  });

  it("custom retention period of 3 years", () => {
    const fourYearsAgo = new Date();
    fourYearsAgo.setFullYear(fourYearsAgo.getFullYear() - 4);
    expect(isWithinRetentionPeriod(fourYearsAgo.toISOString(), 3)).toBe(false);
    expect(isWithinRetentionPeriod(fourYearsAgo.toISOString(), 6)).toBe(true);
  });
});
