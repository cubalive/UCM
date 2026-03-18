/**
 * Medicaid / HCPCS Billing Engine
 *
 * Handles HCPCS code resolution, rate calculation, claim generation,
 * EDI 837P generation, and EDI 835 remittance parsing for NEMT Medicaid billing.
 */

import { randomUUID } from "crypto";
import { db } from "../db";
import {
  trips,
  patients,
  drivers,
  companies,
  medicaidBillingCodes,
  medicaidClaims,
  medicaidRemittance,
  ediClaims,
  ediClaimEvents,
  automationEvents,
  type MedicaidClaim,
  type MedicaidBillingCode,
} from "@shared/schema";
import { eq, and, lte, gte, isNull, or, sql, inArray, between, desc } from "drizzle-orm";
import { createHarnessedTask, registerInterval, type HarnessedTask } from "./schedulerHarness";

// ─── HCPCS Code Resolution ──────────────────────────────────────────────────

/**
 * Maps a trip's mobility requirement + distance to the correct HCPCS code.
 *
 * Key NEMT HCPCS codes:
 *   A0130 = Non-emergency ambulatory transport (most NEMT)
 *   T2003 = Non-emergency wheelchair van
 *   T2005 = Non-emergency stretcher van
 *   S0209 = Wheelchair van (some state Medicaid programs)
 *   A0428 = BLS ambulance (non-emergency)
 *   A0426 = ALS ambulance
 */
export function resolveHcpcsCode(mobilityRequirement: string): string {
  const normalized = (mobilityRequirement || "STANDARD").toUpperCase();

  switch (normalized) {
    case "WHEELCHAIR":
      return "T2003";
    case "STRETCHER":
      return "T2005";
    case "BARIATRIC":
      return "T2003"; // Bariatric typically uses wheelchair van codes
    case "AMBULANCE_BLS":
      return "A0428";
    case "AMBULANCE_ALS":
      return "A0426";
    case "BUS":
    case "STANDARD":
    default:
      return "A0130";
  }
}

/**
 * Determine applicable modifiers based on trip characteristics.
 *   TN = Rural area
 *   UN = 2 patients (shared ride)
 *   UP = 3 patients
 *   UQ = 4+ patients
 *   TR = School-age transport
 */
export function resolveModifiers(trip: {
  pickupZip?: string | null;
  passengerCount?: number;
  sharedPassengerCount?: number;
}): string[] {
  const modifiers: string[] = [];

  const effectivePassengers = trip.sharedPassengerCount ?? trip.passengerCount ?? 1;
  if (effectivePassengers === 2) modifiers.push("UN");
  else if (effectivePassengers === 3) modifiers.push("UP");
  else if (effectivePassengers >= 4) modifiers.push("UQ");

  return modifiers;
}

// ─── Rate Calculation ────────────────────────────────────────────────────────

interface RateResult {
  baseRateCents: number;
  mileageRateCents: number;
  totalCents: number;
  billingCode: MedicaidBillingCode | null;
}

/**
 * Calculate Medicaid reimbursement for a given HCPCS code, mileage, and state.
 * Looks up rate from medicaid_billing_codes table. Falls back to defaults if
 * no matching rate is found.
 */
export async function calculateMedicaidRate(
  hcpcsCode: string,
  miles: number,
  state?: string | null,
  serviceDate?: Date,
): Promise<RateResult> {
  const now = serviceDate ?? new Date();

  // Find the active billing code matching code + state + date range
  const conditions = [
    eq(medicaidBillingCodes.code, hcpcsCode),
    eq(medicaidBillingCodes.active, true),
    lte(medicaidBillingCodes.effectiveFrom, now),
    or(
      isNull(medicaidBillingCodes.effectiveTo),
      gte(medicaidBillingCodes.effectiveTo, now),
    ),
  ];

  if (state) {
    conditions.push(
      or(
        eq(medicaidBillingCodes.state, state),
        isNull(medicaidBillingCodes.state),
      )!,
    );
  }

  const codes = await db
    .select()
    .from(medicaidBillingCodes)
    .where(and(...conditions))
    .orderBy(
      // Prefer state-specific rates over generic
      sql`CASE WHEN ${medicaidBillingCodes.state} IS NOT NULL THEN 0 ELSE 1 END`,
      desc(medicaidBillingCodes.effectiveFrom),
    )
    .limit(1);

  const billingCode = codes[0] ?? null;

  if (!billingCode) {
    // Return zero if no rate configured
    return { baseRateCents: 0, mileageRateCents: 0, totalCents: 0, billingCode: null };
  }

  const baseRateCents = billingCode.baseRateCents;
  const mileageRateCents = Math.round(billingCode.perMileRateCents * Math.max(0, miles));
  const totalCents = baseRateCents + mileageRateCents;

  return { baseRateCents, mileageRateCents, totalCents, billingCode };
}

