// Global test setup
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";
// Ensure DB URL contains "supabase" in hostname so server/db.ts doesn't call process.exit
// This overrides any CI-provided DATABASE_URL that may use localhost
if (!process.env.SUPABASE_DB_URL) {
  process.env.DATABASE_URL = "postgresql://test:test@db.test.supabase.co:5432/test";
}
