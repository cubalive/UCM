/**
 * SureScripts / NCPDP e-Rx Integration Engine
 *
 * Handles incoming electronic prescriptions via NCPDP SCRIPT standard,
 * validates prescriptions against the SureScripts network, and syncs
 * them into the pharmacy_prescriptions table.
 *
 * Integration modes:
 *   - Webhook receiver: POST /api/pharmacy/erx/incoming for SureScripts NewRx messages
 *   - Verification: Validate prescriber DEA/NPI against SureScripts directory
 *   - Status polling: Check e-Rx message status with SureScripts
 */
import { db } from "../db";
import { pharmacyPrescriptions, pharmacies } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NCPDPNewRxMessage {
  messageId: string;
  version: string; // e.g. "10.6" for NCPDP SCRIPT v10.6
  prescriberOrderNumber: string;
  writtenDate: string; // YYYY-MM-DD
  medication: {
    drugDescription: string;
    productCode: string; // NDC
    productCodeQualifier: "ND"; // NDC qualifier
    strength?: string;
    dosageForm?: string;
    deaSchedule?: string; // "CII" | "CIII" | "CIV" | "CV"
  };
  quantity: {
    value: number;
    codeListQualifier: string; // "EA" (each), "ML", etc.
    unitOfMeasure: string;
  };
  directions: string; // SIG
  refills: {
    qualifier: "R"; // refill
    value: number;
  };
  prescriber: {
    lastName: string;
    firstName: string;
    npi: string;
    deaNumber?: string;
    stateLicenseNumber?: string;
    phone?: string;
    address?: {
      line1: string;
      city: string;
      state: string;
      zip: string;
    };
  };
  patient: {
    lastName: string;
    firstName: string;
    dateOfBirth: string; // YYYY-MM-DD
    gender: string;
    address?: {
      line1: string;
      city: string;
      state: string;
      zip: string;
    };
    phone?: string;
  };
  pharmacy: {
    ncpdpId: string; // NCPDP Provider ID (7-digit)
    npi?: string;
    storeName?: string;
  };
}

export interface ERxProcessResult {
  success: boolean;
  prescriptionId?: number;
  rxNumber?: string;
  error?: string;
  validationWarnings?: string[];
}

export interface PrescriberVerification {
  valid: boolean;
  npi: string;
  deaNumber?: string;
  name?: string;
  error?: string;
}

// ─── SureScripts API Configuration ──────────────────────────────────────────

const SURESCRIPTS_API_URL = process.env.SURESCRIPTS_API_URL || "";
const SURESCRIPTS_API_KEY = process.env.SURESCRIPTS_API_KEY || "";
const SURESCRIPTS_PARTNER_ID = process.env.SURESCRIPTS_PARTNER_ID || "";
const SURESCRIPTS_WEBHOOK_SECRET = process.env.SURESCRIPTS_WEBHOOK_SECRET || "";

function isSureScriptsConfigured(): boolean {
  return !!(SURESCRIPTS_API_URL && SURESCRIPTS_API_KEY);
}

// ─── Webhook Signature Verification ─────────────────────────────────────────