// ─── Claim Generation ────────────────────────────────────────────────────────

function generateClaimNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = randomUUID().slice(0, 8).toUpperCase();
  return `MCL-${ts}-${rand}`;
}

interface ClaimValidationError {
  field: string;
  message: string;
}

/**
 * Validate a claim has all required fields for submission.
 */
export function validateClaim(claim: Partial<MedicaidClaim>): ClaimValidationError[] {
  const errors: ClaimValidationError[] = [];

  if (!claim.providerNpi) {
    errors.push({ field: "providerNpi", message: "Provider NPI is required" });
  } else if (!/^\d{10}$/.test(claim.providerNpi)) {
    errors.push({ field: "providerNpi", message: "Provider NPI must be 10 digits" });
  }

  if (!claim.patientMedicaidId) {
    errors.push({ field: "patientMedicaidId", message: "Patient Medicaid ID is required" });
  }

  if (!claim.hcpcsCode) {
    errors.push({ field: "hcpcsCode", message: "HCPCS code is required" });
  }

  if (!claim.serviceDate) {
    errors.push({ field: "serviceDate", message: "Service date is required" });
  }

  if (!claim.amountCents || claim.amountCents <= 0) {
    errors.push({ field: "amountCents", message: "Amount must be greater than zero" });
  }

  if (!claim.placeOfService) {
    errors.push({ field: "placeOfService", message: "Place of service code is required" });
  }

  return errors;
}

/**
 * Generate a Medicaid claim from a completed trip.
 * Returns the created claim or throws if the trip is ineligible.
 */
export async function generateMedicaidClaim(
  tripId: number,
  providerNpi: string,
  taxonomyCode?: string,
  priorAuthNumber?: string,
  diagnosisCode?: string,
): Promise<MedicaidClaim> {
  // Fetch trip with patient
  const [trip] = await db
    .select()
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);

  if (!trip) {
    throw new Error(`Trip ${tripId} not found`);
  }

  if (trip.status !== "COMPLETED") {
    throw new Error(`Trip ${tripId} is not completed (status: ${trip.status})`);
  }

  // Check if claim already exists for this trip
  const existingClaim = await db
    .select({ id: medicaidClaims.id })
    .from(medicaidClaims)
    .where(and(eq(medicaidClaims.tripId, tripId), sql`${medicaidClaims.status} != 'void'`))
    .limit(1);

  if (existingClaim.length > 0) {
    throw new Error(`Active claim already exists for trip ${tripId}`);
  }

  // Fetch patient
  const [patient] = await db
    .select()
    .from(patients)
    .where(eq(patients.id, trip.patientId))
    .limit(1);

  if (!patient) {
    throw new Error(`Patient ${trip.patientId} not found`);
  }

  if (!patient.medicaidId) {
    throw new Error(`Patient ${patient.id} has no Medicaid ID`);
  }

  // Resolve HCPCS code and modifiers
  const hcpcsCode = resolveHcpcsCode(trip.mobilityRequirement);
  const modifiers = resolveModifiers(trip);

  // Calculate mileage from trip data
  const miles = trip.distanceMiles ? parseFloat(trip.distanceMiles) : 0;

  // Calculate rate
  const rate = await calculateMedicaidRate(hcpcsCode, miles, patient.medicaidState);

  const claimNumber = generateClaimNumber();

  const [claim] = await db
    .insert(medicaidClaims)
    .values({
      tripId,
      companyId: trip.companyId,
      patientId: trip.patientId,
      claimNumber,
      hcpcsCode,
      modifiers: modifiers.length > 0 ? modifiers : null,
      diagnosisCode: diagnosisCode || null,
      units: 1,
      amountCents: rate.totalCents,
      mileage: miles.toFixed(2),
      pickupZip: trip.pickupZip,
      dropoffZip: trip.dropoffZip,
      serviceDate: trip.scheduledDate,
      patientMedicaidId: patient.medicaidId,
      providerNpi,
      taxonomyCode: taxonomyCode || "343900000X", // Default NEMT taxonomy
      placeOfService: "41", // Ambulance — Land
      priorAuthNumber: priorAuthNumber || null,
      status: "draft",
    })
    .returning();

  return claim;
}

