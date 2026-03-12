import { randomUUID } from "crypto";
import { Router, type Express } from "express";
import type { Response } from "express";
import { authMiddleware, requirePermission, type AuthRequest } from "../auth";
import { requireTenantScope, getTenantId } from "../middleware";
import { db } from "../db";
import {
  ediClaims,
  ediClaimEvents,
  trips,
  patients,
  companies,
  drivers,
} from "@shared/schema";
import { eq, and, desc, inArray, sql, gte, lte } from "drizzle-orm";
import {
  generateEDI837Claim,
  generateEDI837Batch,
  getHcpcsCode,
  getMileageHcpcsCode,
  type EDI837ClaimInput,
  type EDI837Provider,
  type EDI837Payer,
} from "../lib/edi837Engine";
import { parseEDI835, getCarcDescription } from "../lib/edi835Parser";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateClaimNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = randomUUID().slice(0, 8).toUpperCase();
  return `EDI-${ts}-${rand}`;
}

// ─── POST /api/edi/claims/generate ────────────────────────────────────────────
// Generate EDI 837 claims for selected trips

router.post(
  "/api/edi/claims/generate",
  authMiddleware,
  requirePermission("billing", "write"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ message: "Company context required" });
      }

      const {
        tripIds,
        provider: providerInput,
        payer: payerInput,
      } = req.body;

      if (!Array.isArray(tripIds) || tripIds.length === 0) {
        return res.status(400).json({ message: "tripIds array is required" });
      }

      if (!providerInput?.npi) {
        return res.status(400).json({ message: "provider.npi is required" });
      }

      // Fetch company info
      const [company] = await db
        .select()
        .from(companies)
        .where(eq(companies.id, tenantId))
        .limit(1);

      // Build provider info
      const provider: EDI837Provider = {
        npi: providerInput.npi,
        taxId: providerInput.taxId || "000000000",
        taxonomyCode: providerInput.taxonomyCode || "343900000X",
        organizationName: providerInput.organizationName || company?.name || "PROVIDER",
        addressLine1: providerInput.addressLine1 || "ADDRESS LINE 1",
        city: providerInput.city || "CITY",
        state: providerInput.state || "ST",
        zip: providerInput.zip || "00000",
        contactName: providerInput.contactName,
        contactPhone: providerInput.contactPhone,
      };

      // Build payer info
      const payer: EDI837Payer = {
        payerId: payerInput?.payerId || "MEDICAID",
        payerName: payerInput?.payerName || "MEDICAID",
        addressLine1: payerInput?.addressLine1,
        city: payerInput?.city,
        state: payerInput?.state,
        zip: payerInput?.zip,
      };

      // Fetch trips with patient data
      const tripRows = await db
        .select({
          trip: trips,
          patient: patients,
        })
        .from(trips)
        .innerJoin(patients, eq(patients.id, trips.patientId))
        .where(
          and(
            inArray(trips.id, tripIds),
            eq(trips.companyId, tenantId),
            eq(trips.status, "COMPLETED"),
          ),
        );

      if (tripRows.length === 0) {
        return res.status(400).json({
          message: "No completed trips found for the given IDs",
        });
      }

      const generated: Array<{ id: number; claimNumber: string; tripId: number }> = [];
      const errors: Array<{ tripId: number; error: string }> = [];

      // Build claim inputs
      const claimInputs: EDI837ClaimInput[] = [];

      for (const row of tripRows) {
        const { trip, patient } = row;

        if (!patient.medicaidId) {
          errors.push({ tripId: trip.id, error: "Patient has no Medicaid ID" });
          continue;
        }

        const miles = trip.distanceMiles ? parseFloat(trip.distanceMiles) : 0;
        const hcpcsCode = getHcpcsCode(trip.serviceType || "STANDARD");
        const claimNumber = generateClaimNumber();

        // Estimate amount (base rate placeholder - in production this would come from rate tables)
        const baseAmountCents = trip.priceTotalCents || 2500; // default $25 base

        const claimInput: EDI837ClaimInput = {
          claimNumber,
          tripId: trip.id,
          totalAmountCents: baseAmountCents,
          placeOfService: "41", // Ambulance - Land
          diagnosisCodes: providerInput.diagnosisCode ? [providerInput.diagnosisCode] : undefined,
          priorAuthNumber: providerInput.priorAuthNumber,
          serviceLines: [
            {
              hcpcsCode,
              amountCents: baseAmountCents,
              units: 1,
              serviceDate: trip.scheduledDate,
              placeOfService: "41",
            },
          ],
          patient: {
            memberId: patient.medicaidId,
            firstName: patient.firstName,
            lastName: patient.lastName,
            dateOfBirth: patient.dateOfBirth || "1970-01-01",
            gender: "U",
            addressLine1: patient.addressStreet || patient.address || "UNKNOWN",
            city: patient.addressCity || "UNKNOWN",
            state: patient.addressState || "XX",
            zip: patient.addressZip || "00000",
          },
          provider,
          payer,
          pickupAddress: trip.pickupAddress,
          pickupCity: trip.pickupCity || undefined,
          pickupState: trip.pickupState || undefined,
          pickupZip: trip.pickupZip || undefined,
          dropoffAddress: trip.dropoffAddress,
          dropoffCity: trip.dropoffCity || undefined,
          dropoffState: trip.dropoffState || undefined,
          dropoffZip: trip.dropoffZip || undefined,
          mileage: miles,
        };

        claimInputs.push(claimInput);
      }

      if (claimInputs.length === 0) {
        return res.status(400).json({
          message: "No eligible trips for EDI generation",
          errors,
        });
      }

      // Generate EDI content (batch or individual)
      if (claimInputs.length > 1) {
        const batch = generateEDI837Batch(claimInputs);

        // Store each claim individually with the batch EDI content
        for (const claimInput of claimInputs) {
          try {
            const singleEdi = generateEDI837Claim(claimInput);

            const [inserted] = await db
              .insert(ediClaims)
              .values({
                tripId: claimInput.tripId,
                companyId: tenantId,
                claimNumber: claimInput.claimNumber,
                ediContent: singleEdi,
                status: "GENERATED",
              })
              .returning();

            // Record event
            await db.insert(ediClaimEvents).values({
              claimId: inserted.id,
              eventType: "GENERATED",
              description: `EDI 837P claim generated for trip ${claimInput.tripId}`,
              rawData: {
                hcpcsCode: claimInput.serviceLines[0]?.hcpcsCode,
                amountCents: claimInput.totalAmountCents,
                mileage: claimInput.mileage,
              },
            });

            generated.push({
              id: inserted.id,
              claimNumber: claimInput.claimNumber,
              tripId: claimInput.tripId,
            });
          } catch (err: any) {
            errors.push({ tripId: claimInput.tripId, error: err.message });
          }
        }

        return res.status(201).json({
          generated: generated.length,
          failed: errors.length,
          claims: generated,
          errors,
          batchEdiContent: batch.ediContent,
        });
      } else {
        // Single claim
        const claimInput = claimInputs[0];
        const ediContent = generateEDI837Claim(claimInput);

        const [inserted] = await db
          .insert(ediClaims)
          .values({
            tripId: claimInput.tripId,
            companyId: tenantId,
            claimNumber: claimInput.claimNumber,
            ediContent,
            status: "GENERATED",
          })
          .returning();

        await db.insert(ediClaimEvents).values({
          claimId: inserted.id,
          eventType: "GENERATED",
          description: `EDI 837P claim generated for trip ${claimInput.tripId}`,
          rawData: {
            hcpcsCode: claimInput.serviceLines[0]?.hcpcsCode,
            amountCents: claimInput.totalAmountCents,
            mileage: claimInput.mileage,
          },
        });

        return res.status(201).json({
          generated: 1,
          failed: errors.length,
          claims: [{
            id: inserted.id,
            claimNumber: claimInput.claimNumber,
            tripId: claimInput.tripId,
          }],
          errors,
          ediContent,
        });
      }
    } catch (err: any) {
      console.error("[EDI] Error generating claims:", err.message);
      res.status(500).json({ message: err.message });
    }
  },
);

