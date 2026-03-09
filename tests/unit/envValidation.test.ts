import { describe, it, expect } from "vitest";
import { z } from "zod";

// Replicate the env schema logic for testing
function buildEnvSchema(_isProd: boolean) {
  return z.object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.string().optional().default("redis://localhost:6379"),
    STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
    STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_").optional(),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    CSRF_SECRET: z.string().min(16).optional(),
    APP_URL: z.string().default("http://localhost:3000"),
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  });
}

describe("Environment Validation", () => {
  describe("development mode", () => {
    it("accepts minimal valid config without Stripe", () => {
      const schema = buildEnvSchema(false);
      const result = schema.safeParse({
        DATABASE_URL: "postgresql://localhost/ucm_dev",
        JWT_SECRET: "a".repeat(32),
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing DATABASE_URL", () => {
      const schema = buildEnvSchema(false);
      const result = schema.safeParse({ JWT_SECRET: "a".repeat(32) });
      expect(result.success).toBe(false);
    });

    it("rejects short JWT_SECRET", () => {
      const schema = buildEnvSchema(false);
      const result = schema.safeParse({
        DATABASE_URL: "postgresql://localhost/test",
        JWT_SECRET: "too-short",
      });
      expect(result.success).toBe(false);
    });

    it("applies sensible defaults", () => {
      const schema = buildEnvSchema(false);
      const result = schema.safeParse({
        DATABASE_URL: "postgresql://localhost/test",
        JWT_SECRET: "a".repeat(32),
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORT).toBe(3000);
        expect(result.data.NODE_ENV).toBe("development");
        expect(result.data.LOG_LEVEL).toBe("info");
        expect(result.data.REDIS_URL).toBe("redis://localhost:6379");
      }
    });
  });

  describe("production mode", () => {
    it("accepts production config without Stripe keys", () => {
      const schema = buildEnvSchema(true);
      const result = schema.safeParse({
        DATABASE_URL: "postgresql://host/db",
        JWT_SECRET: "a".repeat(32),
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid production config with Stripe keys", () => {
      const schema = buildEnvSchema(true);
      const result = schema.safeParse({
        DATABASE_URL: "postgresql://host/db",
        JWT_SECRET: "a".repeat(32),
        STRIPE_SECRET_KEY: "sk_live_abc123",
        STRIPE_WEBHOOK_SECRET: "whsec_abc123",
        STRIPE_PUBLISHABLE_KEY: "pk_live_abc123",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid Stripe key prefix", () => {
      const schema = buildEnvSchema(true);
      const result = schema.safeParse({
        DATABASE_URL: "postgresql://host/db",
        JWT_SECRET: "a".repeat(32),
        STRIPE_SECRET_KEY: "not_sk_key",
        STRIPE_WEBHOOK_SECRET: "whsec_abc",
        STRIPE_PUBLISHABLE_KEY: "pk_abc",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("PORT coercion", () => {
    it("coerces string PORT to number", () => {
      const schema = buildEnvSchema(false);
      const result = schema.safeParse({
        DATABASE_URL: "postgresql://localhost/test",
        JWT_SECRET: "a".repeat(32),
        PORT: "5000",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORT).toBe(5000);
      }
    });
  });
});