/**
 * Batch generate claims for all eligible completed trips in a date range.
 */
export async function batchGenerateClaims(
  companyId: number,
  startDate: string,
  endDate: string,
  providerNpi: string,
  taxonomyCode?: string,
): Promise<{ generated: number; skipped: number; errors: Array<{ tripId: number; error: string }> }> {
  // Find completed trips in date range that do not already have an active claim
  const eligibleTrips = await db
    .select({
      tripId: trips.id,
    })
    .from(trips)
    .leftJoin(
      medicaidClaims,
      and(
        eq(medicaidClaims.tripId, trips.id),
        sql`${medicaidClaims.status} != 'void'`,
      ),
    )
    .where(
      and(
        eq(trips.companyId, companyId),
        eq(trips.status, "COMPLETED"),
        gte(trips.scheduledDate, startDate),
        lte(trips.scheduledDate, endDate),
        isNull(trips.deletedAt),
        isNull(medicaidClaims.id), // No existing active claim
      ),
    );

  let generated = 0;
  let skipped = 0;
  const errors: Array<{ tripId: number; error: string }> = [];

  for (const row of eligibleTrips) {
    try {
      await generateMedicaidClaim(row.tripId, providerNpi, taxonomyCode);
      generated++;
    } catch (err: any) {
      // If patient has no Medicaid ID, skip silently
      if (err.message?.includes("no Medicaid ID")) {
        skipped++;
      } else {
        errors.push({ tripId: row.tripId, error: err.message });
      }
    }
  }

  return { generated, skipped, errors };
}

// ─── EDI 837P Generation ─────────────────────────────────────────────────────

/**
 * Pad a string to a fixed length, right-padded with spaces or left-padded with zeros.
 */
function padRight(val: string, len: number): string {
  return val.substring(0, len).padEnd(len, " ");
}

function padLeft(val: string, len: number, char = "0"): string {
  return val.substring(0, len).padStart(len, char);
}