export function verifyWebhookSignature(
  payload: string,
  signature: string,
): boolean {
  if (!SURESCRIPTS_WEBHOOK_SECRET) return false;
  const expected = createHmac("sha256", SURESCRIPTS_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}

// ─── NCPDP NewRx Message Processing ────────────────────────────────────────

/**
 * Process an incoming NCPDP NewRx message and create a pharmacy prescription.
 */
export async function processNewRxMessage(
  pharmacyId: number,
  message: NCPDPNewRxMessage,
): Promise<ERxProcessResult> {
  const warnings: string[] = [];

  // Validate required fields
  if (!message.medication?.drugDescription) {
    return { success: false, error: "Missing medication drug description" };
  }
  if (!message.patient?.lastName || !message.patient?.firstName) {
    return { success: false, error: "Missing patient name" };
  }
  if (!message.prescriberOrderNumber) {
    return { success: false, error: "Missing prescriber order number" };
  }

  // Verify pharmacy exists
  const [pharmacy] = await db
    .select()
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1);
  if (!pharmacy) {
    return { success: false, error: "Pharmacy not found" };
  }

  // Check for duplicate Rx
  const rxNumber = `ERX-${message.prescriberOrderNumber}`;
  const [existing] = await db
    .select({ id: pharmacyPrescriptions.id })
    .from(pharmacyPrescriptions)
    .where(
      and(
        eq(pharmacyPrescriptions.pharmacyId, pharmacyId),
        eq(pharmacyPrescriptions.rxNumber, rxNumber),
      ),
    )
    .limit(1);

  if (existing) {
    return {
      success: false,
      error: `Duplicate prescription: ${rxNumber} already exists`,
    };
  }

  // Determine controlled substance status
  const deaSchedule = message.medication.deaSchedule || null;
  const isControlled = !!deaSchedule;

  // Map NCPDP unit qualifier to our unit system
  const unitMap: Record<string, string> = {
    EA: "each",
    ML: "ml",
    C48542: "tablet",
    C48480: "capsule",
    C28254: "ml",
    C48491: "bottle",
  };
  const unit =
    unitMap[message.quantity?.codeListQualifier || ""] ||
    message.quantity?.unitOfMeasure ||
    "each";

  // Build prescriber name
  const prescriberName = [
    message.prescriber?.firstName,
    message.prescriber?.lastName,
  ]
    .filter(Boolean)
    .join(" ");
  const prescriberDisplay = prescriberName
    ? `Dr. ${prescriberName}`
    : null;

  // Verify prescriber if SureScripts is configured
  if (isSureScriptsConfigured() && message.prescriber?.npi) {
    const verification = await verifyPrescriber(message.prescriber.npi);
    if (!verification.valid) {
      warnings.push(
        `Prescriber NPI ${message.prescriber.npi} verification failed: ${verification.error || "unknown"}`,
      );
    }
  }

  // Validate DEA number for controlled substances
  if (isControlled && !message.prescriber?.deaNumber) {
    warnings.push(
      "Controlled substance prescribed without DEA number — requires manual verification",
    );
  }

  const patientName = `${message.patient.firstName} ${message.patient.lastName}`;

  // Insert prescription
  const [rx] = await db
    .insert(pharmacyPrescriptions)
    .values({
      pharmacyId,
      rxNumber,
      medicationName: message.medication.drugDescription,
      ndc: message.medication.productCode || null,
      patientName,
      prescriber: prescriberDisplay,
      quantity: message.quantity?.value || 1,
      unit,
      refillsRemaining: message.refills?.value || 0,
      refillsTotal: message.refills?.value || 0,
      isControlled,
      scheduleClass: deaSchedule,
      validationStatus: isControlled
        ? "PENDING_VERIFICATION"
        : warnings.length > 0
          ? "PENDING_VERIFICATION"
          : "VALID",
    })
    .returning();

  console.log(
    `[eRx] Processed NewRx ${rxNumber} for pharmacy ${pharmacyId}: ${message.medication.drugDescription} for ${patientName}`,
  );

  return {
    success: true,
    prescriptionId: rx.id,
    rxNumber,
    validationWarnings: warnings.length > 0 ? warnings : undefined,
  };
}

// ─── Prescriber Verification via SureScripts Directory ──────────────────────

