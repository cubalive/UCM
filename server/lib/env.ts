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