// ─── GET /api/edi/claims ─────────────────────────────────────────────────────
// List EDI claims with filtering

router.get(
  "/api/edi/claims",
  authMiddleware,
  requirePermission("billing", "write"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ message: "Company context required" });
      }

      const { status, startDate, endDate, page, limit: limitStr } = req.query;
      const pageNum = Math.max(1, parseInt(String(page || "1"), 10));
      const limitNum = Math.min(200, Math.max(1, parseInt(String(limitStr || "50"), 10)));
      const offset = (pageNum - 1) * limitNum;

      const conditions = [eq(ediClaims.companyId, tenantId)];

      if (status && typeof status === "string") {
        conditions.push(eq(ediClaims.status, status as any));
      }
      if (startDate && typeof startDate === "string") {
        conditions.push(gte(ediClaims.createdAt, new Date(startDate)));
      }
      if (endDate && typeof endDate === "string") {
        conditions.push(lte(ediClaims.createdAt, new Date(endDate)));
      }

      const [claimRows, countResult] = await Promise.all([
        db
          .select({
            claim: ediClaims,
            tripPublicId: trips.publicId,
            tripScheduledDate: trips.scheduledDate,
            patientFirstName: patients.firstName,
            patientLastName: patients.lastName,
          })
          .from(ediClaims)
          .leftJoin(trips, eq(trips.id, ediClaims.tripId))
          .leftJoin(patients, eq(patients.id, trips.patientId))
          .where(and(...conditions))
          .orderBy(desc(ediClaims.createdAt))
          .limit(limitNum)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(ediClaims)
          .where(and(...conditions)),
      ]);

      res.json({
        claims: claimRows.map((row) => ({
          ...row.claim,
          tripPublicId: row.tripPublicId,
          tripScheduledDate: row.tripScheduledDate,
          patientName: row.patientFirstName
            ? `${row.patientFirstName} ${row.patientLastName}`
            : null,
        })),
        total: countResult[0]?.count || 0,
        page: pageNum,
        limit: limitNum,
      });
    } catch (err: any) {
      console.error("[EDI] Error listing claims:", err.message);
      res.status(500).json({ message: "Failed to list EDI claims" });
    }
  },
);

