/**
 * EDI 837P (Professional) Claim Generator for NEMT Medicaid/Medicare billing.
 *
 * Generates ANSI X12 837P format claims conforming to the 005010X222A1 standard.
 * Covers all required segments: ISA, GS, ST, BHT, Loop 2000A (Billing Provider),
 * Loop 2000B (Subscriber), Loop 2300 (Claim), Loop 2400 (Service Line), SE, GE, IEA.
 *
 * HCPCS codes for NEMT:
 *   A0080 - Non-emergency ambulance transport (BLS)
 *   A0090 - Per-mile charges for ambulance
 *   A0100 - Non-emergency transport, taxi
 *   A0110 - Non-emergency transport, bus
 *   A0120 - Non-emergency transport, mini-bus
 *   A0130 - Non-emergency transport, wheelchair van
 *   A0140 - Non-emergency transport, air ambulance
 *   A0160 - Non-emergency transport, per mile (caseworker)
 *   A0170 - Transport, ancillary: parking fees, tolls
 *   A0180 - Non-emergency transport, ancillary: lodging (recipient)
 *   A0190 - Non-emergency transport, ancillary: meals
 *   A0200 - Non-emergency transport, ancillary: lodging (escort)
 *   A0210 - Non-emergency transport, ancillary: meals (escort)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EDI837Provider {
  npi: string;
  taxId: string;
  taxonomyCode: string;
  organizationName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  contactName?: string;
  contactPhone?: string;
}

export interface EDI837Payer {
  payerId: string;
  payerName: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface EDI837Patient {
  memberId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD
  gender: "M" | "F" | "U";
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
}

export interface EDI837ServiceLine {
  hcpcsCode: string;
  modifiers?: string[];
  amountCents: number;
  units: number;
  serviceDate: string; // YYYY-MM-DD
  diagnosisPointer?: number;
  placeOfService: string;
}

export interface EDI837ClaimInput {
  claimNumber: string;
  tripId: number;
  totalAmountCents: number;
  placeOfService: string;
  diagnosisCodes?: string[];
  priorAuthNumber?: string;
  serviceLines: EDI837ServiceLine[];
  patient: EDI837Patient;
  provider: EDI837Provider;
  payer: EDI837Payer;
  pickupAddress?: string;
  pickupCity?: string;
  pickupState?: string;
  pickupZip?: string;
  dropoffAddress?: string;
  dropoffCity?: string;
  dropoffState?: string;
  dropoffZip?: string;
  mileage?: number;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function padRight(val: string, len: number): string {
  return val.substring(0, len).padEnd(len, " ");
}

function padLeft(val: string, len: number, char = "0"): string {
  return val.substring(0, len).padStart(len, char);
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatEdiDate(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

function cleanString(val: string | undefined | null): string {
  return (val || "").replace(/[~*:\\^]/g, "").trim() || "UNKNOWN";
}

function generateControlNumber(): string {
  return Date.now().toString().slice(-9);
}

/**
 * Maps a service type / mobility requirement to the appropriate HCPCS code.
 */
export function getHcpcsCode(serviceType: string): string {
  const normalized = (serviceType || "").toUpperCase();
  switch (normalized) {
    case "AMBULATORY":
    case "STANDARD":
    case "SEDAN":
      return "A0080";
    case "WHEELCHAIR":
      return "A0130";
    case "STRETCHER":
    case "GURNEY":
      return "A0080";
    case "BARIATRIC":
      return "A0130";
    case "BUS":
      return "A0110";
    case "TAXI":
      return "A0100";
    case "MINI_BUS":
      return "A0120";
    case "AMBULANCE_BLS":
      return "A0080";
    case "AMBULANCE_ALS":
      return "A0080";
    default:
      return "A0080";
  }
}

/**
 * Returns per-mile HCPCS code for mileage line items.
 */
export function getMileageHcpcsCode(): string {
  return "A0090";
}

// ─── Single Claim Generator ─────────────────────────────────────────────────

/**
 * Generate a single EDI 837P (Professional) claim string.
 *
 * Produces a complete, valid interchange with all required segments:
 * ISA, GS, ST, BHT, Loop 2000A (Billing Provider), Loop 2000B (Subscriber),
 * Loop 2300 (Claim), Loop 2400 (Service Lines), SE, GE, IEA.
 */
