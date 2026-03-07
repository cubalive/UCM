import type { Express } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { pool } from "../db";

export function registerIntegrityRoutes(app: Express) {
  const gate = [authMiddleware, requireRole("SUPER_ADMIN")] as any[];

  app.get("/api/admin/integrity", ...gate, async (_req: any, res: any) => {
    try {
      const client = await pool.connect();
      try {
        const checks: Record<string, any> = {};

        const nullCompany = await client.query(`
          SELECT 'vehicles' AS entity, COUNT(*) FILTER (WHERE company_id IS NULL)::int AS null_count, COUNT(*)::int AS total FROM vehicles
          UNION ALL SELECT 'drivers', COUNT(*) FILTER (WHERE company_id IS NULL), COUNT(*) FROM drivers
          UNION ALL SELECT 'clinics', COUNT(*) FILTER (WHERE company_id IS NULL), COUNT(*) FROM clinics
          UNION ALL SELECT 'patients', COUNT(*) FILTER (WHERE company_id IS NULL), COUNT(*) FROM patients
          UNION ALL SELECT 'trips', COUNT(*) FILTER (WHERE company_id IS NULL), COUNT(*) FROM trips
        `);
        checks.nullCompanyId = nullCompany.rows;

        const nullCity = await client.query(`
          SELECT 'vehicles' AS entity, COUNT(*) FILTER (WHERE city_id IS NULL)::int AS null_count FROM vehicles
          UNION ALL SELECT 'drivers', COUNT(*) FILTER (WHERE city_id IS NULL) FROM drivers
          UNION ALL SELECT 'clinics', COUNT(*) FILTER (WHERE city_id IS NULL) FROM clinics
          UNION ALL SELECT 'patients', COUNT(*) FILTER (WHERE city_id IS NULL) FROM patients
          UNION ALL SELECT 'trips', COUNT(*) FILTER (WHERE city_id IS NULL) FROM trips
        `);
        checks.nullCityId = nullCity.rows;

        const orphanVehicles = await client.query(`
          SELECT COUNT(*)::int AS cnt FROM vehicles v
          WHERE v.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = v.company_id)
        `);
        const orphanDrivers = await client.query(`
          SELECT COUNT(*)::int AS cnt FROM drivers d
          WHERE d.company_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = d.company_id)
        `);
        const orphanPatients = await client.query(`
          SELECT COUNT(*)::int AS cnt FROM patients p
          WHERE p.clinic_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clinics cl WHERE cl.id = p.clinic_id)
        `);
        const orphanTrips = await client.query(`
          SELECT COUNT(*)::int AS cnt FROM trips t
          WHERE t.patient_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patients p WHERE p.id = t.patient_id)
        `);
        checks.orphans = {
          vehiclesWithInvalidCompany: orphanVehicles.rows[0].cnt,
          driversWithInvalidCompany: orphanDrivers.rows[0].cnt,
          patientsWithInvalidClinic: orphanPatients.rows[0].cnt,
          tripsWithInvalidPatient: orphanTrips.rows[0].cnt,
        };

        const crossCompany = await client.query(`
          SELECT COUNT(*)::int AS cnt FROM trips t
          JOIN drivers d ON d.id = t.driver_id
          WHERE t.company_id IS NOT NULL AND d.company_id IS NOT NULL AND t.company_id != d.company_id
        `);
        checks.crossCompanyAssignments = {
          tripsWithMismatchedDriver: crossCompany.rows[0].cnt,
        };

        const softDeleted = await client.query(`
          SELECT 'vehicles' AS entity, COUNT(*)::int AS cnt FROM vehicles WHERE deleted_at IS NOT NULL
          UNION ALL SELECT 'drivers', COUNT(*) FROM drivers WHERE deleted_at IS NOT NULL
          UNION ALL SELECT 'patients', COUNT(*) FROM patients WHERE deleted_at IS NOT NULL
          UNION ALL SELECT 'trips', COUNT(*) FROM trips WHERE deleted_at IS NOT NULL
          UNION ALL SELECT 'clinics', COUNT(*) FROM clinics WHERE deleted_at IS NOT NULL
        `);
        checks.softDeleted = softDeleted.rows;

        const totalNullIssues = nullCompany.rows.reduce((sum: number, r: any) => sum + r.null_count, 0) +
          nullCity.rows.reduce((sum: number, r: any) => sum + r.null_count, 0);
        const totalOrphans = Object.values(checks.orphans).reduce((sum: any, v: any) => sum + v, 0);

        res.json({
          ok: true,
          healthy: totalNullIssues === 0 && totalOrphans === 0 && crossCompany.rows[0].cnt === 0,
          totalNullIssues,
          totalOrphans,
          crossCompanyViolations: crossCompany.rows[0].cnt,
          checks,
        });
      } finally {
        client.release();
      }
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });
}
