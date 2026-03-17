/**
 * MFA Engine — Two-Factor Authentication for UCM
 *
 * Supports TOTP (Google Authenticator), SMS OTP, and Email OTP.
 * Integrated with existing Express JWT auth flow.
 */

import * as OTPAuth from "otpauth";
import * as QRCode from "qrcode";
import crypto from "crypto";
import { db } from "../db";
import { users, mfaBackupCodes, mfaAuditLog } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { hashPassword, comparePassword } from "../auth";

// ─── Constants ───────────────────────────────────────────────────────────────

const TOTP_ISSUER = "United Care Mobility";
const TOTP_PERIOD = 30; // seconds
const TOTP_DIGITS = 6;
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const BACKUP_CODE_COUNT = 8;

// Roles that MUST have 2FA enabled
export const MFA_REQUIRED_ROLES = ["SUPER_ADMIN", "ADMIN"];

// In-memory OTP store (for SMS/Email OTPs) — use Redis in production if available
const otpStore = new Map<number, { hash: string; method: string; expiresAt: number; attempts: number }>();

// ─── TOTP Setup ──────────────────────────────────────────────────────────────

/**
 * Generate a new TOTP secret and QR code for a user.
 */
export async function setupTOTP(userId: number, userEmail: string): Promise<{
  secret: string;
  qrCodeDataUrl: string;
  otpauthUri: string;
}> {
  const secret = new OTPAuth.Secret({ size: 20 });

  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: userEmail,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret,
  });

  const otpauthUri = totp.toString();
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri);

  // Store secret temporarily (not yet verified)
  await db
    .update(users)
    .set({ mfaSecret: secret.base32, mfaMethod: "totp" })
    .where(eq(users.id, userId));

  await logMfaEvent(userId, "setup_started", "totp");

  return {
    secret: secret.base32,
    qrCodeDataUrl,
    otpauthUri,
  };
}

/**
 * Verify a TOTP code during setup (first-time confirmation).
 */
export async function verifyTOTPSetup(
  userId: number,
  code: string,
): Promise<{ success: boolean; backupCodes: string[] }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.mfaSecret) {
    throw new Error("TOTP not configured. Run setup first.");
  }

  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(user.mfaSecret),
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    throw new Error("Invalid verification code. Please try again.");
  }

  // Enable MFA
  await db
    .update(users)
    .set({
      mfaEnabled: true,
      mfaMethod: "totp",
      mfaVerifiedAt: new Date(),
    })
    .where(eq(users.id, userId));

  // Generate backup codes
  const backupCodes = await generateBackupCodes(userId);

  await logMfaEvent(userId, "setup_completed", "totp");

  return { success: true, backupCodes };
}

// ─── TOTP Verification (during login) ────────────────────────────────────────

/**
 * Verify a TOTP code during login.
 */
export async function verifyTOTP(
  userId: number,
  code: string,
  ipAddress?: string,
  userAgent?: string,
  portal?: string,
): Promise<{ success: boolean }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");

  // Check lockout
  await checkAndEnforceLockout(user);

  if (!user.mfaSecret) {
    throw new Error("TOTP not configured");
  }

  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(user.mfaSecret),
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    await recordFailedAttempt(userId, ipAddress, userAgent, portal);
    throw new Error("Invalid code");
  }

  // Reset failed attempts on success
  await db
    .update(users)
    .set({ mfaFailedAttempts: 0, mfaLockedUntil: null })
    .where(eq(users.id, userId));

  await logMfaEvent(userId, "verified_success", "totp", ipAddress, userAgent, portal);

  return { success: true };
}

// ─── SMS / Email OTP ─────────────────────────────────────────────────────────

/**
 * Generate and send an OTP code via SMS or Email.
 */