function formatCurrency(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatEdiDate(dateStr: string): string {
  // Convert YYYY-MM-DD to YYYYMMDD
  return dateStr.replace(/-/g, "");
}

/**
 * Generate an EDI 837P (Professional) format string for electronic claim submission.
 *
 * This produces a simplified but structurally valid 837P that covers the key
 * segments required for NEMT Medicaid claims.
 */
export async function generateEdi837(claimIds: number[]): Promise<string> {
  if (claimIds.length === 0) {
    throw new Error("No claims provided for EDI generation");
  }

  const claimsData = await db
    .select()
    .from(medicaidClaims)
    .where(inArray(medicaidClaims.id, claimIds));

  if (claimsData.length === 0) {
    throw new Error("No claims found for the given IDs");
  }

  // Fetch company info for the first claim (all claims should be same company)
  const companyId = claimsData[0].companyId;
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);

  // Fetch patient info for all claims
  const patientIds = [...new Set(claimsData.map((c) => c.patientId))];
  const patientsData = await db
    .select()
    .from(patients)
    .where(inArray(patients.id, patientIds));

  const patientMap = new Map(patientsData.map((p) => [p.id, p]));

  const segments: string[] = [];
  const now = new Date();
  const controlNumber = now.getTime().toString().slice(-9);
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timeStamp = now.toISOString().slice(11, 15).replace(":", "");

  // ISA - Interchange Control Header
  segments.push(
    `ISA*00*          *00*          *ZZ*${padRight(claimsData[0].providerNpi, 15)}*ZZ*${padRight("MEDICAID", 15)}*${dateStamp.slice(2)}*${timeStamp}*^*00501*${padLeft(controlNumber, 9)}*0*P*:~`,
  );

  // GS - Functional Group Header
  segments.push(
    `GS*HC*${claimsData[0].providerNpi}*MEDICAID*${dateStamp}*${timeStamp}*${controlNumber}*X*005010X222A1~`,
  );

  // ST - Transaction Set Header
  segments.push(`ST*837*0001*005010X222A1~`);

  // BHT - Beginning of Hierarchical Transaction
  segments.push(
    `BHT*0019*00*${controlNumber}*${dateStamp}*${timeStamp}*CH~`,
  );

  // 1000A - Submitter
  segments.push(`NM1*41*2*${company?.name || "PROVIDER"}*****46*${claimsData[0].providerNpi}~`);
  segments.push(`PER*IC*BILLING*TE*5555555555~`);

  // 1000B - Receiver
  segments.push(`NM1*40*2*MEDICAID*****46*MEDICAID~`);

  // HL - Billing Provider Hierarchical Level
  let hlCounter = 1;
  segments.push(`HL*${hlCounter}**20*1~`);

  // 2010AA - Billing Provider
  segments.push(`NM1*85*2*${company?.name || "PROVIDER"}*****XX*${claimsData[0].providerNpi}~`);
  // Use company data with fallbacks (address/taxId fields not yet on companies table)
  const companyAddress = (company as any)?.address || (company as any)?.addressLine1 || "ADDRESS LINE 1";
  const companyCity = (company as any)?.city || (company as any)?.addressCity || "CITY";
  const companyState = (company as any)?.state || (company as any)?.addressState || "ST";
  const companyZip = (company as any)?.zip || (company as any)?.addressZip || "00000";
  const companyTaxId = (company as any)?.taxId || (company as any)?.ein || "000000000";
  segments.push(`N3*${companyAddress}~`);
  segments.push(`N4*${companyCity}*${companyState}*${companyZip}~`);
  segments.push(`REF*EI*${companyTaxId}~`);

  // For each claim, generate subscriber and claim loops
  for (const claim of claimsData) {
    const patient = patientMap.get(claim.patientId);

    // HL - Subscriber
    hlCounter++;
    segments.push(`HL*${hlCounter}*1*22*0~`);
    segments.push(`SBR*P*18*******MC~`);

    // 2010BA - Subscriber Name (Patient)
    segments.push(
      `NM1*IL*1*${patient?.lastName || "UNKNOWN"}*${patient?.firstName || "UNKNOWN"}*****MI*${claim.patientMedicaidId}~`,
    );
    segments.push(`N3*${patient?.addressStreet || patient?.address || "UNKNOWN"}~`);
    segments.push(
      `N4*${patient?.addressCity || "UNKNOWN"}*${patient?.addressState || "XX"}*${patient?.addressZip || "00000"}~`,
    );
    segments.push(`DMG*D8*${patient?.dateOfBirth ? formatEdiDate(patient.dateOfBirth) : "19700101"}*U~`);

    // 2010BB - Payer
    segments.push(`NM1*PR*2*MEDICAID*****PI*MEDICAID~`);

    // 2300 - Claim Information
    segments.push(
      `CLM*${claim.claimNumber}*${formatCurrency(claim.amountCents)}***${claim.placeOfService}:B:1*Y*A*Y*Y~`,
    );

    // Prior auth if present
    if (claim.priorAuthNumber) {
      segments.push(`REF*G1*${claim.priorAuthNumber}~`);
    }

    // Diagnosis code
    if (claim.diagnosisCode) {
      segments.push(`HI*ABK:${claim.diagnosisCode}~`);
    }

    // 2400 - Service Line
    const modStr = claim.modifiers?.length ? ":" + claim.modifiers.join(":") : "";
    segments.push(
      `SV1*HC:${claim.hcpcsCode}${modStr}*${formatCurrency(claim.amountCents)}*UN*${claim.units}***1~`,
    );
    segments.push(`DTP*472*D8*${formatEdiDate(claim.serviceDate)}~`);

    // Mileage segment for transportation claims
    if (claim.mileage) {
      const mileageValue = parseFloat(claim.mileage);
      if (mileageValue > 0) {
        segments.push(`SV1*HC:A0425*${formatCurrency(0)}*UN*${Math.ceil(mileageValue)}***1~`);
        segments.push(`DTP*472*D8*${formatEdiDate(claim.serviceDate)}~`);
      }
    }
  }

  // SE - Transaction Set Trailer
  const segmentCount = segments.length + 1; // +1 for SE itself
  segments.push(`SE*${segmentCount}*0001~`);

  // GE - Functional Group Trailer
  segments.push(`GE*1*${controlNumber}~`);

  // IEA - Interchange Control Trailer
  segments.push(`IEA*1*${padLeft(controlNumber, 9)}~`);

  return segments.join("\n");
}

