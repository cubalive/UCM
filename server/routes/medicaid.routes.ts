import { Router, type Express } from "express";
import type { Response } from "express";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { requireTenantScope, getTenantId } from "../middleware";
import { db } from "../db";
import {
  medicaidBillingCodes,
  medicaidClaims,
  medicaidRemittance,
  trips,
  patients,
} from "@shared/schema";
import { eq, and, gte, lte, desc, inArray, sql, isNull, or } from "drizzle-orm";
import {
  generateMedicaidClaim,
  batchGenerateClaims,
  validateClaim,
  generateEdi837,
  parseEdi835,
  importRemittance,
  getMedicaidDashboardStats,
} from "../lib/medicaidBillingEngine";

const router = Router();

// ─── HCPCS Billing Codes ────────────────────────────────────────────────────

/**
 * GET /api/medicaid/codes
 * List all HCPCS billing codes, optionally filtered by active status.
 */
router.get(
  "/api/medicaid/codes",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  async (req: AuthRequest, res: Response) => {
    try {
      const activeOnly = req.query.active !== "false";
      const conditions = activeOnly ? [eq(medicaidBillingCodes.active, true)] : [];

      const codes = await db
        .select()
        .from(medicaidBillingCodes)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(medicaidBillingCodes.code);

      res.json(codes);
    } catch (err: any) {
      console.error("[Medicaid] Error listing codes:", err.message);
      res.status(500).json({ message: "Failed to list billing codes" });
    }
  },
);

/**
 * POST /api/medicaid/codes
 * Create or update a HCPCS billing code. Admin only.
 */
router.post(
  "/api/medicaid/codes",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        id,
        code,
        description,
        serviceType,
        baseRateCents,
        perMileRateCents,
        modifiers,
        state,
        effectiveFrom,
        effectiveTo,
        active,
      } = req.body;

      if (!code || !description || !serviceType || !effectiveFrom) {
        return res.status(400).json({
          message: "code, description, serviceType, and effectiveFrom are required",
        });
      }

      if (id) {
        // Update existing
        const [updated] = await db
          .update(medicaidBillingCodes)
          .set({
            code,
            description,
            serviceType,
            baseRateCents: baseRateCents ?? 0,
            perMileRateCents: perMileRateCents ?? 0,
            modifiers: modifiers || null,
            state: state || null,
            effectiveFrom: new Date(effectiveFrom),
            effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
            active: active ?? true,
          })
          .where(eq(medicaidBillingCodes.id, id))
          .returning();

        return res.json(updated);
      }

      // Create new
      const [created] = await db
        .insert(medicaidBillingCodes)
        .values({
          code,
          description,
          serviceType,
          baseRateCents: baseRateCents ?? 0,
          perMileRateCents: perMileRateCents ?? 0,
          modifiers: modifiers || null,
          state: state || null,
          effectiveFrom: new Date(effectiveFrom),
          effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
          active: active ?? true,
        })
        .returning();

      res.status(201).json(created);
    } catch (err: any) {
      console.error("[Medicaid] Error creating/updating code:", err.message);
      res.status(500).json({ message: "Failed to save billing code" });
    }
  },
);

// ─── Claims ──────────────────────────────────────────────────────────────────

/**
 * GET /api/medicaid/claims
 * List Medicaid claims with optional filters.
 */
router.get(
  "/api/medicaid/claims",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ message: "Company context required" });
      }

      const { status, startDate, endDate, patientId, page, limit: limitStr } = req.query;
      const pageNum = Math.max(1, parseInt(String(page || "1"), 10));
      const limitNum = Math.min(200, Math.max(1, parseInt(String(limitStr || "50"), 10)));
      const offset = (pageNum - 1) * limitNum;

      const conditions = [eq(medicaidClaims.companyId, tenantId)];

      if (status && typeof status === "string") {
        conditions.push(eq(medicaidClaims.status, status as any));
      }
      if (startDate && typeof startDate === "string") {
        conditions.push(gte(medicaidClaims.serviceDate, startDate));
      }
      if (endDate && typeof endDate === "string") {
        conditions.push(lte(medicaidClaims.serviceDate, endDate));
      }
      if (patientId) {
        conditions.push(eq(medicaidClaims.patientId, parseInt(String(patientId), 10)));
      }

      const [claims, countResult] = await Promise.all([
        db
          .select({
            claim: medicaidClaims,
            patientFirstName: patients.firstName,
            patientLastName: patients.lastName,
            tripPublicId: trips.publicId,
          })
          .from(medicaidClaims)
          .leftJoin(patients, eq(patients.id, medicaidClaims.patientId))
          .leftJoin(trips, eq(trips.id, medicaidClaims.tripId))
          .where(and(...conditions))
          .orderBy(desc(medicaidClaims.createdAt))
          .limit(limitNum)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(medicaidClaims)
          .where(and(...conditions)),
      ]);

      res.json({
        claims: claims.map((row) => ({
          ...row.claim,
          patientName: row.patientFirstName
            ? `${row.patientFirstName} ${row.patientLastName}`
            : null,
          tripPublicId: row.tripPublicId,
        })),
        total: countResult[0]?.count || 0,
        page: pageNum,
        limit: limitNum,
      });
    } catch (err: any) {
      console.error("[Medicaid] Error listing claims:", err.message);
      res.status(500).json({ message: "Failed to list claims" });
    }
  },
);