export async function sendOTP(
  userId: number,
  method: "sms" | "email",
): Promise<{ sent: boolean; expiresIn: number }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");

  const code = generateNumericOTP(6);
  const hash = await hashPassword(code);

  // Store OTP
  otpStore.set(userId, {
    hash,
    method,
    expiresAt: Date.now() + OTP_EXPIRY_MS,
    attempts: 0,
  });

  if (method === "sms") {
    const phone = user.mfaPhone || user.phone;
    if (!phone) throw new Error("No phone number configured for SMS OTP");

    // Use existing Twilio integration
    try {
      const { sendSms } = await import("./twilioSms");
      await sendSms(
        phone,
        `Your UCM verification code is: ${code}. Expires in 10 minutes. Do not share this code.`,
      );
    } catch (err: any) {
      console.error("[MFA] SMS send failed:", err.message);
      throw new Error("Failed to send SMS. Please try again.");
    }
  } else if (method === "email") {
    // Use existing Resend integration
    try {
      const { sendMfaCodeEmail } = await import("./mfaEmailHelper");
      await sendMfaCodeEmail(user.email, code);
    } catch (err: any) {
      console.error("[MFA] Email send failed:", err.message);
      throw new Error("Failed to send email. Please try again.");
    }
  }

  await logMfaEvent(userId, "otp_sent", method);

  return { sent: true, expiresIn: 600 };
}

/**
 * Verify an SMS/Email OTP code.
 */
export async function verifyOTP(
  userId: number,
  code: string,
  ipAddress?: string,
  userAgent?: string,
  portal?: string,
): Promise<{ success: boolean }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");

  await checkAndEnforceLockout(user);

  const stored = otpStore.get(userId);
  if (!stored) {
    throw new Error("No OTP pending. Request a new code.");
  }

  if (Date.now() > stored.expiresAt) {
    otpStore.delete(userId);
    throw new Error("Code expired. Request a new one.");
  }

  if (stored.attempts >= MAX_FAILED_ATTEMPTS) {
    otpStore.delete(userId);
    await recordFailedAttempt(userId, ipAddress, userAgent, portal);
    throw new Error("Too many attempts. Request a new code.");
  }

  const match = await comparePassword(code, stored.hash);
  if (!match) {
    stored.attempts++;
    await recordFailedAttempt(userId, ipAddress, userAgent, portal);
    throw new Error("Invalid code");
  }

  // Success
  otpStore.delete(userId);
  await db
    .update(users)
    .set({ mfaFailedAttempts: 0, mfaLockedUntil: null })
    .where(eq(users.id, userId));

  await logMfaEvent(userId, "verified_success", stored.method, ipAddress, userAgent, portal);

  return { success: true };
}

// ─── SMS/Email MFA Setup ─────────────────────────────────────────────────────

export async function setupSmsEmailMFA(
  userId: number,
  method: "sms" | "email",
  phone?: string,
): Promise<{ sent: boolean }> {
  if (method === "sms" && phone) {
    await db.update(users).set({ mfaPhone: phone, mfaMethod: "sms" }).where(eq(users.id, userId));
  } else {
    await db.update(users).set({ mfaMethod: method }).where(eq(users.id, userId));
  }

  await logMfaEvent(userId, "setup_started", method);

  // Send initial OTP for verification
  return sendOTP(userId, method);
}

export async function verifySmsEmailSetup(
  userId: number,
  code: string,
): Promise<{ success: boolean; backupCodes: string[] }> {
  await verifyOTP(userId, code);

  await db
    .update(users)
    .set({ mfaEnabled: true, mfaVerifiedAt: new Date() })
    .where(eq(users.id, userId));

  const backupCodes = await generateBackupCodes(userId);

  await logMfaEvent(userId, "setup_completed", "sms_email");

  return { success: true, backupCodes };
}

// ─── Backup Codes ────────────────────────────────────────────────────────────

/**
 * Generate 8 one-time backup codes.
 */
export async function generateBackupCodes(userId: number): Promise<string[]> {
  // Delete old backup codes
  await db.delete(mfaBackupCodes).where(eq(mfaBackupCodes.userId, userId));

  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const part1 = crypto.randomBytes(3).toString("hex").toUpperCase();
    const part2 = crypto.randomBytes(3).toString("hex").toUpperCase();
    codes.push(`${part1}-${part2}`);
  }

  // Store hashed versions
  for (const code of codes) {
    const hash = await hashPassword(code);
    await db.insert(mfaBackupCodes).values({
      userId,
      codeHash: hash,
    });
  }

  return codes;
}

/**
 * Verify and consume a backup code.
 */
