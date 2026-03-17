/**
 * H-1: Single-use refresh token rotation with theft detection.
 *
 * Each refresh token belongs to a "family". When a token is used:
 *   1. It's marked as used
 *   2. A new token in the same family is issued
 *   3. If a token that was already used is presented again,
 *      ALL tokens in that family are revoked (token theft detected)
 */
import crypto from "crypto";
import { db } from "../db";
import { refreshTokens } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Issue a new refresh token and store its hash.
 */
export async function issueRefreshToken(
  userId: number,
  ipAddress?: string,
  userAgent?: string,
  family?: string,
): Promise<string> {
  const tokenValue = crypto.randomBytes(64).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(tokenValue).digest("hex");
  const tokenFamily = family || crypto.randomBytes(16).toString("hex");

  await db.insert(refreshTokens).values({
    userId,
    tokenHash,
    family: tokenFamily,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
  });

  // Encode family into the token so we can find it on refresh
  // Format: family.tokenValue
  return `${tokenFamily}.${tokenValue}`;
}

/**
 * Consume a refresh token (single-use). Returns userId if valid.
 * If the token was already used, revokes the entire family (theft detection).
 */
export async function consumeRefreshToken(
  rawToken: string,
): Promise<{ userId: number; family: string } | null> {
  const dotIndex = rawToken.indexOf(".");
  if (dotIndex === -1) return null;

  const family = rawToken.slice(0, dotIndex);
  const tokenValue = rawToken.slice(dotIndex + 1);
  const tokenHash = crypto.createHash("sha256").update(tokenValue).digest("hex");

  const [record] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash));

  if (!record) return null;

  // Token expired
  if (new Date() > record.expiresAt) {
    return null;
  }

  // Token already revoked
  if (record.revokedAt) {
    return null;
  }

  // Token already used — THEFT DETECTED: revoke entire family
  if (record.usedAt) {
    console.error(
      JSON.stringify({
        event: "refresh_token_reuse_detected",
        severity: "CRITICAL",
        userId: record.userId,
        family,
        message: "Potential token theft — revoking all tokens in family",
        ts: new Date().toISOString(),
      }),
    );
    await revokeTokenFamily(family);
    return null;
  }

  // Mark as used
  await db
    .update(refreshTokens)
    .set({ usedAt: new Date() })
    .where(eq(refreshTokens.id, record.id));

  return { userId: record.userId, family };
}

/**
 * Revoke all tokens in a family (used on theft detection).
 */
export async function revokeTokenFamily(family: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.family, family),
        isNull(refreshTokens.revokedAt),
      ),
    );
}

/**
 * Revoke all refresh tokens for a user (on password change, account delete, etc).
 */
export async function revokeAllRefreshTokens(userId: number): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
      ),
    );
}