// ─── EDI 835 Remittance Parsing ──────────────────────────────────────────────

export interface ParsedRemittance {
  checkNumber: string | null;
  paymentDate: string | null;
  payerName: string | null;
  claims: Array<{
    claimNumber: string;
    amountPaidCents: number;
    amountChargedCents: number;
    adjustmentCodes: Array<{ group: string; reason: string; amountCents: number }>;
    remarkCodes: string[];
    status: "paid" | "rejected";
  }>;
}

/**
 * Parse an EDI 835 (Remittance Advice) for payment posting.
 */
export function parseEdi835(ediContent: string): ParsedRemittance {
  const result: ParsedRemittance = {
    checkNumber: null,
    paymentDate: null,
    payerName: null,
    claims: [],
  };

  // Normalize line endings and split into segments
  const normalized = ediContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Detect segment terminator (~ is standard)
  const rawSegments = normalized.split("~").map((s) => s.trim()).filter(Boolean);

  let currentClaim: ParsedRemittance["claims"][0] | null = null;

  for (const segment of rawSegments) {
    const elements = segment.split("*");
    const segId = elements[0];

    switch (segId) {
      case "BPR": {
        // Payment/Remittance info
        // BPR*I*amount*C*...*date
        if (elements.length > 16) {
          result.paymentDate = formatDateFrom835(elements[16]);
        }
        break;
      }

      case "TRN": {
        // Check/EFT trace number
        // TRN*1*check_number*...
        if (elements.length > 2) {
          result.checkNumber = elements[2];
        }
        break;
      }

      case "N1": {
        // Payer identification
        // N1*PR*payer_name
        if (elements[1] === "PR" && elements.length > 2) {
          result.payerName = elements[2];
        }
        break;
      }

      case "CLP": {
        // Claim-level info
        // CLP*claim_number*status*charged*paid*...
        if (currentClaim) {
          result.claims.push(currentClaim);
        }
        const chargedCents = Math.round(parseFloat(elements[3] || "0") * 100);
        const paidCents = Math.round(parseFloat(elements[4] || "0") * 100);
        const claimStatus = elements[2]; // 1=processed, 2=denied, etc.
        currentClaim = {
          claimNumber: elements[1] || "",
          amountChargedCents: chargedCents,
          amountPaidCents: paidCents,
          adjustmentCodes: [],
          remarkCodes: [],
          status: claimStatus === "4" || claimStatus === "22" ? "rejected" : "paid",
        };
        break;
      }

      case "CAS": {
        // Claim adjustment
        // CAS*group*reason*amount*quantity*reason2*amount2...
        if (currentClaim && elements.length >= 4) {
          const group = elements[1];
          // Process adjustment reason/amount pairs (positions 2-3, 5-6, 8-9, etc.)
          for (let i = 2; i < elements.length - 1; i += 3) {
            const reason = elements[i];
            const amount = elements[i + 1];
            if (reason && amount) {
              currentClaim.adjustmentCodes.push({
                group,
                reason,
                amountCents: Math.round(parseFloat(amount) * 100),
              });
            }
          }
        }
        break;
      }

      case "MOA": {
        // Remark codes
        // MOA*...*remark1*remark2*...
        if (currentClaim) {
          for (let i = 1; i < elements.length; i++) {
            const code = elements[i]?.trim();
            if (code) {
              currentClaim.remarkCodes.push(code);
            }
          }
        }
        break;
      }
    }
  }

  // Push last claim
  if (currentClaim) {
    result.claims.push(currentClaim);
  }

  return result;
}