/**
 * POST /api/medicaid/claims/generate
 * Generate claims for completed trips. Accepts either a single tripId
 * or a date range for batch generation.
 */
router.post(
  "/api/medicaid/claims/generate",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ message: "Company context required" });
      }

      const { tripId, startDate, endDate, providerNpi, taxonomyCode, priorAuthNumber, diagnosisCode } = req.body;

      if (!providerNpi) {
        return res.status(400).json({ message: "providerNpi is required" });
      }

      if (tripId) {
        // Single trip generation
        const claim = await generateMedicaidClaim(
          tripId,
          providerNpi,
          taxonomyCode,
          priorAuthNumber,
          diagnosisCode,
        );
        return res.status(201).json(claim);
      }

      if (startDate && endDate) {
        // Batch generation
        const result = await batchGenerateClaims(
          tenantId,
          startDate,
          endDate,
          providerNpi,
          taxonomyCode,
        );
        return res.json(result);
      }

      res.status(400).json({ message: "Provide tripId or startDate+endDate" });
    } catch (err: any) {
      console.error("[Medicaid] Error generating claims:", err.message);
      res.status(400).json({ message: err.message });
    }
  },
);

/**
 * GET /api/medicaid/claims/:id
 * Get a single claim with full details.
 */
router.get(
  "/api/medicaid/claims/:id",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const claimId = parseInt(String(req.params.id), 10);

      if (isNaN(claimId)) {
        return res.status(400).json({ message: "Invalid claim ID" });
      }

      const conditions = [eq(medicaidClaims.id, claimId)];
      if (tenantId) {
        conditions.push(eq(medicaidClaims.companyId, tenantId));
      }

      const [row] = await db
        .select({
          claim: medicaidClaims,
          patientFirstName: patients.firstName,
          patientLastName: patients.lastName,
          patientMedicaidState: patients.medicaidState,
          tripPublicId: trips.publicId,
          tripPickupAddress: trips.pickupAddress,
          tripDropoffAddress: trips.dropoffAddress,
          tripScheduledDate: trips.scheduledDate,
        })
        .from(medicaidClaims)
        .leftJoin(patients, eq(patients.id, medicaidClaims.patientId))
        .leftJoin(trips, eq(trips.id, medicaidClaims.tripId))
        .where(and(...conditions))
        .limit(1);

      if (!row) {
        return res.status(404).json({ message: "Claim not found" });
      }

      // Fetch remittance records
      const remittances = await db
        .select()
        .from(medicaidRemittance)
        .where(eq(medicaidRemittance.claimId, claimId))
        .orderBy(desc(medicaidRemittance.createdAt));

      res.json({
        ...row.claim,
        patientName: row.patientFirstName
          ? `${row.patientFirstName} ${row.patientLastName}`
          : null,
        patientMedicaidState: row.patientMedicaidState,
        tripPublicId: row.tripPublicId,
        tripPickupAddress: row.tripPickupAddress,
        tripDropoffAddress: row.tripDropoffAddress,
        tripScheduledDate: row.tripScheduledDate,
        remittances,
      });
    } catch (err: any) {
      console.error("[Medicaid] Error fetching claim:", err.message);
      res.status(500).json({ message: "Failed to fetch claim" });
    }
  },
);

/**
 * PUT /api/medicaid/claims/:id
 * Update a draft claim.
 */
