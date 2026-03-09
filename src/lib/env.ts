import { z } from "zod";

const isProd = process.env.NODE_ENV === "production";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_").optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().startsWith("pk_").optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  CSRF_SECRET: z.string().min(16).optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  FROM_EMAIL: z.string().email().optional().default("noreply@ucm.example.com"),
  APP_URL: z.string().default("http://localhost:3000"),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),
  SENTRY_DSN: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      console.error("Invalid environment variables:", JSON.stringify(errors, null, 2));
      if (isProd) {
        process.exit(1);
      }
      throw new Error("Invalid environment configuration");
    }
    _env = result.data;
  }
  return _env;
}
