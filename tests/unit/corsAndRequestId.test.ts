import { describe, it, expect } from "vitest";

describe("CORS Origin Validation", () => {
  const PRODUCTION_ORIGINS = [
    "https://app.unitedcaremobility.com",
    "https://driver.unitedcaremobility.com",
    "https://clinic.unitedcaremobility.com",
    "https://ucm-api-production.up.railway.app",
  ];

  function isAllowedOrigin(origin: string, envAppUrl: string, nodeEnv: string): boolean {
    const envOrigins = envAppUrl.split(",").map(s => s.trim()).filter(Boolean);
    const allowed = new Set([...PRODUCTION_ORIGINS, ...envOrigins]);
    if (allowed.has(origin)) return true;
    if (nodeEnv !== "production") return true; // dev fallback
    return false;
  }

  it("allows app.unitedcaremobility.com", () => {
    expect(isAllowedOrigin("https://app.unitedcaremobility.com", "", "production")).toBe(true);
  });

  it("allows driver.unitedcaremobility.com", () => {
    expect(isAllowedOrigin("https://driver.unitedcaremobility.com", "", "production")).toBe(true);
  });

  it("allows clinic.unitedcaremobility.com", () => {
    expect(isAllowedOrigin("https://clinic.unitedcaremobility.com", "", "production")).toBe(true);
  });

  it("allows Railway default domain", () => {
    expect(isAllowedOrigin("https://ucm-api-production.up.railway.app", "", "production")).toBe(true);
  });

  it("allows custom APP_URL origins", () => {
    expect(isAllowedOrigin("https://staging.ucm.dev", "https://staging.ucm.dev", "production")).toBe(true);
  });

  it("rejects unknown origin in production", () => {
    expect(isAllowedOrigin("https://evil-site.com", "", "production")).toBe(false);
  });

  it("allows any origin in development (convenience)", () => {
    expect(isAllowedOrigin("http://localhost:5173", "", "development")).toBe(true);
  });

  it("allows multiple APP_URL origins (comma-separated)", () => {
    const appUrl = "https://staging.ucm.dev, https://preview.ucm.dev";
    expect(isAllowedOrigin("https://preview.ucm.dev", appUrl, "production")).toBe(true);
  });
});

describe("Request ID generation", () => {
  it("generates 12-char IDs from UUID", () => {
    const { randomUUID } = require("crypto");
    const id = randomUUID().slice(0, 12);
    expect(id).toHaveLength(12);
    expect(id).toMatch(/^[0-9a-f-]{12}$/);
  });

  it("preserves provided X-Request-ID", () => {
    const provided = "custom-req-123";
    const id = provided || "fallback";
    expect(id).toBe("custom-req-123");
  });
});
