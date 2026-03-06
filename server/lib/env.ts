/**
 * Environment detection and configuration.
 *
 * UCM_ENV explicitly sets the deployment environment (staging, production).
 * Falls back to NODE_ENV if UCM_ENV is not set.
 * Safe defaults ensure nothing breaks if neither is set.
 */

export type UcmEnvironment = "production" | "staging" | "development";

export function getEnvironment(): UcmEnvironment {
  const explicit = process.env.UCM_ENV?.toLowerCase();
  if (explicit === "production" || explicit === "staging" || explicit === "development") {
    return explicit;
  }
  // Fall back to NODE_ENV
  const nodeEnv = process.env.NODE_ENV?.toLowerCase();
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "staging") return "staging";
  return "development";
}

export function getRunMode(): string {
  return (process.env.RUN_MODE || process.env.ROLE_MODE || "all").toLowerCase();
}

export function getVersion(): string {
  return process.env.UCM_BUILD_VERSION || process.env.BUILD_VERSION || "dev";
}

export function isProduction(): boolean {
  return getEnvironment() === "production";
}

export function isStaging(): boolean {
  return getEnvironment() === "staging";
}

/** Returns true for both production and staging (deployed environments). */
export function isDeployed(): boolean {
  return getEnvironment() !== "development";
}

/**
 * Validate critical environment variables at boot.
 * Logs warnings for missing recommended vars, exits for missing required vars in production.
 */
export function validateEnvAtBoot(): void {
  const env = getEnvironment();
  const isProd = env === "production" || env === "staging";
  const missing: string[] = [];
  const warnings: string[] = [];

  // Always required
  if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL) {
    missing.push("SUPABASE_DB_URL (or DATABASE_URL)");
  }

  if (isProd) {
    // Required in production
    if (!process.env.JWT_SECRET) missing.push("JWT_SECRET");
    if (!process.env.SESSION_SECRET) warnings.push("SESSION_SECRET");
    if (!process.env.SUPABASE_URL) warnings.push("SUPABASE_URL");
    if (!process.env.SUPABASE_ANON_KEY) warnings.push("SUPABASE_ANON_KEY");

    // Recommended for full functionality
    if (!process.env.STRIPE_SECRET_KEY) warnings.push("STRIPE_SECRET_KEY (billing disabled)");
    if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
      warnings.push("STRIPE_WEBHOOK_SECRET (webhooks will fail signature verification)");
    }
    if (!process.env.GOOGLE_MAPS_API_KEY) warnings.push("GOOGLE_MAPS_API_KEY (routing/ETA disabled)");
    if (!process.env.UPSTASH_REDIS_REST_URL) warnings.push("UPSTASH_REDIS_REST_URL (using in-memory fallback — no distributed locking)");
    if (!process.env.PUBLIC_BASE_URL) warnings.push("PUBLIC_BASE_URL (email links may break)");
  }

  if (missing.length > 0) {
    console.error(JSON.stringify({
      event: "env_validation_fatal",
      missing,
      environment: env,
      ts: new Date().toISOString(),
    }));
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn(JSON.stringify({
      event: "env_validation_warnings",
      warnings,
      environment: env,
      ts: new Date().toISOString(),
    }));
  }
}