export function generateEDI837Claim(
  claim: EDI837ClaimInput,
): string {
  const segments: string[] = [];
  const controlNumber = generateControlNumber();
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timeStamp = now.toISOString().slice(11, 15).replace(":", "");
  const { provider, payer, patient } = claim;

  // ─── ISA - Interchange Control Header ────────────────────────────────
  segments.push(
    `ISA*00*${padRight("", 10)}*00*${padRight("", 10)}*ZZ*${padRight(provider.npi, 15)}*ZZ*${padRight(payer.payerId, 15)}*${dateStamp.slice(2)}*${timeStamp}*^*00501*${padLeft(controlNumber, 9)}*0*P*:~`
  );

  // ─── GS - Functional Group Header ───────────────────────────────────
  segments.push(
    `GS*HC*${provider.npi}*${payer.payerId}*${dateStamp}*${timeStamp}*${controlNumber}*X*005010X222A1~`
  );

  // ─── ST - Transaction Set Header ────────────────────────────────────
  const transactionControlNum = "0001";
  segments.push(`ST*837*${transactionControlNum}*005010X222A1~`);

  // ─── BHT - Beginning of Hierarchical Transaction ────────────────────
  segments.push(
    `BHT*0019*00*${claim.claimNumber}*${dateStamp}*${timeStamp}*CH~`
  );

  // ─── Loop 1000A - Submitter Name ────────────────────────────────────
  segments.push(
    `NM1*41*2*${cleanString(provider.organizationName)}*****46*${provider.npi}~`
  );
  segments.push(
    `PER*IC*${cleanString(provider.contactName || provider.organizationName)}*TE*${provider.contactPhone || "5555555555"}~`
  );

  // ─── Loop 1000B - Receiver Name ─────────────────────────────────────
  segments.push(
    `NM1*40*2*${cleanString(payer.payerName)}*****46*${payer.payerId}~`
  );

  // ─── HL - Billing Provider Hierarchical Level (Loop 2000A) ──────────
  let hlCounter = 1;
  segments.push(`HL*${hlCounter}**20*1~`);

  // ─── Loop 2010AA - Billing Provider Name ────────────────────────────
  segments.push(
    `NM1*85*2*${cleanString(provider.organizationName)}*****XX*${provider.npi}~`
  );
  segments.push(`N3*${cleanString(provider.addressLine1)}~`);
  segments.push(
    `N4*${cleanString(provider.city)}*${provider.state || "XX"}*${provider.zip || "00000"}~`
  );
  segments.push(`REF*EI*${provider.taxId || "000000000"}~`);

  // Taxonomy code
  if (provider.taxonomyCode) {
    segments.push(`PRV*BI*PXC*${provider.taxonomyCode}~`);
  }

  // ─── HL - Subscriber Hierarchical Level (Loop 2000B) ────────────────
  hlCounter++;
  segments.push(`HL*${hlCounter}*1*22*0~`);
  segments.push(`SBR*P*18*******MC~`);

  // ─── Loop 2010BA - Subscriber Name ──────────────────────────────────
  segments.push(
    `NM1*IL*1*${cleanString(patient.lastName)}*${cleanString(patient.firstName)}*****MI*${patient.memberId}~`
  );
  segments.push(`N3*${cleanString(patient.addressLine1)}~`);
  segments.push(
    `N4*${cleanString(patient.city)}*${patient.state || "XX"}*${patient.zip || "00000"}~`
  );
  segments.push(
    `DMG*D8*${formatEdiDate(patient.dateOfBirth)}*${patient.gender || "U"}~`
  );

  // ─── Loop 2010BB - Payer Name ───────────────────────────────────────
  segments.push(
    `NM1*PR*2*${cleanString(payer.payerName)}*****PI*${payer.payerId}~`
  );
  if (payer.addressLine1) {
    segments.push(`N3*${cleanString(payer.addressLine1)}~`);
    segments.push(
      `N4*${cleanString(payer.city)}*${payer.state || "XX"}*${payer.zip || "00000"}~`
    );
  }

  // ─── Loop 2300 - Claim Information ──────────────────────────────────
  segments.push(
    `CLM*${claim.claimNumber}*${formatAmount(claim.totalAmountCents)}***${claim.placeOfService}:B:1*Y*A*Y*Y~`
  );

  // Prior authorization
  if (claim.priorAuthNumber) {
    segments.push(`REF*G1*${claim.priorAuthNumber}~`);
  }

  // Diagnosis codes (HI segment)
  if (claim.diagnosisCodes && claim.diagnosisCodes.length > 0) {
    const hiElements = claim.diagnosisCodes.map((code, idx) => {
      const qualifier = idx === 0 ? "ABK" : "ABF";
      return `${qualifier}:${code}`;
    });
    segments.push(`HI*${hiElements.join("*")}~`);
  }

  // Transportation-specific segments: pickup/dropoff locations
  if (claim.pickupAddress) {
    // NTE for pickup
    segments.push(`NTE*ADD*PICKUP: ${cleanString(claim.pickupAddress)}~`);
  }
  if (claim.dropoffAddress) {
    segments.push(`NTE*ADD*DROPOFF: ${cleanString(claim.dropoffAddress)}~`);
  }

  // ─── Loop 2400 - Service Lines ──────────────────────────────────────
  let lineCounter = 0;
  for (const line of claim.serviceLines) {
    lineCounter++;
    const modStr = line.modifiers?.length ? ":" + line.modifiers.join(":") : "";
    const diagPtr = line.diagnosisPointer || 1;

    // SV1 - Professional Service
    segments.push(
      `SV1*HC:${line.hcpcsCode}${modStr}*${formatAmount(line.amountCents)}*UN*${line.units}***${diagPtr}~`
    );

    // DTP - Date of service
    segments.push(`DTP*472*D8*${formatEdiDate(line.serviceDate)}~`);

    // LX - Line counter (required for each service line)
    segments.push(`LX*${lineCounter}~`);
  }

  // Add mileage service line if applicable
  if (claim.mileage && claim.mileage > 0) {
    lineCounter++;
    const mileageCode = getMileageHcpcsCode();
    segments.push(
      `SV1*HC:${mileageCode}*${formatAmount(0)}*UN*${Math.ceil(claim.mileage)}***1~`
    );
    segments.push(
      `DTP*472*D8*${formatEdiDate(claim.serviceLines[0]?.serviceDate || new Date().toISOString().slice(0, 10))}~`
    );
    segments.push(`LX*${lineCounter}~`);
  }

  // ─── SE - Transaction Set Trailer ───────────────────────────────────
  const segmentCount = segments.length + 1; // +1 for SE itself
  segments.push(`SE*${segmentCount}*${transactionControlNum}~`);

  // ─── GE - Functional Group Trailer ──────────────────────────────────
  segments.push(`GE*1*${controlNumber}~`);

  // ─── IEA - Interchange Control Trailer ──────────────────────────────
  segments.push(`IEA*1*${padLeft(controlNumber, 9)}~`);

  return segments.join("\n");
}