router.put(
  "/api/medicaid/claims/:id",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const claimId = parseInt(String(req.params.id), 10);

      if (isNaN(claimId)) {
        return res.status(400).json({ message: "Invalid claim ID" });
      }

      // Verify claim exists and belongs to tenant
      const conditions = [eq(medicaidClaims.id, claimId)];
      if (tenantId) {
        conditions.push(eq(medicaidClaims.companyId, tenantId));
      }

      const [existing] = await db
        .select()
        .from(medicaidClaims)
        .where(and(...conditions))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ message: "Claim not found" });
      }

      if (existing.status !== "draft") {
        return res.status(400).json({
          message: `Cannot edit claim in '${existing.status}' status. Only draft claims can be edited.`,
        });
      }

      const {
        hcpcsCode,
        modifiers,
        diagnosisCode,
        units,
        amountCents,
        mileage,
        providerNpi,
        taxonomyCode,
        placeOfService,
        priorAuthNumber,
        patientMedicaidId,
      } = req.body;

      const [updated] = await db
        .update(medicaidClaims)
        .set({
          ...(hcpcsCode !== undefined && { hcpcsCode }),
          ...(modifiers !== undefined && { modifiers }),
          ...(diagnosisCode !== undefined && { diagnosisCode }),
          ...(units !== undefined && { units }),
          ...(amountCents !== undefined && { amountCents }),
          ...(mileage !== undefined && { mileage: String(mileage) }),
          ...(providerNpi !== undefined && { providerNpi }),
          ...(taxonomyCode !== undefined && { taxonomyCode }),
          ...(placeOfService !== undefined && { placeOfService }),
          ...(priorAuthNumber !== undefined && { priorAuthNumber }),
          ...(patientMedicaidId !== undefined && { patientMedicaidId }),
          updatedAt: new Date(),
        })
        .where(eq(medicaidClaims.id, claimId))
        .returning();

      res.json(updated);
    } catch (err: any) {
      console.error("[Medicaid] Error updating claim:", err.message);
      res.status(500).json({ message: "Failed to update claim" });
    }
  },
);

/**
 * POST /api/medicaid/claims/:id/submit
 * Submit a draft claim. Validates required fields before submission.
 */
router.post(
  "/api/medicaid/claims/:id/submit",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const claimId = parseInt(String(req.params.id), 10);

      if (isNaN(claimId)) {
        return res.status(400).json({ message: "Invalid claim ID" });
      }

      const conditions = [eq(medicaidClaims.id, claimId)];
      if (tenantId) {
        conditions.push(eq(medicaidClaims.companyId, tenantId));
      }

      const [claim] = await db
        .select()
        .from(medicaidClaims)
        .where(and(...conditions))
        .limit(1);

      if (!claim) {
        return res.status(404).json({ message: "Claim not found" });
      }

      if (claim.status !== "draft") {
        return res.status(400).json({
          message: `Cannot submit claim in '${claim.status}' status`,
        });
      }

      // Validate claim
      const validationErrors = validateClaim(claim);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          message: "Claim validation failed",
          errors: validationErrors,
        });
      }

      const [updated] = await db
        .update(medicaidClaims)
        .set({
          status: "submitted",
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(medicaidClaims.id, claimId))
        .returning();

      res.json(updated);
    } catch (err: any) {
      console.error("[Medicaid] Error submitting claim:", err.message);
      res.status(500).json({ message: "Failed to submit claim" });
    }
  },
);

/**
 * POST /api/medicaid/claims/batch-submit
 * Batch submit multiple draft claims.
 */
router.post(
  "/api/medicaid/claims/batch-submit",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ message: "Company context required" });
      }

      const { claimIds } = req.body;
      if (!Array.isArray(claimIds) || claimIds.length === 0) {
        return res.status(400).json({ message: "claimIds array is required" });
      }

      // Fetch all draft claims matching the IDs and tenant
      const claims = await db
        .select()
        .from(medicaidClaims)
        .where(
          and(
            inArray(medicaidClaims.id, claimIds),
            eq(medicaidClaims.companyId, tenantId),
            eq(medicaidClaims.status, "draft"),
          ),
        );

      const submitted: number[] = [];
      const errors: Array<{ claimId: number; errors: any[] }> = [];

      for (const claim of claims) {
        const validationErrors = validateClaim(claim);
        if (validationErrors.length > 0) {
          errors.push({ claimId: claim.id, errors: validationErrors });
          continue;
        }

        await db
          .update(medicaidClaims)
          .set({
            status: "submitted",
            submittedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(medicaidClaims.id, claim.id));

        submitted.push(claim.id);
      }

      const skippedCount = claimIds.length - claims.length;

      res.json({
        submitted: submitted.length,
        failed: errors.length,
        skipped: skippedCount,
        errors,
      });
    } catch (err: any) {
      console.error("[Medicaid] Error batch submitting:", err.message);
      res.status(500).json({ message: "Failed to batch submit claims" });
    }
  },
);