// ─── GET /api/edi/claims/:id ─────────────────────────────────────────────────
// Claim detail with events

router.get(
  "/api/edi/claims/:id",
  authMiddleware,
  requirePermission("billing", "write"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const claimId = parseInt(String(req.params.id), 10);

      if (isNaN(claimId)) {
        return res.status(400).json({ message: "Invalid claim ID" });
      }

      const conditions = [eq(ediClaims.id, claimId)];
      if (tenantId) {
        conditions.push(eq(ediClaims.companyId, tenantId));
      }

      const [row] = await db
        .select({
          claim: ediClaims,
          tripPublicId: trips.publicId,
          tripPickupAddress: trips.pickupAddress,
          tripDropoffAddress: trips.dropoffAddress,
          tripScheduledDate: trips.scheduledDate,
          patientFirstName: patients.firstName,
          patientLastName: patients.lastName,
          patientMedicaidId: patients.medicaidId,
        })
        .from(ediClaims)
        .leftJoin(trips, eq(trips.id, ediClaims.tripId))
        .leftJoin(patients, eq(patients.id, trips.patientId))
        .where(and(...conditions))
        .limit(1);

      if (!row) {
        return res.status(404).json({ message: "EDI claim not found" });
      }

      // Fetch events
      const events = await db
        .select()
        .from(ediClaimEvents)
        .where(eq(ediClaimEvents.claimId, claimId))
        .orderBy(desc(ediClaimEvents.createdAt));

      res.json({
        ...row.claim,
        tripPublicId: row.tripPublicId,
        tripPickupAddress: row.tripPickupAddress,
        tripDropoffAddress: row.tripDropoffAddress,
        tripScheduledDate: row.tripScheduledDate,
        patientName: row.patientFirstName
          ? `${row.patientFirstName} ${row.patientLastName}`
          : null,
        patientMedicaidId: row.patientMedicaidId,
        events,
      });
    } catch (err: any) {
      console.error("[EDI] Error fetching claim:", err.message);
      res.status(500).json({ message: "Failed to fetch EDI claim" });
    }
  },
);

