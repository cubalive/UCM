import { describe, it, expect } from "vitest";

// ── Inline validation functions mirroring frontend form validation ──

function validateEmail(email: string): { valid: boolean; error?: string } {
  if (!email) return { valid: false, error: "Email is required" };
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!regex.test(email)) return { valid: false, error: "Invalid email format" };
  return { valid: true };
}

function validatePhone(phone: string): { valid: boolean; error?: string } {
  if (!phone) return { valid: false, error: "Phone is required" };
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return { valid: false, error: "Phone must be at least 10 digits" };
  if (digits.length > 15) return { valid: false, error: "Phone number too long" };
  return { valid: true };
}

function validateAddress(address: string): { valid: boolean; error?: string } {
  if (!address) return { valid: false, error: "Address is required" };
  if (address.length < 5) return { valid: false, error: "Address too short" };
  if (address.length > 500) return { valid: false, error: "Address too long" };
  return { valid: true };
}

function validateDate(date: string): { valid: boolean; error?: string } {
  if (!date) return { valid: false, error: "Date is required" };
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) return { valid: false, error: "Invalid date" };
  return { valid: true };
}

function validateFutureDate(date: string): { valid: boolean; error?: string } {
  const dateCheck = validateDate(date);
  if (!dateCheck.valid) return dateCheck;
  const parsed = new Date(date);
  if (parsed < new Date()) return { valid: false, error: "Date must be in the future" };
  return { valid: true };
}