/**
 * POST /api/medicaid/claims/:id/void
 * Void a claim. Can void claims in any status except already voided.
 */
router.post(
  "/api/medicaid/claims/:id/void",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const claimId = parseInt(String(req.params.id), 10);

      if (isNaN(claimId)) {
        return res.status(400).json({ message: "Invalid claim ID" });
      }

      const conditions = [eq(medicaidClaims.id, claimId)];
      if (tenantId) {
        conditions.push(eq(medicaidClaims.companyId, tenantId));
      }

      const [claim] = await db
        .select()
        .from(medicaidClaims)
        .where(and(...conditions))
        .limit(1);

      if (!claim) {
        return res.status(404).json({ message: "Claim not found" });
      }

      if (claim.status === "void") {
        return res.status(400).json({ message: "Claim is already voided" });
      }

      const { reason } = req.body;

      const [updated] = await db
        .update(medicaidClaims)
        .set({
          status: "void",
          denialReason: reason || "Voided by user",
          updatedAt: new Date(),
        })
        .where(eq(medicaidClaims.id, claimId))
        .returning();

      res.json(updated);
    } catch (err: any) {
      console.error("[Medicaid] Error voiding claim:", err.message);
      res.status(500).json({ message: "Failed to void claim" });
    }
  },
);

// ─── EDI Export / Import ─────────────────────────────────────────────────────

/**
 * GET /api/medicaid/claims/export/edi837
 * Export claims as EDI 837P format. Query params: claimIds (comma-separated)
 * or status=submitted to export all submitted claims.
 */
router.get(
  "/api/medicaid/claims/export/edi837",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ message: "Company context required" });
      }

      let claimIds: number[] = [];

      if (req.query.claimIds && typeof req.query.claimIds === "string") {
        claimIds = req.query.claimIds
          .split(",")
          .map((id) => parseInt(id.trim(), 10))
          .filter((id) => !isNaN(id));
      } else {
        // Default: export all submitted claims for the tenant
        const submittedClaims = await db
          .select({ id: medicaidClaims.id })
          .from(medicaidClaims)
          .where(
            and(
              eq(medicaidClaims.companyId, tenantId),
              eq(medicaidClaims.status, "submitted"),
            ),
          );

        claimIds = submittedClaims.map((c) => c.id);
      }

      if (claimIds.length === 0) {
        return res.status(400).json({ message: "No claims found to export" });
      }

      const ediContent = await generateEdi837(claimIds);

      res.set({
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename="837P_${new Date().toISOString().slice(0, 10)}.edi"`,
      });
      res.send(ediContent);
    } catch (err: any) {
      console.error("[Medicaid] Error generating EDI 837:", err.message);
      res.status(500).json({ message: err.message });
    }
  },
);

/**
 * POST /api/medicaid/remittance/import
 * Import EDI 835 remittance advice. Accepts raw EDI text in body.
 */
router.post(
  "/api/medicaid/remittance/import",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ message: "Company context required" });
      }

      const { ediContent } = req.body;
      if (!ediContent || typeof ediContent !== "string") {
        return res.status(400).json({ message: "ediContent (string) is required in request body" });
      }

      const parsed = parseEdi835(ediContent);

      if (parsed.claims.length === 0) {
        return res.status(400).json({ message: "No claims found in EDI 835 content" });
      }

      const result = await importRemittance(parsed, tenantId);

      res.json({
        payerName: parsed.payerName,
        checkNumber: parsed.checkNumber,
        paymentDate: parsed.paymentDate,
        totalClaimsInFile: parsed.claims.length,
        ...result,
      });
    } catch (err: any) {
      console.error("[Medicaid] Error importing remittance:", err.message);
      res.status(500).json({ message: "Failed to import remittance" });
    }
  },
);

// ─── Dashboard ───────────────────────────────────────────────────────────────

/**
 * GET /api/medicaid/dashboard
 * Dashboard with claim stats for the tenant.
 */
router.get(
  "/api/medicaid/dashboard",
  authMiddleware,
  requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN", "DISPATCH"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ message: "Company context required" });
      }

      const { startDate, endDate } = req.query;

      const stats = await getMedicaidDashboardStats(
        tenantId,
        startDate as string | undefined,
        endDate as string | undefined,
      );

      res.json(stats);
    } catch (err: any) {
      console.error("[Medicaid] Error fetching dashboard:", err.message);
      res.status(500).json({ message: "Failed to fetch dashboard stats" });
    }
  },
);

// ─── Register ────────────────────────────────────────────────────────────────

export function registerMedicaidRoutes(app: Express) {
  app.use(router);
}