// ─── POST /api/edi/claims/:id/submit ─────────────────────────────────────────
// Mark claim as submitted (actual submission would go to clearinghouse)

router.post(
  "/api/edi/claims/:id/submit",
  authMiddleware,
  requirePermission("billing", "write"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      const claimId = parseInt(String(req.params.id), 10);

      if (isNaN(claimId)) {
        return res.status(400).json({ message: "Invalid claim ID" });
      }

      const conditions = [eq(ediClaims.id, claimId)];
      if (tenantId) {
        conditions.push(eq(ediClaims.companyId, tenantId));
      }

      const [claim] = await db
        .select()
        .from(ediClaims)
        .where(and(...conditions))
        .limit(1);

      if (!claim) {
        return res.status(404).json({ message: "EDI claim not found" });
      }

      if (claim.status !== "GENERATED") {
        return res.status(400).json({
          message: `Cannot submit claim in '${claim.status}' status. Only GENERATED claims can be submitted.`,
        });
      }

      const [updated] = await db
        .update(ediClaims)
        .set({
          status: "SUBMITTED",
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(ediClaims.id, claimId))
        .returning();

      await db.insert(ediClaimEvents).values({
        claimId,
        eventType: "SUBMITTED",
        description: "Claim marked as submitted to clearinghouse",
      });

      res.json(updated);
    } catch (err: any) {
      console.error("[EDI] Error submitting claim:", err.message);
      res.status(500).json({ message: "Failed to submit claim" });
    }
  },
);

// ─── POST /api/edi/remittance/parse ──────────────────────────────────────────
// Upload and parse an EDI 835 response

