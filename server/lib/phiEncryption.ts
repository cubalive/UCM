/**
 * PHI Encryption Helpers — AES-256-GCM
 *
 * Provides field-level encryption/decryption for Protected Health Information.
 * HIPAA §164.312(a)(2)(iv) requires encryption of ePHI at rest.
 *
 * Uses AES-256-GCM with random IVs. Ciphertext format:
 *   base64( iv:authTag:encryptedData )
 *
 * Set PHI_ENCRYPTION_KEY env var to a 64-char hex string (32 bytes).
 * If the key is missing, functions pass through plaintext with a warning.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const ENCODING: BufferEncoding = "base64";
const SEPARATOR = ":";

// HIPAA §164.312(a)(2)(iv) — PHI encryption is MANDATORY in ALL environments.
// UCM will NOT start without a valid PHI_ENCRYPTION_KEY.
const rawKey = process.env.PHI_ENCRYPTION_KEY;

if (!rawKey) {
  console.error(
    "[PHI-ENCRYPT] FATAL: PHI_ENCRYPTION_KEY is not set.\n" +
    "UCM cannot start without PHI encryption.\n" +
    "HIPAA §164.312(a)(2)(iv) requires encryption of ePHI at rest.\n" +
    "Set PHI_ENCRYPTION_KEY to a 64-character hex string (32 bytes) and restart."
  );
  process.exit(1);
}

if (rawKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(rawKey)) {
  console.error(
    "[PHI-ENCRYPT] FATAL: PHI_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).\n" +
    `Current length: ${rawKey.length}, valid hex: ${/^[0-9a-fA-F]+$/.test(rawKey)}`
  );
  process.exit(1);
}

const encryptionKey: Buffer = Buffer.from(rawKey, "hex");

// Verify encryption round-trip on startup
try {
  const testPlain = "phi-startup-test-" + Date.now();
  const testIv = crypto.randomBytes(IV_LENGTH);
  const testCipher = crypto.createCipheriv(ALGORITHM, encryptionKey, testIv, { authTagLength: AUTH_TAG_LENGTH });
  const testEncrypted = Buffer.concat([testCipher.update(testPlain, "utf8"), testCipher.final()]);
  const testTag = testCipher.getAuthTag();
  const testDecipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, testIv, { authTagLength: AUTH_TAG_LENGTH });
  testDecipher.setAuthTag(testTag);
  const testDecrypted = Buffer.concat([testDecipher.update(testEncrypted), testDecipher.final()]).toString("utf8");
  if (testDecrypted !== testPlain) {
    console.error("[PHI-ENCRYPT] FATAL: Encryption round-trip test failed — decrypted value does not match.");
    process.exit(1);
  }
  console.log("[PHI-ENCRYPT] Encryption key validated and round-trip test passed.");
} catch (err: any) {
  console.error("[PHI-ENCRYPT] FATAL: Encryption round-trip test failed:", err.message);
  process.exit(1);
}

function getKey(): Buffer {
  return encryptionKey;
}

/**
 * Encrypt a plaintext PHI value using AES-256-GCM.
 * Returns a base64-encoded string containing iv:authTag:ciphertext.
 * If no encryption key is configured, returns the plaintext unchanged.
 */
export function encryptPHI(plaintext: string): string {
  if (!plaintext) return plaintext;

  const key = getKey();

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Format: base64(iv):base64(authTag):base64(ciphertext)
  return [
    iv.toString(ENCODING),
    authTag.toString(ENCODING),
    encrypted.toString(ENCODING),
  ].join(SEPARATOR);
}

/**
 * Decrypt an AES-256-GCM encrypted PHI value.
 * Expects the format produced by encryptPHI().
 * If no encryption key is configured or the value doesn't look encrypted,
 * returns the input unchanged.
 */
export function decryptPHI(ciphertext: string): string {
  if (!ciphertext) return ciphertext;

  const key = getKey();

  // Check if this looks like an encrypted value (3 base64 segments separated by colons)
  const parts = ciphertext.split(SEPARATOR);
  if (parts.length !== 3) {
    // Not encrypted — return as-is (handles legacy unencrypted data)
    return ciphertext;
  }

  try {
    const iv = Buffer.from(parts[0], ENCODING);
    const authTag = Buffer.from(parts[1], ENCODING);
    const encrypted = Buffer.from(parts[2], ENCODING);

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      // Doesn't match expected format — likely plain text with colons
      return ciphertext;
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (err: any) {
    console.error("[PHI-ENCRYPT] Decryption failed:", err.message);
    // Return ciphertext rather than throwing — caller can decide how to handle
    return ciphertext;
  }
}

/**
 * Check whether the encryption system is properly configured.
 */
export function isPhiEncryptionEnabled(): boolean {
  return getKey() !== null;
}

/**
 * Encrypt multiple PHI fields on an object. Returns a shallow copy with
 * specified fields encrypted. Non-string fields are skipped.
 */
export function encryptPHIFields<T extends Record<string, any>>(
  obj: T,
  fields: (keyof T)[],
): T {
  const result = { ...obj };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === "string" && value.length > 0) {
      (result as any)[field] = encryptPHI(value);
    }
  }
  return result;
}

/**
 * Decrypt multiple PHI fields on an object. Returns a shallow copy with
 * specified fields decrypted. Non-string fields are skipped.
 */
export function decryptPHIFields<T extends Record<string, any>>(
  obj: T,
  fields: (keyof T)[],
): T {
  const result = { ...obj };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === "string" && value.length > 0) {
      (result as any)[field] = decryptPHI(value);
    }
  }
  return result;
}
