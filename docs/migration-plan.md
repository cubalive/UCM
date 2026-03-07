# UCM Platform — Migration Strategy

## Current State
- Database schema defined in `src/db/schema.ts` using Drizzle ORM
- Migrations generated via `drizzle-kit generate` into `drizzle/` directory
- Currently using `drizzle-kit push` for development (direct schema push)

## Target State
- Managed, versioned migrations via Drizzle Kit
- Migrations run as a separate step before application boot
- No boot-time schema changes in production

## Migration from Boot-Time to Managed Migrations

### Step 1: Generate Migration Baseline
```bash
npx drizzle-kit generate
```
This creates SQL migration files in `drizzle/` from the current schema.

### Step 2: Verify Migration Files
Review generated SQL in `drizzle/` directory. Ensure:
- All tables, indexes, and constraints are present
- No destructive changes (DROP TABLE, DROP COLUMN)
- Enum types are created correctly

### Step 3: Apply Migrations in CI/CD
In the CI pipeline (`.github/workflows/ci.yml`):
```bash
npx drizzle-kit migrate
```

In Railway deployment:
- Add a pre-deploy command: `npx drizzle-kit migrate`
- Remove any boot-time migration logic from `src/index.ts`

### Step 4: Railway Configuration
```toml
# railway.toml
[deploy]
  startCommand = "node dist/index.js"

[build]
  buildCommand = "npm ci && npx tsc"

# Add custom deploy command in Railway dashboard:
# Pre-deploy: npx drizzle-kit migrate
```

### Step 5: Staging/Production Workflow
1. Developer creates schema change in `src/db/schema.ts`
2. Run `npx drizzle-kit generate` locally
3. Review generated migration SQL
4. Commit migration files to git
5. CI runs migrations against test DB
6. On deploy, Railway runs `npx drizzle-kit migrate` before starting app

### Rollback Strategy
- Keep previous migration files in version control
- For simple rollbacks: create a new "down" migration manually
- For emergencies: restore DB from Supabase point-in-time recovery
- Never delete migration files from the `drizzle/` directory

### Safety Checks
- CI pipeline validates migrations against a fresh test DB
- Integration tests run after migrations to verify schema correctness
- Production deploys require passing CI before merge