export async function verifyPrescriber(
  npi: string,
): Promise<PrescriberVerification> {
  if (!isSureScriptsConfigured()) {
    return {
      valid: false,
      npi,
      error: "SureScripts not configured — manual verification required",
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(
      `${SURESCRIPTS_API_URL}/directory/v1/prescribers?npi=${encodeURIComponent(npi)}`,
      {
        headers: {
          Authorization: `Bearer ${SURESCRIPTS_API_KEY}`,
          "X-Partner-Id": SURESCRIPTS_PARTNER_ID,
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    );

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        valid: false,
        npi,
        error: `SureScripts API error: ${response.status}`,
      };
    }

    const data = (await response.json()) as any;
    const prescriber = data?.prescribers?.[0];

    if (!prescriber) {
      return { valid: false, npi, error: "Prescriber not found in directory" };
    }

    return {
      valid: true,
      npi,
      deaNumber: prescriber.deaNumber,
      name: `${prescriber.firstName} ${prescriber.lastName}`,
    };
  } catch (err: any) {
    return {
      valid: false,
      npi,
      error: `Verification failed: ${err.message}`,
    };
  }
}

// ─── Check e-Rx Message Status ──────────────────────────────────────────────

export async function checkMessageStatus(
  messageId: string,
): Promise<{ status: string; details?: string }> {
  if (!isSureScriptsConfigured()) {
    return { status: "unknown", details: "SureScripts not configured" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(
      `${SURESCRIPTS_API_URL}/messaging/v1/status/${encodeURIComponent(messageId)}`,
      {
        headers: {
          Authorization: `Bearer ${SURESCRIPTS_API_KEY}`,
          "X-Partner-Id": SURESCRIPTS_PARTNER_ID,
          Accept: "application/json",
        },
        signal: controller.signal,
      },
    );

    clearTimeout(timeout);

    if (!response.ok) {
      return { status: "error", details: `API returned ${response.status}` };
    }

    const data = (await response.json()) as any;
    return {
      status: data.status || "unknown",
      details: data.statusMessage,
    };
  } catch (err: any) {
    return { status: "error", details: err.message };
  }
}

// ─── Parse NCPDP SCRIPT XML to our message format ──────────────────────────

/**
 * Lightweight parser for NCPDP SCRIPT v10.6 NewRx XML messages.
 * Falls back to JSON if content is not XML.
 */
export function parseNCPDPMessage(
  body: string,
  contentType: string,
): NCPDPNewRxMessage | null {
  // If JSON, assume it's already in our format
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(body) as NCPDPNewRxMessage;
    } catch {
      return null;
    }
  }

  // XML parsing for NCPDP SCRIPT standard
  if (contentType.includes("xml")) {
    try {
      // Simple regex-based extraction for common NCPDP SCRIPT fields
      const extract = (tag: string): string =>
        body.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))?.[1] || "";

      const message: NCPDPNewRxMessage = {
        messageId:
          extract("MessageID") || extract("messageId") || `MSG-${Date.now()}`,
        version: extract("VersionReleaseNumber") || "10.6",
        prescriberOrderNumber:
          extract("PrescriberOrderNumber") ||
          extract("RxReferenceNumber") ||
          `RX-${Date.now()}`,
        writtenDate:
          extract("WrittenDate") ||
          new Date().toISOString().split("T")[0],
        medication: {
          drugDescription: extract("DrugDescription") || extract("ProductName"),
          productCode: extract("ProductCode") || extract("NDC"),
          productCodeQualifier: "ND",
          strength: extract("Strength") || undefined,
          dosageForm: extract("DosageForm") || undefined,
          deaSchedule: extract("DEASchedule") || undefined,
        },
        quantity: {
          value: Number(extract("Quantity") || extract("Value")) || 1,
          codeListQualifier:
            extract("CodeListQualifier") ||
            extract("QuantityQualifier") ||
            "EA",
          unitOfMeasure:
            extract("UnitOfMeasure") || extract("PotencyUnitCode") || "each",
        },
        directions: extract("Directions") || extract("SIG") || "",
        refills: {
          qualifier: "R",
          value: Number(extract("Refills") || extract("NumberOfRefills")) || 0,
        },
        prescriber: {
          lastName:
            extract("PrescriberLastName") || extract("LastName") || "Unknown",
          firstName:
            extract("PrescriberFirstName") || extract("FirstName") || "",
          npi: extract("NPI") || extract("PrescriberNPI") || "",
          deaNumber:
            extract("DEANumber") || extract("PrescriberDEA") || undefined,
        },
        patient: {
          lastName:
            extract("PatientLastName") ||
            body.match(
              /<Patient>[\s\S]*?<LastName>([^<]*)<\/LastName>/,
            )?.[1] ||
            "Unknown",
          firstName:
            extract("PatientFirstName") ||
            body.match(
              /<Patient>[\s\S]*?<FirstName>([^<]*)<\/FirstName>/,
            )?.[1] ||
            "",
          dateOfBirth: extract("DateOfBirth") || "",
          gender: extract("Gender") || extract("GenderCode") || "",
        },
        pharmacy: {
          ncpdpId:
            extract("NCPDPProviderID") || extract("PharmacyNCPDP") || "",
          npi: extract("PharmacyNPI") || undefined,
        },
      };

      if (!message.medication.drugDescription) return null;

      return message;
    } catch {
      return null;
    }
  }

  return null;
}