router.post(
  "/api/edi/remittance/parse",
  authMiddleware,
  requirePermission("billing", "write"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ message: "Company context required" });
      }

      const { ediContent } = req.body;
      if (!ediContent || typeof ediContent !== "string") {
        return res.status(400).json({
          message: "ediContent (string) is required in request body",
        });
      }

      const parsed = parseEDI835(ediContent);

      if (parsed.claims.length === 0) {
        return res.status(400).json({
          message: "No claims found in EDI 835 content",
          warnings: parsed.warnings,
        });
      }

      // Match parsed claims to our EDI claims and update statuses
      let matched = 0;
      let unmatched = 0;
      const matchedClaims: Array<{
        claimNumber: string;
        status: string;
        paidCents: number;
        adjustmentCents: number;
      }> = [];

      for (const parsedClaim of parsed.claims) {
        const [existing] = await db
          .select()
          .from(ediClaims)
          .where(
            and(
              eq(ediClaims.claimNumber, parsedClaim.claimNumber),
              eq(ediClaims.companyId, tenantId),
            ),
          )
          .limit(1);

        if (!existing) {
          unmatched++;
          continue;
        }

        // Determine new status
        let newStatus: "ACCEPTED" | "REJECTED" | "PAID" | "DENIED";
        switch (parsedClaim.status) {
          case "paid":
            newStatus = "PAID";
            break;
          case "adjusted":
            newStatus = "PAID"; // Partially paid is still PAID
            break;
          case "denied":
            newStatus = "DENIED";
            break;
          case "reversed":
            newStatus = "DENIED";
            break;
          default:
            newStatus = "ACCEPTED";
        }

        const totalAdjustmentCents = parsedClaim.adjustments.reduce(
          (sum, adj) => sum + adj.amountCents,
          0,
        );

        await db
          .update(ediClaims)
          .set({
            status: newStatus,
            responseContent: JSON.stringify(parsedClaim),
            paymentAmount: parsedClaim.totalPaidCents,
            adjustmentAmount: totalAdjustmentCents,
            adjudicatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(ediClaims.id, existing.id));

        await db.insert(ediClaimEvents).values({
          claimId: existing.id,
          eventType: `REMITTANCE_${newStatus}`,
          description: `Remittance processed: ${newStatus} - paid ${(parsedClaim.totalPaidCents / 100).toFixed(2)}, adjusted ${(totalAdjustmentCents / 100).toFixed(2)}`,
          rawData: parsedClaim as any,
        });

        matched++;
        matchedClaims.push({
          claimNumber: parsedClaim.claimNumber,
          status: newStatus,
          paidCents: parsedClaim.totalPaidCents,
          adjustmentCents: totalAdjustmentCents,
        });
      }

      res.json({
        payerName: parsed.payerName,
        checkNumber: parsed.checkNumber,
        paymentDate: parsed.paymentDate,
        totalPaymentCents: parsed.totalPaymentCents,
        totalClaimsInFile: parsed.claims.length,
        matched,
        unmatched,
        matchedClaims,
        warnings: parsed.warnings,
      });
    } catch (err: any) {
      console.error("[EDI] Error parsing remittance:", err.message);
      res.status(500).json({ message: "Failed to parse remittance" });
    }
  },
);

// ─── GET /api/edi/remittance/summary ─────────────────────────────────────────
// Payment summary / dashboard stats

router.get(
  "/api/edi/remittance/summary",
  authMiddleware,
  requirePermission("billing", "write"),
  requireTenantScope,
  async (req: AuthRequest, res: Response) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ message: "Company context required" });
      }

      const rows = await db
        .select({
          status: ediClaims.status,
          count: sql<number>`count(*)::int`,
          totalPayment: sql<number>`coalesce(sum(${ediClaims.paymentAmount}), 0)::int`,
          totalAdjustment: sql<number>`coalesce(sum(${ediClaims.adjustmentAmount}), 0)::int`,
        })
        .from(ediClaims)
        .where(eq(ediClaims.companyId, tenantId))
        .groupBy(ediClaims.status);

      let totalClaims = 0;
      let generatedCount = 0;
      let submittedCount = 0;
      let acceptedCount = 0;
      let rejectedCount = 0;
      let paidCount = 0;
      let deniedCount = 0;
      let totalPaidCents = 0;
      let totalAdjustedCents = 0;

      for (const row of rows) {
        totalClaims += row.count;
        totalPaidCents += row.totalPayment;
        totalAdjustedCents += row.totalAdjustment;

        switch (row.status) {
          case "GENERATED": generatedCount = row.count; break;
          case "SUBMITTED": submittedCount = row.count; break;
          case "ACCEPTED": acceptedCount = row.count; break;
          case "REJECTED": rejectedCount = row.count; break;
          case "PAID": paidCount = row.count; break;
          case "DENIED": deniedCount = row.count; break;
        }
      }

      res.json({
        totalClaims,
        generatedCount,
        submittedCount,
        acceptedCount,
        rejectedCount,
        paidCount,
        deniedCount,
        totalPaidCents,
        totalAdjustedCents,
        pendingCount: generatedCount + submittedCount + acceptedCount,
      });
    } catch (err: any) {
      console.error("[EDI] Error fetching summary:", err.message);
      res.status(500).json({ message: "Failed to fetch remittance summary" });
    }
  },
);

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerEdiRoutes(app: Express) {
  app.use(router);
}