function formatDateFrom835(dateStr: string): string {
  if (!dateStr || dateStr.length !== 8) return dateStr;
  return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
}

/**
 * Import parsed 835 remittance data, creating remittance records and
 * updating claim statuses.
 */
export async function importRemittance(
  parsed: ParsedRemittance,
  companyId: number,
): Promise<{ matched: number; unmatched: number; errors: string[] }> {
  let matched = 0;
  let unmatched = 0;
  const errors: string[] = [];

  for (const remitClaim of parsed.claims) {
    // Find matching claim
    const [existing] = await db
      .select()
      .from(medicaidClaims)
      .where(
        and(
          eq(medicaidClaims.claimNumber, remitClaim.claimNumber),
          eq(medicaidClaims.companyId, companyId),
        ),
      )
      .limit(1);

    if (!existing) {
      unmatched++;
      continue;
    }

    try {
      // Create remittance record
      await db.insert(medicaidRemittance).values({
        claimId: existing.id,
        paymentDate: parsed.paymentDate || new Date().toISOString().slice(0, 10),
        checkNumber: parsed.checkNumber,
        amountPaidCents: remitClaim.amountPaidCents,
        adjustmentCodes: remitClaim.adjustmentCodes,
        remarkCodes: remitClaim.remarkCodes.length > 0 ? remitClaim.remarkCodes : null,
      });

      // Update claim status
      const newStatus = remitClaim.status === "rejected" ? "rejected" as const : "paid" as const;
      const denialInfo =
        remitClaim.status === "rejected"
          ? {
              denialReasonCode: remitClaim.adjustmentCodes[0]?.reason || null,
              denialReason: remitClaim.adjustmentCodes
                .map((a) => `${a.group}-${a.reason}`)
                .join(", ") || null,
            }
          : {};

      await db
        .update(medicaidClaims)
        .set({
          status: newStatus,
          paidAmountCents: remitClaim.amountPaidCents,
          adjudicatedAt: new Date(),
          updatedAt: new Date(),
          ...denialInfo,
        })
        .where(eq(medicaidClaims.id, existing.id));

      matched++;
    } catch (err: any) {
      errors.push(`Claim ${remitClaim.claimNumber}: ${err.message}`);
    }
  }

  return { matched, unmatched, errors };
}

// ─── Dashboard Stats ─────────────────────────────────────────────────────────

export interface MedicaidDashboardStats {
  totalClaims: number;
  draftCount: number;
  submittedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  paidCount: number;
  voidCount: number;
  totalBilledCents: number;
  totalPaidCents: number;
  totalOutstandingCents: number;
}

export async function getMedicaidDashboardStats(
  companyId: number,
  startDate?: string,
  endDate?: string,
): Promise<MedicaidDashboardStats> {
  const conditions = [eq(medicaidClaims.companyId, companyId)];

  if (startDate) {
    conditions.push(gte(medicaidClaims.serviceDate, startDate));
  }
  if (endDate) {
    conditions.push(lte(medicaidClaims.serviceDate, endDate));
  }

  const rows = await db
    .select({
      status: medicaidClaims.status,
      count: sql<number>`count(*)::int`,
      totalBilled: sql<number>`coalesce(sum(${medicaidClaims.amountCents}), 0)::int`,
      totalPaid: sql<number>`coalesce(sum(${medicaidClaims.paidAmountCents}), 0)::int`,
    })
    .from(medicaidClaims)
    .where(and(...conditions))
    .groupBy(medicaidClaims.status);

  const stats: MedicaidDashboardStats = {
    totalClaims: 0,
    draftCount: 0,
    submittedCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    paidCount: 0,
    voidCount: 0,
    totalBilledCents: 0,
    totalPaidCents: 0,
    totalOutstandingCents: 0,
  };

  for (const row of rows) {
    stats.totalClaims += row.count;
    stats.totalBilledCents += row.totalBilled;
    stats.totalPaidCents += row.totalPaid;

    switch (row.status) {
      case "draft":
        stats.draftCount = row.count;
        break;
      case "submitted":
        stats.submittedCount = row.count;
        break;
      case "accepted":
        stats.acceptedCount = row.count;
        break;
      case "rejected":
        stats.rejectedCount = row.count;
        break;
      case "paid":
        stats.paidCount = row.count;
        break;
      case "void":
        stats.voidCount = row.count;
        break;
    }
  }

  stats.totalOutstandingCents =
    stats.totalBilledCents - stats.totalPaidCents;

  return stats;
}

