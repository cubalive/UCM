// Global test setup
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "error";
// Provide a dummy DB URL so server modules can be imported in tests without process.exit
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  process.env.DATABASE_URL = "postgresql://test:test@db.test.supabase.co:5432/test";
}