// ─── Batch Generator ─────────────────────────────────────────────────────────

export interface EDI837BatchResult {
  ediContent: string;
  claimCount: number;
  totalAmountCents: number;
  claimNumbers: string[];
}

/**
 * Generate a single EDI 837P interchange containing multiple claims.
 * All claims share the same ISA/GS/ST envelope for efficient batch submission.
 */
export function generateEDI837Batch(
  claims: EDI837ClaimInput[],
): EDI837BatchResult {
  if (claims.length === 0) {
    throw new Error("No claims provided for batch EDI generation");
  }

  const segments: string[] = [];
  const controlNumber = generateControlNumber();
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timeStamp = now.toISOString().slice(11, 15).replace(":", "");

  // Use the first claim's provider and payer for the envelope
  const { provider, payer } = claims[0];

  // ─── ISA ─────────────────────────────────────────────────────────────
  segments.push(
    `ISA*00*${padRight("", 10)}*00*${padRight("", 10)}*ZZ*${padRight(provider.npi, 15)}*ZZ*${padRight(payer.payerId, 15)}*${dateStamp.slice(2)}*${timeStamp}*^*00501*${padLeft(controlNumber, 9)}*0*P*:~`
  );

  // ─── GS ──────────────────────────────────────────────────────────────
  segments.push(
    `GS*HC*${provider.npi}*${payer.payerId}*${dateStamp}*${timeStamp}*${controlNumber}*X*005010X222A1~`
  );

  // ─── ST ──────────────────────────────────────────────────────────────
  const transactionControlNum = "0001";
  segments.push(`ST*837*${transactionControlNum}*005010X222A1~`);

  // ─── BHT ─────────────────────────────────────────────────────────────
  segments.push(
    `BHT*0019*00*BATCH${controlNumber}*${dateStamp}*${timeStamp}*CH~`
  );

  // ─── Loop 1000A - Submitter ──────────────────────────────────────────
  segments.push(
    `NM1*41*2*${cleanString(provider.organizationName)}*****46*${provider.npi}~`
  );
  segments.push(
    `PER*IC*${cleanString(provider.contactName || provider.organizationName)}*TE*${provider.contactPhone || "5555555555"}~`
  );

  // ─── Loop 1000B - Receiver ──────────────────────────────────────────
  segments.push(
    `NM1*40*2*${cleanString(payer.payerName)}*****46*${payer.payerId}~`
  );

  // ─── HL - Billing Provider (Loop 2000A) ─────────────────────────────
  let hlCounter = 1;
  segments.push(`HL*${hlCounter}**20*1~`);

  // Loop 2010AA - Billing Provider Name
  segments.push(
    `NM1*85*2*${cleanString(provider.organizationName)}*****XX*${provider.npi}~`
  );
  segments.push(`N3*${cleanString(provider.addressLine1)}~`);
  segments.push(
    `N4*${cleanString(provider.city)}*${provider.state || "XX"}*${provider.zip || "00000"}~`
  );
  segments.push(`REF*EI*${provider.taxId || "000000000"}~`);

  if (provider.taxonomyCode) {
    segments.push(`PRV*BI*PXC*${provider.taxonomyCode}~`);
  }

  let totalAmountCents = 0;
  const claimNumbers: string[] = [];

  // ─── Each Claim ──────────────────────────────────────────────────────
  for (const claim of claims) {
    const { patient } = claim;
    totalAmountCents += claim.totalAmountCents;
    claimNumbers.push(claim.claimNumber);

    // HL - Subscriber (Loop 2000B)
    hlCounter++;
    segments.push(`HL*${hlCounter}*1*22*0~`);
    segments.push(`SBR*P*18*******MC~`);

    // Loop 2010BA - Subscriber Name
    segments.push(
      `NM1*IL*1*${cleanString(patient.lastName)}*${cleanString(patient.firstName)}*****MI*${patient.memberId}~`
    );
    segments.push(`N3*${cleanString(patient.addressLine1)}~`);
    segments.push(
      `N4*${cleanString(patient.city)}*${patient.state || "XX"}*${patient.zip || "00000"}~`
    );
    segments.push(
      `DMG*D8*${formatEdiDate(patient.dateOfBirth)}*${patient.gender || "U"}~`
    );

    // Loop 2010BB - Payer
    segments.push(
      `NM1*PR*2*${cleanString(claim.payer.payerName)}*****PI*${claim.payer.payerId}~`
    );

    // Loop 2300 - Claim
    segments.push(
      `CLM*${claim.claimNumber}*${formatAmount(claim.totalAmountCents)}***${claim.placeOfService}:B:1*Y*A*Y*Y~`
    );

    if (claim.priorAuthNumber) {
      segments.push(`REF*G1*${claim.priorAuthNumber}~`);
    }

    if (claim.diagnosisCodes && claim.diagnosisCodes.length > 0) {
      const hiElements = claim.diagnosisCodes.map((code, idx) => {
        const qualifier = idx === 0 ? "ABK" : "ABF";
        return `${qualifier}:${code}`;
      });
      segments.push(`HI*${hiElements.join("*")}~`);
    }

    if (claim.pickupAddress) {
      segments.push(`NTE*ADD*PICKUP: ${cleanString(claim.pickupAddress)}~`);
    }
    if (claim.dropoffAddress) {
      segments.push(`NTE*ADD*DROPOFF: ${cleanString(claim.dropoffAddress)}~`);
    }

    // Loop 2400 - Service Lines
    let lineCounter = 0;
    for (const line of claim.serviceLines) {
      lineCounter++;
      const modStr = line.modifiers?.length ? ":" + line.modifiers.join(":") : "";
      const diagPtr = line.diagnosisPointer || 1;

      segments.push(
        `SV1*HC:${line.hcpcsCode}${modStr}*${formatAmount(line.amountCents)}*UN*${line.units}***${diagPtr}~`
      );
      segments.push(`DTP*472*D8*${formatEdiDate(line.serviceDate)}~`);
      segments.push(`LX*${lineCounter}~`);
    }

    // Mileage line
    if (claim.mileage && claim.mileage > 0) {
      lineCounter++;
      segments.push(
        `SV1*HC:${getMileageHcpcsCode()}*${formatAmount(0)}*UN*${Math.ceil(claim.mileage)}***1~`
      );
      segments.push(
        `DTP*472*D8*${formatEdiDate(claim.serviceLines[0]?.serviceDate || new Date().toISOString().slice(0, 10))}~`
      );
      segments.push(`LX*${lineCounter}~`);
    }
  }

  // ─── SE ──────────────────────────────────────────────────────────────
  const segmentCount = segments.length + 1;
  segments.push(`SE*${segmentCount}*${transactionControlNum}~`);

  // ─── GE ──────────────────────────────────────────────────────────────
  segments.push(`GE*1*${controlNumber}~`);

  // ─── IEA ─────────────────────────────────────────────────────────────
  segments.push(`IEA*1*${padLeft(controlNumber, 9)}~`);

  return {
    ediContent: segments.join("\n"),
    claimCount: claims.length,
    totalAmountCents,
    claimNumbers,
  };
}
