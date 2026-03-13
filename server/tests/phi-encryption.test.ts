import { describe, it, expect, beforeEach, afterEach } from "vitest";

// =========================================================
// PHI Encryption Tests — AES-256-GCM (no DB required)
// =========================================================

// We test the module by setting PHI_ENCRYPTION_KEY before import
const TEST_KEY = "a".repeat(64); // valid 64-char hex key

describe("PHI Encryption (AES-256-GCM)", () => {
  let encryptPHI: typeof import("../lib/phiEncryption").encryptPHI;
  let decryptPHI: typeof import("../lib/phiEncryption").decryptPHI;
  let encryptPHIFields: typeof import("../lib/phiEncryption").encryptPHIFields;
  let decryptPHIFields: typeof import("../lib/phiEncryption").decryptPHIFields;
  let isPhiEncryptionEnabled: typeof import("../lib/phiEncryption").isPhiEncryptionEnabled;

  beforeEach(async () => {
    // Set key and re-import to reset internal state
    process.env.PHI_ENCRYPTION_KEY = TEST_KEY;
    // Dynamic import to get fresh module state
    const mod = await import("../lib/phiEncryption");
    encryptPHI = mod.encryptPHI;
    decryptPHI = mod.decryptPHI;
    encryptPHIFields = mod.encryptPHIFields;
    decryptPHIFields = mod.decryptPHIFields;
    isPhiEncryptionEnabled = mod.isPhiEncryptionEnabled;
  });

  afterEach(() => {
    delete process.env.PHI_ENCRYPTION_KEY;
  });

  it("encrypts and decrypts a simple string", () => {
    const plaintext = "John Doe SSN 123-45-6789";
    const encrypted = encryptPHI(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted).toContain(":"); // iv:tag:data format

    const decrypted = decryptPHI(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for same plaintext (random IV)", () => {
    const plaintext = "Patient Name";
    const enc1 = encryptPHI(plaintext);
    const enc2 = encryptPHI(plaintext);
    expect(enc1).not.toBe(enc2); // Random IVs mean different output
    expect(decryptPHI(enc1)).toBe(plaintext);
    expect(decryptPHI(enc2)).toBe(plaintext);
  });

  it("handles empty and falsy inputs", () => {
    expect(encryptPHI("")).toBe("");
    expect(decryptPHI("")).toBe("");
  });

  it("handles unicode and special characters", () => {
    const unicode = "Paciente: José García-López 日本語テスト 🏥";
    const encrypted = encryptPHI(unicode);
    expect(decryptPHI(encrypted)).toBe(unicode);
  });

  it("handles long strings", () => {
    const longText = "A".repeat(10_000);
    const encrypted = encryptPHI(longText);
    expect(decryptPHI(encrypted)).toBe(longText);
  });

  it("returns unencrypted strings as-is during decryption", () => {
    // Plain text without colons shouldn't be modified
    const plain = "plain text no colons";
    expect(decryptPHI(plain)).toBe(plain);
  });

  it("ciphertext has 3 base64 parts separated by colons", () => {
    const encrypted = encryptPHI("test");
    const parts = encrypted.split(":");
    expect(parts.length).toBe(3);
    // Each part should be valid base64
    for (const part of parts) {
      expect(() => Buffer.from(part, "base64")).not.toThrow();
    }
  });

  it("encryptPHIFields encrypts specified fields", () => {
    const obj = { name: "Jane Doe", email: "jane@test.com", age: 30 };
    const result = encryptPHIFields(obj, ["name", "email"]);
    expect(result.name).not.toBe("Jane Doe");
    expect(result.email).not.toBe("jane@test.com");
    expect(result.age).toBe(30); // non-string fields untouched
    expect(decryptPHI(result.name)).toBe("Jane Doe");
    expect(decryptPHI(result.email)).toBe("jane@test.com");
  });

  it("decryptPHIFields decrypts specified fields", () => {
    const obj = { name: "Jane Doe", phone: "555-1234" };
    const encrypted = encryptPHIFields(obj, ["name", "phone"]);
    const decrypted = decryptPHIFields(encrypted, ["name", "phone"]);
    expect(decrypted.name).toBe("Jane Doe");
    expect(decrypted.phone).toBe("555-1234");
  });

  it("encryptPHIFields skips non-string and empty fields", () => {
    const obj = { name: "", count: 5, flag: true };
    const result = encryptPHIFields(obj, ["name", "count" as any, "flag" as any]);
    expect(result.name).toBe(""); // empty string unchanged
    expect(result.count).toBe(5);
    expect(result.flag).toBe(true);
  });

  it("isPhiEncryptionEnabled returns true with valid key", () => {
    expect(isPhiEncryptionEnabled()).toBe(true);
  });

  it("tampered ciphertext returns the original ciphertext (no throw)", () => {
    const encrypted = encryptPHI("sensitive data");
    const parts = encrypted.split(":");
    // Tamper with the auth tag
    parts[1] = Buffer.from("tampered1234567!").toString("base64");
    const tampered = parts.join(":");
    // Should not throw, returns ciphertext as-is
    const result = decryptPHI(tampered);
    expect(result).toBe(tampered);
  });
});
