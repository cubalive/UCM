/**
 * EDI 835 (Electronic Remittance Advice / ERA) Parser
 *
 * Parses ANSI X12 835 remittance advice files returned by Medicaid/Medicare
 * clearinghouses. Extracts payment amounts, adjustment reasons, claim statuses,
 * and maps them back to internal claim/invoice IDs.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdjustmentCode {
  /** Claim Adjustment Group Code: CO (contractual), PR (patient responsibility), OA (other), PI (payer), CR (corrections) */
  group: string;
  /** Claim Adjustment Reason Code (CARC) */
  reasonCode: string;
  /** Adjustment amount in cents */
  amountCents: number;
  /** Quantity (units affected) */
  quantity?: number;
}

export interface ServiceLinePayment {
  /** Procedure/HCPCS code */
  procedureCode: string;
  /** Modifiers */
  modifiers: string[];
  /** Amount charged in cents */
  chargedCents: number;
  /** Amount paid in cents */
  paidCents: number;
  /** Units of service */
  units: number;
  /** Service date YYYY-MM-DD */
  serviceDate: string | null;
  /** Line-level adjustments */
  adjustments: AdjustmentCode[];
  /** Remark codes */
  remarkCodes: string[];
}

export interface ClaimPayment {
  /** Claim number (maps to internal claim number) */
  claimNumber: string;
  /** Claim status: 1=Processed Primary, 2=Processed Secondary, 3=Processed Tertiary, 4=Denied, 19=Processed Primary Forwarded, 22=Reversal */
  claimStatusCode: string;
  /** Derived status */
  status: "paid" | "denied" | "adjusted" | "reversed";
  /** Total amount charged in cents */
  totalChargedCents: number;
  /** Total amount paid in cents */
  totalPaidCents: number;
  /** Patient responsibility in cents */
  patientResponsibilityCents: number;
  /** Claim-level adjustments */
  adjustments: AdjustmentCode[];
  /** Service line payments */
  serviceLines: ServiceLinePayment[];
  /** Remark codes */
  remarkCodes: string[];
  /** Payer claim control number (ICN) */
  payerClaimControlNumber: string | null;
  /** Claim filing indicator */
  filingIndicator: string | null;
}

