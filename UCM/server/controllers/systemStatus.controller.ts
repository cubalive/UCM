import type { Response } from "express";
import { type AuthRequest } from "../auth";
import { db, pool } from "../db";
import { sql, eq, desc, and, count } from "drizzle-orm";
import {
  companies, cities, users, vehicles, drivers, clinics, patients, trips,
  invoices, importJobs, importJobEvents, opsSmokeRuns,
} from "@shared/schema";
import { isJobEngineRunning } from "../lib/jobEngine";
import { getQueueStats } from "../lib/jobQueue";
import { generatePublicId } from "../public-id";

const APP_VERSION = "2.1.0";

export async function getSystemMap(_req: AuthRequest, res: Response) {
  try {
    const apiRoutes = [
      "GET /api/healthz", "GET /api/health",
      "POST /api/auth/login", "POST /api/auth/register", "GET /api/auth/me",
      "GET/POST /api/companies", "GET/POST /api/cities",
      "GET/POST /api/clinics", "GET/PUT/DELETE /api/clinics/:id",
      "GET/POST /api/patients", "GET/PUT/DELETE /api/patients/:id",
      "GET/POST /api/drivers", "GET/PUT/DELETE /api/drivers/:id",
      "GET/POST /api/vehicles", "GET/PUT/DELETE /api/vehicles/:id",
      "GET/POST /api/trips", "GET/PUT /api/trips/:id",
      "GET/POST /api/invoices",
      "POST /api/admin/imports", "POST /api/admin/imports/:id/upload",
      "POST /api/admin/imports/:id/validate", "POST /api/admin/imports/:id/run",
      "GET /api/admin/imports/:id/status",
      "GET /api/ops/health", "GET /api/ops/readyz", "GET /api/ops/db-info",
      "GET /api/ops/system-map", "GET /api/ops/system-status",
      "POST /api/ops/smoke-run", "GET /api/ops/smoke-runs",
      "GET /api/locations/states", "GET /api/locations/cities",
      "GET /api/dispatch/*", "GET /api/maps/*",
      "GET /api/intelligence/*", "GET /api/billing/*",
    ];

    const backgroundJobs = [
      { name: "OpsAlertScheduler", desc: "Monitors ops alerts, sends SMS" },
      { name: "RouteScheduler", desc: "ETA and route batch processing" },
      { name: "NoShowScheduler", desc: "Auto-marks no-show trips" },
      { name: "RecurringScheduleScheduler", desc: "Creates recurring trip instances" },
      { name: "AiEngine", desc: "AI-driven driver scoring & anomaly detection" },
      { name: "OpsScheduler", desc: "Anomaly & score recomputation cycles" },
      { name: "PayrollScheduler", desc: "Scheduled payroll runs" },
      { name: "JobEngine", desc: "Redis-backed distributed job queue processor" },
    ];

    const authMiddleware = [
      "authMiddleware - JWT Bearer + httpOnly session cookie",
      "requireRole(role) - Role-based route guard",
      "opsRouteGuard - SUPER_ADMIN only for /api/ops/*",
      "requireCompanyScope - Tenant isolation",
      "requireCityAccess - City-based access control",
    ];

    const dbTables = [
      "companies", "cities", "us_states", "us_cities",
      "users", "user_city_access",
      "clinics", "patients", "drivers", "vehicles",
      "vehicle_makes", "vehicle_models", "driver_vehicle_assignments",
      "trips", "trip_series", "trip_events", "trip_signatures", "trip_messages",
      "invoices", "invoice_payments",
      "import_jobs", "import_job_files", "import_job_events", "external_id_map",
      "audit_log", "ops_smoke_runs", "ops_alert_log",
      "jobs", "system_events",
    ];

    const externalServices = {
      supabase: { configured: !!process.env.SUPABASE_URL, purpose: "Auth profiles, RLS, storage" },
      redis: { configured: !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN), purpose: "Distributed cache, job queue, locks" },
      stripe: { configured: !!process.env.STRIPE_SECRET_KEY, purpose: "Payment processing, Connect" },
      twilio: { configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN), purpose: "SMS notifications" },
      googleMaps: { configured: !!process.env.GOOGLE_MAPS_API_KEY, purpose: "Geocoding, directions, ETA" },
      firebase: { configured: !!process.env.FIREBASE_PROJECT_ID, purpose: "Push notifications" },
    };

    console.log("\n=== UCM SYSTEM MAP ===");
    console.log("API Routes:", JSON.stringify(apiRoutes, null, 2));
    console.log("Background Jobs:", JSON.stringify(backgroundJobs, null, 2));
    console.log("Auth Middleware:", JSON.stringify(authMiddleware, null, 2));
    console.log("DB Tables:", JSON.stringify(dbTables, null, 2));
    console.log("External Services:", JSON.stringify(externalServices, null, 2));
    console.log("=== END SYSTEM MAP ===\n");

    res.json({
      version: APP_VERSION,
      apiRoutes,
      backgroundJobs,
      authMiddleware,
      dbTables,
      externalServices,
      importPipeline: {
        flow: "create_job → upload_files → dry_run → validate → run → poll_status",
        entities: ["clinics", "patients", "drivers", "vehicles"],
        features: ["header mapping", "dedup", "upsert via external_id", "natural match", "async execution"],
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

export async function getSystemStatus(_req: AuthRequest, res: Response) {
  try {
    const checks: Record<string, { ok: boolean; latencyMs?: number; note?: string; value?: any }> = {};

    const dbStart = Date.now();
    try {
      await db.execute(sql`SELECT 1`);
      checks.database = { ok: true, latencyMs: Date.now() - dbStart };
    } catch (e: any) {
      checks.database = { ok: false, latencyMs: Date.now() - dbStart, note: e.message };
    }

    try {
      const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
      const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (redisUrl && redisToken) {
        const rStart = Date.now();
        const resp = await fetch(`${redisUrl}/ping`, {
          headers: { Authorization: `Bearer ${redisToken}` },
        });
        const data = await resp.json() as any;
        checks.redis = { ok: data?.result === "PONG", latencyMs: Date.now() - rStart };
      } else {
        checks.redis = { ok: false, note: "Not configured" };
      }
    } catch (e: any) {
      checks.redis = { ok: false, note: e.message };
    }

    checks.jobEngine = { ok: isJobEngineRunning(), note: isJobEngineRunning() ? "running" : "stopped" };

    try {
      const stats = await getQueueStats();
      checks.jobQueue = { ok: true, value: stats };
    } catch (e: any) {
      checks.jobQueue = { ok: false, note: e.message };
    }

    checks.auth = { ok: !!process.env.JWT_SECRET && !!process.env.SESSION_SECRET, note: "JWT + Session secrets present" };

    const externalKeys: Record<string, boolean> = {
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      GOOGLE_MAPS_API_KEY: !!process.env.GOOGLE_MAPS_API_KEY,
      TWILIO_ACCOUNT_SID: !!process.env.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: !!process.env.TWILIO_AUTH_TOKEN,
      STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
      UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN,
      JWT_SECRET: !!process.env.JWT_SECRET,
      SESSION_SECRET: !!process.env.SESSION_SECRET,
    };
    checks.externalKeys = { ok: true, value: externalKeys };

    let entityCounts: Record<string, number> = {};
    try {
      const countRes = await db.execute(sql`
        SELECT 'companies' as entity, count(*)::int as c FROM companies
        UNION ALL SELECT 'cities', count(*)::int FROM cities
        UNION ALL SELECT 'users', count(*)::int FROM users
        UNION ALL SELECT 'drivers', count(*)::int FROM drivers
        UNION ALL SELECT 'vehicles', count(*)::int FROM vehicles
        UNION ALL SELECT 'clinics', count(*)::int FROM clinics
        UNION ALL SELECT 'patients', count(*)::int FROM patients
        UNION ALL SELECT 'trips', count(*)::int FROM trips
        UNION ALL SELECT 'invoices', count(*)::int FROM invoices
        UNION ALL SELECT 'import_jobs', count(*)::int FROM import_jobs
        ORDER BY entity
      `);
      for (const row of (countRes as any).rows) {
        entityCounts[row.entity] = row.c;
      }
      checks.dataIntegrity = { ok: true, value: entityCounts };
    } catch (e: any) {
      checks.dataIntegrity = { ok: false, note: e.message };
    }

    let fkChecks: Record<string, { ok: boolean; orphanCount: number; detail?: string }> = {};
    try {
      const fkQueries = [
        { name: "clinics→companies", query: sql`SELECT count(*)::int as c FROM clinics cl LEFT JOIN companies co ON cl.company_id = co.id WHERE co.id IS NULL` },
        { name: "patients→companies", query: sql`SELECT count(*)::int as c FROM patients p LEFT JOIN companies co ON p.company_id = co.id WHERE co.id IS NULL` },
        { name: "drivers→companies", query: sql`SELECT count(*)::int as c FROM drivers d LEFT JOIN companies co ON d.company_id = co.id WHERE co.id IS NULL` },
        { name: "vehicles→companies", query: sql`SELECT count(*)::int as c FROM vehicles v LEFT JOIN companies co ON v.company_id = co.id WHERE co.id IS NULL` },
        { name: "trips→companies", query: sql`SELECT count(*)::int as c FROM trips t LEFT JOIN companies co ON t.company_id = co.id WHERE co.id IS NULL` },
      ];
      for (const fk of fkQueries) {
        const result = await db.execute(fk.query);
        const orphanCount = (result as any).rows?.[0]?.c || 0;
        fkChecks[fk.name] = { ok: orphanCount === 0, orphanCount };
      }
    } catch {}

    let latestSmokeRun: any = null;
    try {
      const [run] = await db.select().from(opsSmokeRuns).orderBy(desc(opsSmokeRuns.id)).limit(1);
      latestSmokeRun = run || null;
    } catch {}

    const allOk = checks.database.ok && checks.auth.ok;
    const environment = process.env.NODE_ENV || "development";

    const hasFkIssues = Object.values(fkChecks).some(f => !f.ok);
    res.json({
      version: APP_VERSION,
      environment,
      baseUrl: process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:5000",
      uptime: Math.round(process.uptime()),
      memory: {
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      checks,
      entityCounts,
      fkChecks,
      latestSmokeRun,
      overallStatus: allOk ? (hasFkIssues ? "warning" : "healthy") : "degraded",
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

export async function runSmokeTest(req: AuthRequest, res: Response) {
  try {
    const user = req.user!;
    const environment = process.env.NODE_ENV || "development";

    const [run] = await db.insert(opsSmokeRuns).values({
      environment,
      status: "running",
      triggeredBy: user.userId,
    }).returning();

    res.json({ message: "Smoke test started", runId: run.id, status: "running" });

    executeSmokeTestAsync(run.id).catch(err => {
      console.error(`[SMOKE-TEST] Failed:`, err);
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

async function executeSmokeTestAsync(runId: number) {
  const steps: { name: string; pass: boolean; error?: string; detail?: string }[] = [];

  const runStep = async (name: string, fn: () => Promise<string | void>) => {
    try {
      const detail = await fn();
      steps.push({ name, pass: true, detail: detail || "OK" });
    } catch (e: any) {
      steps.push({ name, pass: false, error: e.message });
    }
  };

  await runStep("DB connectivity", async () => {
    await db.execute(sql`SELECT 1`);
    return "SELECT 1 OK";
  });

  await runStep("Redis connectivity", async () => {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return "Skipped (not configured)";
    const resp = await fetch(`${url}/ping`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await resp.json() as any;
    if (data?.result !== "PONG") throw new Error("Redis PING failed");
    return "PONG";
  });

  let testCompanyId: number | null = null;
  await runStep("Ensure Test Company (Ops)", async () => {
    const [existing] = await db.select().from(companies).where(eq(companies.name, "Test Company (Ops)"));
    if (existing) {
      testCompanyId = existing.id;
      return `Exists id=${existing.id}`;
    }
    const [created] = await db.insert(companies).values({ name: "Test Company (Ops)" }).returning();
    testCompanyId = created.id;
    return `Created id=${created.id}`;
  });

  let testCityId: number | null = null;
  await runStep("Ensure city exists for test", async () => {
    const [city] = await db.select().from(cities).limit(1);
    if (!city) throw new Error("No cities in DB");
    testCityId = city.id;
    return `Using city id=${city.id} name=${city.name}`;
  });

  let testClinicId: number | null = null;
  await runStep("Ensure Test Clinic (Ops)", async () => {
    if (!testCompanyId || !testCityId) throw new Error("Missing company or city");
    const [existing] = await db.select().from(clinics)
      .where(and(eq(clinics.name, "Test Clinic (Ops)"), eq(clinics.companyId, testCompanyId)));
    if (existing) {
      testClinicId = existing.id;
      return `Exists id=${existing.id}`;
    }
    const pid = await generatePublicId();
    const [created] = await db.insert(clinics).values({
      name: "Test Clinic (Ops)",
      companyId: testCompanyId,
      cityId: testCityId!,
      publicId: pid,
      address: "123 Test St",
      phone: "0000000000",
    }).returning();
    testClinicId = created.id;
    return `Created id=${created.id}`;
  });

  let testPatientId: number | null = null;
  await runStep("Ensure Test Patient (Ops)", async () => {
    if (!testCompanyId || !testCityId || !testClinicId) throw new Error("Missing deps");
    const [existing] = await db.select().from(patients)
      .where(and(eq(patients.firstName, "Test"), eq(patients.lastName, "Patient (Ops)"), eq(patients.companyId, testCompanyId)));
    if (existing) {
      testPatientId = existing.id;
      return `Exists id=${existing.id}`;
    }
    const pid = await generatePublicId();
    const [created] = await db.insert(patients).values({
      firstName: "Test",
      lastName: "Patient (Ops)",
      companyId: testCompanyId!,
      cityId: testCityId!,
      clinicId: testClinicId!,
      publicId: pid,
      phone: "0000000001",
    }).returning();
    testPatientId = created.id;
    return `Created id=${created.id}`;
  });

  let testDriverId: number | null = null;
  await runStep("Ensure Test Driver (Ops)", async () => {
    if (!testCompanyId || !testCityId) throw new Error("Missing deps");
    const [existing] = await db.select().from(drivers)
      .where(and(eq(drivers.firstName, "Test"), eq(drivers.lastName, "Driver (Ops)"), eq(drivers.companyId, testCompanyId)));
    if (existing) {
      testDriverId = existing.id;
      return `Exists id=${existing.id}`;
    }
    const pid = await generatePublicId();
    const [created] = await db.insert(drivers).values({
      firstName: "Test",
      lastName: "Driver (Ops)",
      companyId: testCompanyId!,
      cityId: testCityId!,
      publicId: pid,
      phone: "0000000002",
      licenseNumber: "OPS-TEST-001",
    }).returning();
    testDriverId = created.id;
    return `Created id=${created.id}`;
  });

  let testVehicleId: number | null = null;
  await runStep("Ensure Test Vehicle (Ops)", async () => {
    if (!testCompanyId || !testCityId) throw new Error("Missing deps");
    const [existing] = await db.select().from(vehicles)
      .where(and(eq(vehicles.name, "Test Vehicle (Ops)"), eq(vehicles.companyId, testCompanyId)));
    if (existing) {
      testVehicleId = existing.id;
      return `Exists id=${existing.id}`;
    }
    const pid = await generatePublicId();
    const [created] = await db.insert(vehicles).values({
      name: "Test Vehicle (Ops)",
      companyId: testCompanyId!,
      cityId: testCityId!,
      publicId: pid,
      licensePlate: "OPS-0001",
      capacity: 4,
    }).returning();
    testVehicleId = created.id;
    return `Created id=${created.id}`;
  });

  await runStep("Verify entity counts for Test Company", async () => {
    if (!testCompanyId) throw new Error("No test company");
    const [clinicCount] = await db.select({ c: count() }).from(clinics).where(eq(clinics.companyId, testCompanyId));
    const [patientCount] = await db.select({ c: count() }).from(patients).where(eq(patients.companyId, testCompanyId));
    const [driverCount] = await db.select({ c: count() }).from(drivers).where(eq(drivers.companyId, testCompanyId));
    const [vehicleCount] = await db.select({ c: count() }).from(vehicles).where(eq(vehicles.companyId, testCompanyId));
    const summary = `clinics=${clinicCount.c} patients=${patientCount.c} drivers=${driverCount.c} vehicles=${vehicleCount.c}`;
    if (clinicCount.c === 0 || patientCount.c === 0 || driverCount.c === 0 || vehicleCount.c === 0) {
      throw new Error(`Some counts are zero: ${summary}`);
    }
    return summary;
  });

  await runStep("City/State data integrity", async () => {
    const stateCount = await db.select({ c: count() }).from(sql`us_states`);
    const cityCount = await db.select({ c: count() }).from(sql`us_cities`);
    const s = (stateCount as any)[0]?.c || 0;
    const ci = (cityCount as any)[0]?.c || 0;
    if (s === 0) throw new Error("No US states in reference table");
    return `states=${s} cities=${ci}`;
  });

  await runStep("FK: Clinics → Companies", async () => {
    const orphaned = await db.execute(sql`
      SELECT count(*)::int as c FROM clinics cl
      LEFT JOIN companies co ON cl.company_id = co.id
      WHERE co.id IS NULL
    `);
    const orphanCount = (orphaned as any).rows?.[0]?.c || 0;
    if (orphanCount > 0) throw new Error(`${orphanCount} clinics with invalid company_id`);
    return `0 orphaned clinics`;
  });

  await runStep("FK: Patients → Clinics", async () => {
    const orphaned = await db.execute(sql`
      SELECT count(*)::int as c FROM patients p
      LEFT JOIN clinics cl ON p.clinic_id = cl.id
      WHERE p.clinic_id IS NOT NULL AND cl.id IS NULL
    `);
    const orphanCount = (orphaned as any).rows?.[0]?.c || 0;
    if (orphanCount > 0) throw new Error(`${orphanCount} patients with invalid clinic_id`);
    return `0 orphaned patients`;
  });

  await runStep("FK: Patients → Companies", async () => {
    const orphaned = await db.execute(sql`
      SELECT count(*)::int as c FROM patients p
      LEFT JOIN companies co ON p.company_id = co.id
      WHERE co.id IS NULL
    `);
    const orphanCount = (orphaned as any).rows?.[0]?.c || 0;
    if (orphanCount > 0) throw new Error(`${orphanCount} patients with invalid company_id`);
    return `0 orphaned patients`;
  });

  await runStep("FK: Drivers → Companies", async () => {
    const orphaned = await db.execute(sql`
      SELECT count(*)::int as c FROM drivers d
      LEFT JOIN companies co ON d.company_id = co.id
      WHERE co.id IS NULL
    `);
    const orphanCount = (orphaned as any).rows?.[0]?.c || 0;
    if (orphanCount > 0) throw new Error(`${orphanCount} drivers with invalid company_id`);
    return `0 orphaned drivers`;
  });

  await runStep("FK: Vehicles → Companies", async () => {
    const orphaned = await db.execute(sql`
      SELECT count(*)::int as c FROM vehicles v
      LEFT JOIN companies co ON v.company_id = co.id
      WHERE co.id IS NULL
    `);
    const orphanCount = (orphaned as any).rows?.[0]?.c || 0;
    if (orphanCount > 0) throw new Error(`${orphanCount} vehicles with invalid company_id`);
    return `0 orphaned vehicles`;
  });

  await runStep("FK: Trips → Companies", async () => {
    const orphaned = await db.execute(sql`
      SELECT count(*)::int as c FROM trips t
      LEFT JOIN companies co ON t.company_id = co.id
      WHERE co.id IS NULL
    `);
    const orphanCount = (orphaned as any).rows?.[0]?.c || 0;
    if (orphanCount > 0) throw new Error(`${orphanCount} trips with invalid company_id`);
    return `0 orphaned trips`;
  });

  await runStep("FK: Users → Companies", async () => {
    const orphaned = await db.execute(sql`
      SELECT count(*)::int as c FROM users u
      LEFT JOIN companies co ON u.company_id = co.id
      WHERE u.company_id IS NOT NULL AND co.id IS NULL
    `);
    const orphanCount = (orphaned as any).rows?.[0]?.c || 0;
    if (orphanCount > 0) throw new Error(`${orphanCount} users with invalid company_id`);
    return `0 orphaned users`;
  });

  await runStep("FK: Cities → US States ref", async () => {
    const orphaned = await db.execute(sql`
      SELECT count(*)::int as c FROM cities c
      LEFT JOIN us_states s ON c.state = s.code
      WHERE c.state IS NOT NULL AND s.code IS NULL
    `);
    const orphanCount = (orphaned as any).rows?.[0]?.c || 0;
    if (orphanCount > 0) throw new Error(`${orphanCount} cities with invalid state reference`);
    return `0 orphaned cities`;
  });

  await runStep("RBAC matrix loaded", async () => {
    const { ROLE_PERMISSIONS } = await import("@shared/permissions");
    const roles = Object.keys(ROLE_PERMISSIONS);
    if (roles.length < 5) throw new Error(`Only ${roles.length} roles found`);
    return `${roles.length} roles configured: ${roles.join(", ")}`;
  });

  const allPass = steps.every(s => s.pass);
  await db.update(opsSmokeRuns).set({
    status: allPass ? "passed" : "failed",
    finishedAt: new Date(),
    resultsJson: { steps, summary: { total: steps.length, passed: steps.filter(s => s.pass).length, failed: steps.filter(s => !s.pass).length } },
  }).where(eq(opsSmokeRuns.id, runId));

  console.log(`[SMOKE-TEST] Run #${runId} finished: ${allPass ? "ALL PASSED" : "SOME FAILED"} (${steps.filter(s => s.pass).length}/${steps.length})`);
}

export async function getSmokeRuns(_req: AuthRequest, res: Response) {
  try {
    const runs = await db.select().from(opsSmokeRuns).orderBy(desc(opsSmokeRuns.id)).limit(20);
    res.json({ runs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

export async function getCompanyDataOverview(req: AuthRequest, res: Response) {
  try {
    const companyId = parseInt(req.params.id as string);
    if (!companyId || isNaN(companyId)) return res.status(400).json({ error: "Invalid company ID" });

    const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
    if (!company) return res.status(404).json({ error: "Company not found" });

    const [clinicCount] = await db.select({ c: count() }).from(clinics).where(eq(clinics.companyId, companyId));
    const [patientCount] = await db.select({ c: count() }).from(patients).where(eq(patients.companyId, companyId));
    const [driverCount] = await db.select({ c: count() }).from(drivers).where(eq(drivers.companyId, companyId));
    const [vehicleCount] = await db.select({ c: count() }).from(vehicles).where(eq(vehicles.companyId, companyId));
    const [tripCount] = await db.select({ c: count() }).from(trips).where(eq(trips.companyId, companyId));

    const overview = {
      companyId,
      companyName: company.name,
      clinics: clinicCount.c,
      patients: patientCount.c,
      drivers: driverCount.c,
      vehicles: vehicleCount.c,
      trips: tripCount.c,
    };

    const hasZeroCounts = overview.clinics === 0 && overview.patients === 0 && overview.drivers === 0 && overview.vehicles === 0;

    res.json({ ...overview, warning: hasZeroCounts ? "No related data found for this company" : null });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

export async function getImportRuns(_req: AuthRequest, res: Response) {
  try {
    const jobs = await db.select({
      id: importJobs.id,
      companyId: importJobs.companyId,
      sourceSystem: importJobs.sourceSystem,
      status: importJobs.status,
      summaryJson: importJobs.summaryJson,
      createdAt: importJobs.createdAt,
      updatedAt: importJobs.updatedAt,
    }).from(importJobs).orderBy(desc(importJobs.createdAt)).limit(50);

    const enriched = await Promise.all(jobs.map(async (job) => {
      const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, job.companyId));
      return { ...job, companyName: company?.name || "Unknown" };
    }));

    res.json({ imports: enriched });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

export async function getImportRunEvents(req: AuthRequest, res: Response) {
  try {
    const jobId = req.params.id as string;
    const events = await db.select().from(importJobEvents)
      .where(eq(importJobEvents.importJobId, jobId))
      .orderBy(desc(importJobEvents.createdAt))
      .limit(200);

    const errorEvents = events.filter(e => e.level === "error" || e.level === "warn");

    let csvContent = "row,entity,level,message\n";
    for (const evt of errorEvents) {
      const payload = evt.payload as any;
      const row = payload?.row || "";
      const entity = payload?.entity || "";
      const escapedMsg = evt.message.replace(/"/g, '""');
      csvContent += `${row},"${entity}","${evt.level}","${escapedMsg}"\n`;
    }

    res.json({
      events,
      errorCount: errorEvents.length,
      errorCsv: csvContent,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

export async function getEventBusStatus(_req: AuthRequest, res: Response) {
  try {
    const { isEventBusEnabled } = await import("../lib/eventBus");
    const { ORCHESTRATOR_INFO } = await import("../orchestrator");

    const enabled = isEventBusEnabled();
    const hasRedisUrl = !!process.env.UPSTASH_REDIS_REST_URL;
    const hasRedisToken = !!process.env.UPSTASH_REDIS_REST_TOKEN;
    const agenticFlag = process.env.UCM_AGENTIC_ROUTES || null;

    let reason = "enabled";
    if (!enabled) {
      if (agenticFlag !== "1") reason = "UCM_AGENTIC_ROUTES!=1";
      else if (!hasRedisUrl || !hasRedisToken) reason = "Redis unavailable";
      else reason = "unknown";
    }

    res.json({
      enabled,
      reason,
      env: {
        UCM_AGENTIC_ROUTES: agenticFlag,
        hasRedisUrl,
        hasRedisToken,
      },
      orchestrator: {
        consumerName: ORCHESTRATOR_INFO.consumer,
        pollMs: ORCHESTRATOR_INFO.pollMs,
        batchSize: ORCHESTRATOR_INFO.batchSize,
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

export async function getAgenticStatus(_req: AuthRequest, res: Response) {
  try {
    const { isEventBusEnabled } = await import("../lib/eventBus");
    const { ORCHESTRATOR_INFO, isOrchestratorRunning } = await import("../orchestrator");

    res.json({
      enabled: isEventBusEnabled(),
      redisConfigured: !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
      orchestratorRunning: isOrchestratorRunning(),
      pollMs: ORCHESTRATOR_INFO.pollMs,
      batchSize: ORCHESTRATOR_INFO.batchSize,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}

export async function postAgenticSmokeTest(_req: AuthRequest, res: Response) {
  try {
    const { isEventBusEnabled, emitEvent } = await import("../lib/eventBus");
    if (!isEventBusEnabled()) {
      return res.status(503).json({ error: "Event bus is not enabled" });
    }

    const testPayload = {
      tripId: 999999,
      pickupLat: 36.1,
      pickupLng: -115.1,
      dropoffLat: 36.2,
      dropoffLng: -115.2,
    };

    const streamId = await emitEvent("trip.created", testPayload, `smoke-test:${Date.now()}`);

    console.log(JSON.stringify({
      event: "agentic_smoke_test",
      streamId,
      payload: testPayload,
      ts: new Date().toISOString(),
    }));

    res.json({
      ok: true,
      streamId,
      payload: testPayload,
      message: "Test event emitted. Check orchestrator logs for consumption.",
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