function validateDateOfBirth(dob: string): { valid: boolean; error?: string } {
  const dateCheck = validateDate(dob);
  if (!dateCheck.valid) return dateCheck;
  const parsed = new Date(dob);
  if (parsed > new Date()) return { valid: false, error: "Date of birth cannot be in the future" };
  const age = (Date.now() - parsed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (age > 150) return { valid: false, error: "Invalid date of birth" };
  return { valid: true };
}

function validateFare(amount: number): { valid: boolean; error?: string } {
  if (isNaN(amount)) return { valid: false, error: "Invalid amount" };
  if (amount < 0) return { valid: false, error: "Amount cannot be negative" };
  if (amount > 100000) return { valid: false, error: "Amount exceeds maximum" };
  if (!Number.isFinite(amount)) return { valid: false, error: "Invalid amount" };
  return { valid: true };
}

function validateTripDuration(minutes: number): { valid: boolean; error?: string } {
  if (minutes < 0) return { valid: false, error: "Duration cannot be negative" };
  if (minutes > 1440) return { valid: false, error: "Duration exceeds 24 hours" };
  return { valid: true };
}

function validatePatientName(name: string): { valid: boolean; error?: string } {
  if (!name || !name.trim()) return { valid: false, error: "Name is required" };
  if (name.length > 200) return { valid: false, error: "Name too long" };
  if (/<script/i.test(name)) return { valid: false, error: "Invalid characters in name" };
  return { valid: true };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Form Validation Logic", () => {
  // ── Email ─────────────────────────────────────────────────────────
  describe("validateEmail", () => {
    it("accepts valid email", () => {
      expect(validateEmail("user@example.com")).toEqual({ valid: true });
    });

    it("accepts email with subdomain", () => {
      expect(validateEmail("user@mail.example.com")).toEqual({ valid: true });
    });

    it("accepts email with plus sign", () => {
      expect(validateEmail("user+tag@example.com")).toEqual({ valid: true });
    });

    it("rejects empty string", () => {
      expect(validateEmail("")).toEqual({ valid: false, error: "Email is required" });
    });

    it("rejects email without @", () => {
      expect(validateEmail("userexample.com")).toEqual({
        valid: false,
        error: "Invalid email format",
      });
    });

    it("rejects email without domain", () => {
      expect(validateEmail("user@")).toEqual({
        valid: false,
        error: "Invalid email format",
      });
    });

    it("rejects email without TLD", () => {
      expect(validateEmail("user@example")).toEqual({
        valid: false,
        error: "Invalid email format",
      });
    });

    it("rejects email with spaces", () => {
      expect(validateEmail("user @example.com")).toEqual({
        valid: false,
        error: "Invalid email format",
      });
    });

    it("rejects email with multiple @", () => {
      expect(validateEmail("user@@example.com")).toEqual({
        valid: false,
        error: "Invalid email format",
      });
    });
  });

  // ── Phone ─────────────────────────────────────────────────────────
  describe("validatePhone", () => {
    it("accepts valid 10-digit phone", () => {
      expect(validatePhone("5551234567")).toEqual({ valid: true });
    });

    it("accepts phone with dashes", () => {
      expect(validatePhone("555-123-4567")).toEqual({ valid: true });
    });

    it("accepts phone with parentheses", () => {
      expect(validatePhone("(555) 123-4567")).toEqual({ valid: true });
    });

    it("accepts phone with country code", () => {
      expect(validatePhone("+1 555 123 4567")).toEqual({ valid: true });
    });

    it("accepts international phone (15 digits)", () => {
      expect(validatePhone("123456789012345")).toEqual({ valid: true });
    });

    it("rejects empty string", () => {
      expect(validatePhone("")).toEqual({ valid: false, error: "Phone is required" });
    });

    it("rejects too short (less than 10 digits)", () => {
      expect(validatePhone("12345")).toEqual({
        valid: false,
        error: "Phone must be at least 10 digits",
      });
    });

    it("rejects too long (more than 15 digits)", () => {
      expect(validatePhone("1234567890123456")).toEqual({
        valid: false,
        error: "Phone number too long",
      });
    });

    it("counts only digits when formatted", () => {
      // "123-456" has 6 digits -> too short
      expect(validatePhone("123-456")).toEqual({
        valid: false,
        error: "Phone must be at least 10 digits",
      });
    });
  });

  // ── Address ───────────────────────────────────────────────────────
  describe("validateAddress", () => {
    it("accepts valid address", () => {
      expect(validateAddress("123 Main St, City, ST 12345")).toEqual({ valid: true });
    });

    it("rejects empty string", () => {
      expect(validateAddress("")).toEqual({ valid: false, error: "Address is required" });
    });

    it("rejects too short address", () => {
      expect(validateAddress("123")).toEqual({ valid: false, error: "Address too short" });
    });

    it("accepts address exactly 5 chars", () => {
      expect(validateAddress("12345")).toEqual({ valid: true });
    });

    it("rejects address over 500 chars", () => {
      expect(validateAddress("a".repeat(501))).toEqual({
        valid: false,
        error: "Address too long",
      });
    });

    it("accepts address exactly 500 chars", () => {
      expect(validateAddress("a".repeat(500))).toEqual({ valid: true });
    });
  });

  // ── Date ──────────────────────────────────────────────────────────
  describe("validateDate", () => {
    it("accepts valid ISO date", () => {
      expect(validateDate("2025-12-31")).toEqual({ valid: true });
    });

    it("accepts date-time string", () => {
      expect(validateDate("2025-06-15T10:30:00Z")).toEqual({ valid: true });
    });

    it("rejects empty string", () => {
      expect(validateDate("")).toEqual({ valid: false, error: "Date is required" });
    });

    it("rejects invalid date string", () => {
      expect(validateDate("not-a-date")).toEqual({ valid: false, error: "Invalid date" });
    });

    it("rejects garbage string", () => {
      expect(validateDate("abc123")).toEqual({ valid: false, error: "Invalid date" });
    });
  });

  // ── Future date ───────────────────────────────────────────────────
  describe("validateFutureDate", () => {
    it("accepts future date", () => {
      expect(validateFutureDate("2099-12-31")).toEqual({ valid: true });
    });

    it("rejects past date", () => {
      const result = validateFutureDate("2020-01-01");
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Date must be in the future");
    });

    it("rejects empty string", () => {
      expect(validateFutureDate("")).toEqual({ valid: false, error: "Date is required" });
    });

    it("rejects invalid date", () => {
      expect(validateFutureDate("nope")).toEqual({ valid: false, error: "Invalid date" });
    });
  });

  // ── Date of birth ─────────────────────────────────────────────────
  describe("validateDateOfBirth", () => {
    it("accepts valid past date", () => {
      expect(validateDateOfBirth("1990-05-15")).toEqual({ valid: true });
    });

    it("rejects future date", () => {
      expect(validateDateOfBirth("2099-01-01")).toEqual({
        valid: false,
        error: "Date of birth cannot be in the future",
      });
    });

    it("rejects date of birth > 150 years ago", () => {
      expect(validateDateOfBirth("1800-01-01")).toEqual({
        valid: false,
        error: "Invalid date of birth",
      });
    });

    it("accepts date 100 years ago", () => {
      const year = new Date().getFullYear() - 100;
      expect(validateDateOfBirth(`${year}-01-01`)).toEqual({ valid: true });
    });

    it("rejects empty string", () => {
      expect(validateDateOfBirth("")).toEqual({ valid: false, error: "Date is required" });
    });

    it("rejects invalid date string", () => {
      expect(validateDateOfBirth("invalid")).toEqual({ valid: false, error: "Invalid date" });
    });
  });

  // ── Fare ──────────────────────────────────────────────────────────
  describe("validateFare", () => {
    it("accepts zero amount", () => {
      expect(validateFare(0)).toEqual({ valid: true });
    });

    it("accepts normal fare", () => {
      expect(validateFare(45.50)).toEqual({ valid: true });
    });

    it("accepts maximum amount", () => {
      expect(validateFare(100000)).toEqual({ valid: true });
    });

    it("rejects negative amount", () => {
      expect(validateFare(-10)).toEqual({ valid: false, error: "Amount cannot be negative" });
    });

    it("rejects NaN", () => {
      expect(validateFare(NaN)).toEqual({ valid: false, error: "Invalid amount" });
    });

    it("rejects Infinity", () => {
      expect(validateFare(Infinity)).toEqual({ valid: false, error: "Amount exceeds maximum" });
    });

    it("rejects negative Infinity", () => {
      expect(validateFare(-Infinity)).toEqual({
        valid: false,
        error: "Amount cannot be negative",
      });
    });

    it("rejects amount exceeding maximum", () => {
      expect(validateFare(100001)).toEqual({
        valid: false,
        error: "Amount exceeds maximum",
      });
    });

    it("accepts decimal amounts", () => {
      expect(validateFare(0.01)).toEqual({ valid: true });
      expect(validateFare(99999.99)).toEqual({ valid: true });
    });
  });

  // ── Trip duration ─────────────────────────────────────────────────
  describe("validateTripDuration", () => {
    it("accepts zero minutes", () => {
      expect(validateTripDuration(0)).toEqual({ valid: true });
    });

    it("accepts typical duration", () => {
      expect(validateTripDuration(45)).toEqual({ valid: true });
    });

    it("accepts maximum 24 hours", () => {
      expect(validateTripDuration(1440)).toEqual({ valid: true });
    });

    it("rejects negative duration", () => {
      expect(validateTripDuration(-1)).toEqual({
        valid: false,
        error: "Duration cannot be negative",
      });
    });

    it("rejects duration exceeding 24 hours", () => {
      expect(validateTripDuration(1441)).toEqual({
        valid: false,
        error: "Duration exceeds 24 hours",
      });
    });
  });

  // ── Patient name ──────────────────────────────────────────────────
  describe("validatePatientName", () => {
    it("accepts valid name", () => {
      expect(validatePatientName("John Doe")).toEqual({ valid: true });
    });

    it("accepts name with hyphens", () => {
      expect(validatePatientName("Mary-Jane Watson")).toEqual({ valid: true });
    });

    it("accepts name with apostrophes", () => {
      expect(validatePatientName("O'Brien")).toEqual({ valid: true });
    });

    it("rejects empty string", () => {
      expect(validatePatientName("")).toEqual({ valid: false, error: "Name is required" });
    });

    it("rejects whitespace-only string", () => {
      expect(validatePatientName("   ")).toEqual({ valid: false, error: "Name is required" });
    });

    it("rejects name too long", () => {
      expect(validatePatientName("a".repeat(201))).toEqual({
        valid: false,
        error: "Name too long",
      });
    });

    it("accepts name exactly 200 chars", () => {
      expect(validatePatientName("a".repeat(200))).toEqual({ valid: true });
    });

    it("rejects XSS attempt with <script>", () => {
      expect(validatePatientName('<script>alert("xss")</script>')).toEqual({
        valid: false,
        error: "Invalid characters in name",
      });
    });

    it("rejects XSS with mixed case <Script>", () => {
      expect(validatePatientName("<Script>alert(1)</Script>")).toEqual({
        valid: false,
        error: "Invalid characters in name",
      });
    });

    it("accepts names with unicode characters", () => {
      expect(validatePatientName("Jose Garcia")).toEqual({ valid: true });
    });
  });
});