export interface ParsedEDI835 {
  /** Payer name */
  payerName: string | null;
  /** Payer ID */
  payerId: string | null;
  /** Payee name (provider) */
  payeeName: string | null;
  /** Payee NPI */
  payeeNpi: string | null;
  /** Payment method: ACH, CHK, etc. */
  paymentMethod: string | null;
  /** Total payment amount in cents */
  totalPaymentCents: number;
  /** Payment date YYYY-MM-DD */
  paymentDate: string | null;
  /** Check or EFT trace number */
  checkNumber: string | null;
  /** Production date */
  productionDate: string | null;
  /** Individual claim payments */
  claims: ClaimPayment[];
  /** Raw segment count */
  segmentCount: number;
  /** Parsing warnings */
  warnings: string[];
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse an EDI 835 Electronic Remittance Advice (ERA) response.
 *
 * @param rawContent - The raw EDI 835 content string
 * @returns Structured payment data with claim-level detail
 */
export function parseEDI835(rawContent: string): ParsedEDI835 {
  const result: ParsedEDI835 = {
    payerName: null,
    payerId: null,
    payeeName: null,
    payeeNpi: null,
    paymentMethod: null,
    totalPaymentCents: 0,
    paymentDate: null,
    checkNumber: null,
    productionDate: null,
    claims: [],
    segmentCount: 0,
    warnings: [],
  };

  if (!rawContent || typeof rawContent !== "string") {
    result.warnings.push("Empty or invalid EDI content");
    return result;
  }

  // Normalize and split into segments
  const normalized = rawContent.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawSegments = normalized
    .split("~")
    .map((s) => s.trim())
    .filter(Boolean);

  result.segmentCount = rawSegments.length;

  let currentClaim: ClaimPayment | null = null;
  let currentServiceLine: ServiceLinePayment | null = null;
  let inPayerLoop = false;
  let inPayeeLoop = false;

  for (const segment of rawSegments) {
    const elements = segment.split("*");
    const segId = elements[0];

    switch (segId) {
      // ─── BPR - Financial Information ─────────────────────────────────
      case "BPR": {
        // BPR*I*total_amount*C*payment_method*...*date
        if (elements.length > 2) {
          const amount = parseFloat(elements[2] || "0");
          result.totalPaymentCents = Math.round(amount * 100);
        }
        if (elements.length > 4) {
          result.paymentMethod = elements[4] || null;
        }
        if (elements.length > 16) {
          result.paymentDate = formatDate835(elements[16]);
        }
        break;
      }

      // ─── TRN - Reassociation Trace Number ───────────────────────────
      case "TRN": {
        if (elements.length > 2) {
          result.checkNumber = elements[2] || null;
        }
        break;
      }

      // ─── DTM - Production Date ──────────────────────────────────────
      case "DTM": {
        if (elements[1] === "405" && elements.length > 2) {
          result.productionDate = formatDate835(elements[2]);
        }
        break;
      }

      // ─── N1 - Entity Identification ─────────────────────────────────
      case "N1": {
        inPayerLoop = false;
        inPayeeLoop = false;
        if (elements[1] === "PR") {
          // Payer
          inPayerLoop = true;
          result.payerName = elements[2] || null;
          if (elements.length > 4) {
            result.payerId = elements[4] || null;
          }
        } else if (elements[1] === "PE") {
          // Payee
          inPayeeLoop = true;
          result.payeeName = elements[2] || null;
          if (elements.length > 4 && elements[3] === "XX") {
            result.payeeNpi = elements[4] || null;
          }
        }
        break;
      }

      // ─── REF - Reference Identification (for payee) ─────────────────
      case "REF": {
        if (inPayeeLoop && elements[1] === "PQ" && elements.length > 2) {
          // Payee additional ID
        }
        break;
      }

      // ─── CLP - Claim Payment Information ─────────────────────────────
      case "CLP": {
        // Flush previous service line to previous claim
        if (currentServiceLine && currentClaim) {
          currentClaim.serviceLines.push(currentServiceLine);
          currentServiceLine = null;
        }
        // Flush previous claim
        if (currentClaim) {
          result.claims.push(currentClaim);
        }

        inPayerLoop = false;
        inPayeeLoop = false;

        const claimStatusCode = elements[2] || "1";
        const chargedCents = Math.round(parseFloat(elements[3] || "0") * 100);
        const paidCents = Math.round(parseFloat(elements[4] || "0") * 100);
        const patientCents = elements.length > 5 ? Math.round(parseFloat(elements[5] || "0") * 100) : 0;
        const filingIndicator = elements.length > 6 ? elements[6] : null;
        const payerControlNum = elements.length > 7 ? elements[7] : null;

        currentClaim = {
          claimNumber: elements[1] || "",
          claimStatusCode,
          status: deriveClaimStatus(claimStatusCode, paidCents, chargedCents),
          totalChargedCents: chargedCents,
          totalPaidCents: paidCents,
          patientResponsibilityCents: patientCents,
          adjustments: [],
          serviceLines: [],
          remarkCodes: [],
          payerClaimControlNumber: payerControlNum,
          filingIndicator,
        };
        break;
      }

      // ─── CAS - Claim Adjustment Segment ──────────────────────────────
      case "CAS": {
        if (!currentClaim && !currentServiceLine) break;

        const group = elements[1] || "";
        // Adjustments come in groups of 3: reason, amount, quantity
        for (let i = 2; i < elements.length; i += 3) {
          const reasonCode = elements[i];
          const amount = elements[i + 1];
          const quantity = elements[i + 2];
          if (reasonCode && amount) {
            const adj: AdjustmentCode = {
              group,
              reasonCode,
              amountCents: Math.round(parseFloat(amount) * 100),
              quantity: quantity ? parseInt(quantity, 10) : undefined,
            };
            if (currentServiceLine) {
              currentServiceLine.adjustments.push(adj);
            } else if (currentClaim) {
              currentClaim.adjustments.push(adj);
            }
          }
        }
        break;
      }

      // ─── SVC - Service Payment Information ───────────────────────────
      case "SVC": {
        // Flush previous service line
        if (currentServiceLine && currentClaim) {
          currentClaim.serviceLines.push(currentServiceLine);
        }

        // Parse composite procedure code (HC:code:mod1:mod2...)
        const procedureComposite = elements[1] || "";
        const procParts = procedureComposite.split(":");
        const procedureCode = procParts.length > 1 ? procParts[1] : procParts[0];
        const modifiers = procParts.slice(2);

        const svcChargedCents = Math.round(parseFloat(elements[2] || "0") * 100);
        const svcPaidCents = Math.round(parseFloat(elements[3] || "0") * 100);
        const units = elements.length > 5 ? parseInt(elements[5] || "1", 10) : 1;

        currentServiceLine = {
          procedureCode,
          modifiers,
          chargedCents: svcChargedCents,
          paidCents: svcPaidCents,
          units: isNaN(units) ? 1 : units,
          serviceDate: null,
          adjustments: [],
          remarkCodes: [],
        };
        break;
      }

      // ─── DTM - Service Line Date ────────────────────────────────────
      // (In service line context)
      case "DTP": {
        if (currentServiceLine && elements[1] === "472" && elements.length > 2) {
          currentServiceLine.serviceDate = formatDate835(elements[2]);
        }
        break;
      }

      // ─── MOA - Medicare Outpatient Adjudication ──────────────────────
      case "MOA": {
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

      // ─── LQ - Service Line Remark Codes ─────────────────────────────
      case "LQ": {
        if (currentServiceLine && elements.length > 2) {
          currentServiceLine.remarkCodes.push(elements[2]);
        }
        break;
      }

      // ─── PLB - Provider Level Balance ────────────────────────────────
      case "PLB": {
        // Provider-level adjustments (interest, recoupments, etc.)
        // Just record as a warning for now
        if (elements.length > 3) {
          result.warnings.push(
            `Provider-level adjustment: ${elements[3]} - ${elements[4] || ""}`,
          );
        }
        break;
      }
    }
  }

  // Flush final service line and claim
  if (currentServiceLine && currentClaim) {
    currentClaim.serviceLines.push(currentServiceLine);
  }
  if (currentClaim) {
    result.claims.push(currentClaim);
  }

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate835(dateStr: string): string {
  if (!dateStr) return dateStr;
  // Handle CCYYMMDD format
  if (dateStr.length === 8) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }
  // Handle CCYYMMDD-CCYYMMDD date range - return start date
  if (dateStr.includes("-") && dateStr.length >= 17) {
    const startDate = dateStr.slice(0, 8);
    return `${startDate.slice(0, 4)}-${startDate.slice(4, 6)}-${startDate.slice(6, 8)}`;
  }
  return dateStr;
}

function deriveClaimStatus(
  claimStatusCode: string,
  paidCents: number,
  chargedCents: number,
): ClaimPayment["status"] {
  switch (claimStatusCode) {
    case "4":  // Denied
    case "22": // Reversal of previous payment
      return claimStatusCode === "22" ? "reversed" : "denied";
    case "1":  // Processed as Primary
    case "2":  // Processed as Secondary
    case "3":  // Processed as Tertiary
    case "19": // Processed as Primary, Forwarded to Additional Payer(s)
    default:
      if (paidCents === 0 && chargedCents > 0) return "denied";
      if (paidCents > 0 && paidCents < chargedCents) return "adjusted";
      return "paid";
  }
}

// ─── CARC Description Lookup ─────────────────────────────────────────────────

/** Common Claim Adjustment Reason Codes (CARC) descriptions for NEMT */
export const CARC_DESCRIPTIONS: Record<string, string> = {
  "1": "Deductible amount",
  "2": "Coinsurance amount",
  "3": "Copay amount",
  "4": "The procedure code is inconsistent with the modifier used",
  "5": "The procedure code/bill type is inconsistent with the place of service",
  "16": "Claim/service lacks information needed for adjudication",
  "18": "Duplicate claim/service",
  "27": "Expenses incurred after coverage terminated",
  "29": "The time limit for filing has expired",
  "45": "Charges exceed your contracted/legislated fee arrangement",
  "50": "Non-covered services (not deemed a medical necessity)",
  "96": "Non-covered charges",
  "97": "The benefit for this service is included in the payment/allowance for another service/procedure",
  "109": "Claim/service not covered by this payer/contractor",
  "119": "Benefit maximum for this time period has been reached",
  "140": "Patient/Insured health identification number and name do not match",
  "167": "This (these) diagnosis(es) is (are) not covered",
  "197": "Precertification/authorization/notification absent",
  "204": "This service/equipment/drug is not covered under the patient's current benefit plan",
  "242": "Services not provided by network/primary care providers",
  "252": "An attachment/other documentation is required to adjudicate this claim/service",
  "A1": "Claim PPS Capital Day Outlier Amount",
  "B1": "Non-covered visits",
  "B7": "Provider not certified/eligible to be paid for this procedure/service on this date of service",
};

/**
 * Get a human-readable description for a CARC code.
 */
export function getCarcDescription(code: string): string {
  return CARC_DESCRIPTIONS[code] || `Adjustment reason code ${code}`;
}