export async function useBackupCode(
  userId: number,
  code: string,
  ipAddress?: string,
  userAgent?: string,
  portal?: string,
): Promise<{ success: boolean; remaining: number }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");

  await checkAndEnforceLockout(user);

  const unusedCodes = await db
    .select()
    .from(mfaBackupCodes)
    .where(and(eq(mfaBackupCodes.userId, userId), isNull(mfaBackupCodes.usedAt)));

  for (const stored of unusedCodes) {
    const match = await comparePassword(code.toUpperCase(), stored.codeHash);
    if (match) {
      // Mark as used
      await db
        .update(mfaBackupCodes)
        .set({ usedAt: new Date() })
        .where(eq(mfaBackupCodes.id, stored.id));

      // Reset failed attempts
      await db
        .update(users)
        .set({ mfaFailedAttempts: 0, mfaLockedUntil: null })
        .where(eq(users.id, userId));

      await logMfaEvent(userId, "backup_used", "backup", ipAddress, userAgent, portal);

      const remaining = unusedCodes.length - 1;
      return { success: true, remaining };
    }
  }

  await recordFailedAttempt(userId, ipAddress, userAgent, portal);
  throw new Error("Invalid backup code");
}

// ─── Disable MFA ─────────────────────────────────────────────────────────────

export async function disableMFA(userId: number): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");

  if (MFA_REQUIRED_ROLES.includes(user.role)) {
    throw new Error("Two-factor authentication is required for your role and cannot be disabled.");
  }

  await db
    .update(users)
    .set({
      mfaEnabled: false,
      mfaMethod: null,
      mfaSecret: null,
      mfaVerifiedAt: null,
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
    })
    .where(eq(users.id, userId));

  // Delete backup codes
  await db.delete(mfaBackupCodes).where(eq(mfaBackupCodes.userId, userId));

  await logMfaEvent(userId, "disabled");
}

// ─── MFA Status ──────────────────────────────────────────────────────────────

export async function getMfaStatus(userId: number): Promise<{
  enabled: boolean;
  method: string | null;
  required: boolean;
  verifiedAt: Date | null;
  backupCodesRemaining: number;
}> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");

  const unusedCodes = await db
    .select()
    .from(mfaBackupCodes)
    .where(and(eq(mfaBackupCodes.userId, userId), isNull(mfaBackupCodes.usedAt)));

  return {
    enabled: user.mfaEnabled,
    method: user.mfaMethod,
    required: MFA_REQUIRED_ROLES.includes(user.role),
    verifiedAt: user.mfaVerifiedAt,
    backupCodesRemaining: unusedCodes.length,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateNumericOTP(length: number): string {
  const digits = "0123456789";
  let otp = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    otp += digits[bytes[i] % 10];
  }
  return otp;
}

async function checkAndEnforceLockout(user: any): Promise<void> {
  if (user.mfaLockedUntil && new Date(user.mfaLockedUntil) > new Date()) {
    const remainingMs = new Date(user.mfaLockedUntil).getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60000);
    throw new Error(`Account locked. Try again in ${remainingMin} minutes.`);
  }
}

async function recordFailedAttempt(
  userId: number,
  ipAddress?: string,
  userAgent?: string,
  portal?: string,
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return;

  const attempts = (user.mfaFailedAttempts || 0) + 1;
  const lockedUntil = attempts >= MAX_FAILED_ATTEMPTS
    ? new Date(Date.now() + LOCKOUT_DURATION_MS)
    : null;

  await db
    .update(users)
    .set({ mfaFailedAttempts: attempts, mfaLockedUntil: lockedUntil })
    .where(eq(users.id, userId));

  await logMfaEvent(userId, "verified_failed", undefined, ipAddress, userAgent, portal);

  if (lockedUntil) {
    await logMfaEvent(userId, "locked", undefined, ipAddress, userAgent, portal);
  }
}

async function logMfaEvent(
  userId: number,
  eventType: string,
  method?: string,
  ipAddress?: string,
  userAgent?: string,
  portal?: string,
): Promise<void> {
  try {
    await db.insert(mfaAuditLog).values({
      userId,
      eventType,
      method: method || null,
      ipAddress: ipAddress || null,
      userAgent: userAgent || null,
      portal: portal || null,
    });
  } catch (err: any) {
    console.warn("[MFA] Failed to log audit event:", err.message);
  }
}