// ─── Medicaid Claim Auto-Submission ──────────────────────────────────────────

const AUTO_SUBMIT_INTERVAL_MS = 30 * 60_000; // Every 30 minutes

/**
 * Auto-submit all pending Medicaid claims (status "draft") for a given company.
 * Validates each claim before transitioning to "submitted".
 * Also processes EDI claims in "GENERATED" status -> "SUBMITTED".
 *
 * Returns counts of submitted, skipped (validation failures), and errored claims.
 */
export async function autoSubmitPendingClaims(
  companyId: number,
): Promise<{ medicaidSubmitted: number; ediSubmitted: number; skipped: number; errors: string[] }> {
  let medicaidSubmitted = 0;
  let ediSubmitted = 0;
  let skipped = 0;
  const errors: string[] = [];

  // ── 1. Process Medicaid claims in "draft" status ──
  const draftClaims = await db
    .select()
    .from(medicaidClaims)
    .where(
      and(
        eq(medicaidClaims.companyId, companyId),
        eq(medicaidClaims.status, "draft"),
      ),
    );

  for (const claim of draftClaims) {
    try {
      // Validate the claim before submission
      const validationErrors = validateClaim(claim);
      if (validationErrors.length > 0) {
        skipped++;
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

      // Log the auto-submission event
      await db.insert(automationEvents).values({
        eventType: "MEDICAID_CLAIM_AUTO_SUBMITTED",
        companyId,
        payload: {
          claimId: claim.id,
          claimNumber: claim.claimNumber,
          tripId: claim.tripId,
          amountCents: claim.amountCents,
          hcpcsCode: claim.hcpcsCode,
        },
      });

      // Deliver claim.submitted webhook to broker if claim has a brokerId
      if (claim.brokerId) {
        try {
          const { deliverWebhook } = await import("./brokerWebhookEngine");
          await deliverWebhook(claim.brokerId, "claim.submitted", {
            claimId: claim.id,
            claimNumber: claim.claimNumber,
            tripId: claim.tripId,
            amountCents: claim.amountCents,
            hcpcsCode: claim.hcpcsCode,
            serviceDate: claim.serviceDate,
            submittedAt: new Date().toISOString(),
          }).catch((err: any) => { if (err) console.error("[CATCH]", err.message || err); });
        } catch {}
      }

      medicaidSubmitted++;
    } catch (err: any) {
      errors.push(`Medicaid claim ${claim.claimNumber}: ${err.message}`);
    }
  }

  // ── 2. Process EDI claims in "GENERATED" status ──
  const generatedEdiClaims = await db
    .select()
    .from(ediClaims)
    .where(
      and(
        eq(ediClaims.companyId, companyId),
        eq(ediClaims.status, "GENERATED"),
      ),
    );

  for (const claim of generatedEdiClaims) {
    try {
      await db
        .update(ediClaims)
        .set({
          status: "SUBMITTED",
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(ediClaims.id, claim.id));

      // Record EDI claim event
      await db.insert(ediClaimEvents).values({
        claimId: claim.id,
        eventType: "AUTO_SUBMITTED",
        description: `Claim auto-submitted by Medicaid auto-submit scheduler`,
      });

      // Log the auto-submission event
      await db.insert(automationEvents).values({
        eventType: "EDI_CLAIM_AUTO_SUBMITTED",
        companyId,
        payload: {
          ediClaimId: claim.id,
          claimNumber: claim.claimNumber,
          tripId: claim.tripId,
        },
      });

      // Deliver claim.submitted webhook to broker if trip has a broker link
      try {
        if (claim.tripId) {
          const { brokerTripRequests } = await import("@shared/schema");
          const { eq: eqOp } = await import("drizzle-orm");
          const [brokerReq] = await db.select({ brokerId: brokerTripRequests.brokerId })
            .from(brokerTripRequests)
            .where(eqOp(brokerTripRequests.tripId, claim.tripId))
            .limit(1);
          if (brokerReq?.brokerId) {
            const { deliverWebhook } = await import("./brokerWebhookEngine");
            await deliverWebhook(brokerReq.brokerId, "claim.submitted", {
              ediClaimId: claim.id,
              claimNumber: claim.claimNumber,
              tripId: claim.tripId,
              submittedAt: new Date().toISOString(),
            }).catch((err: any) => { if (err) console.error("[CATCH]", err.message || err); });
          }
        }
      } catch {}

      ediSubmitted++;
    } catch (err: any) {
      errors.push(`EDI claim ${claim.claimNumber}: ${err.message}`);
    }
  }

  return { medicaidSubmitted, ediSubmitted, skipped, errors };
}

/**
 * Run a single cycle of the auto-submit scheduler.
 * Finds all companies and processes their pending claims.
 * Companies opt-in via the `medicaidAutoSubmit` setting stored in company settings
 * (checked as a JSON field on the companies table or a dedicated flag).
 * For now, any company that has at least one Medicaid or EDI claim is considered eligible.
 */
async function runAutoSubmitCycle(): Promise<void> {
  // Find companies that have pending claims (draft Medicaid or GENERATED EDI)
  const companiesWithDraftMedicaid = await db
    .selectDistinct({ companyId: medicaidClaims.companyId })
    .from(medicaidClaims)
    .where(eq(medicaidClaims.status, "draft"));

  const companiesWithGeneratedEdi = await db
    .selectDistinct({ companyId: ediClaims.companyId })
    .from(ediClaims)
    .where(eq(ediClaims.status, "GENERATED"));

  // Merge unique company IDs
  const companyIdSet = new Set<number>();
  for (const row of companiesWithDraftMedicaid) {
    companyIdSet.add(row.companyId);
  }
  for (const row of companiesWithGeneratedEdi) {
    companyIdSet.add(row.companyId);
  }

  if (companyIdSet.size === 0) {
    console.log("[MEDICAID-AUTO-SUBMIT] No companies with pending claims, skipping cycle");
    return;
  }

  let totalMedicaidSubmitted = 0;
  let totalEdiSubmitted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const companyId of companyIdSet) {
    try {
      const result = await autoSubmitPendingClaims(companyId);
      totalMedicaidSubmitted += result.medicaidSubmitted;
      totalEdiSubmitted += result.ediSubmitted;
      totalSkipped += result.skipped;
      totalErrors += result.errors.length;

      if (result.errors.length > 0) {
        console.warn(
          `[MEDICAID-AUTO-SUBMIT] Company ${companyId} had ${result.errors.length} errors:`,
          result.errors.slice(0, 5),
        );
      }
    } catch (err: any) {
      totalErrors++;
      console.error(
        `[MEDICAID-AUTO-SUBMIT] Failed processing company ${companyId}: ${err.message}`,
      );
    }
  }

  console.log(
    JSON.stringify({
      event: "medicaid_auto_submit_cycle_complete",
      companiesProcessed: companyIdSet.size,
      medicaidSubmitted: totalMedicaidSubmitted,
      ediSubmitted: totalEdiSubmitted,
      skipped: totalSkipped,
      errors: totalErrors,
      ts: new Date().toISOString(),
    }),
  );
}

// ─── Scheduler Registration ──────────────────────────────────────────────────

let autoSubmitTask: HarnessedTask | null = null;

export function startMedicaidAutoSubmitScheduler(): void {
  if (autoSubmitTask) return;

  autoSubmitTask = createHarnessedTask({
    name: "medicaid_auto_submit",
    lockKey: "scheduler:lock:medicaid_auto_submit",
    lockTtlSeconds: 120,
    timeoutMs: 300_000,
    fn: runAutoSubmitCycle,
  });

  registerInterval("medicaid_auto_submit", AUTO_SUBMIT_INTERVAL_MS, autoSubmitTask);
  console.log("[MEDICAID-AUTO-SUBMIT] Scheduler started (interval: 30min)");
}
