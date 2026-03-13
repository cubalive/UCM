import { describe, it, expect } from "vitest";
import {
  generateEDI837Claim,
  getHcpcsCode,
  getMileageHcpcsCode,
  type EDI837ClaimInput,
} from "../lib/edi837Engine";
import { parseEDI835, type ParsedEDI835 } from "../lib/edi835Parser";

// =========================================================
// EDI 837 / 835 Engine Tests — Pure Logic (no DB)
// =========================================================

// ─── Test Fixtures ──────────────────────────────────────────

const testProvider = {
  npi: "1234567890",
  taxId: "123456789",
  taxonomyCode: "343900000X",
  organizationName: "UCM Transport Co",
  addressLine1: "100 Main St",
  city: "Miami",
  state: "FL",
  zip: "33101",
  contactName: "John Admin",
  contactPhone: "3055551234",
};

const testPayer = {
  payerId: "FLMCD",
  payerName: "Florida Medicaid",
  addressLine1: "200 State St",
  city: "Tallahassee",
  state: "FL",
  zip: "32301",
};

const testPatient = {
  memberId: "MCD123456789",
  firstName: "Jane",
  lastName: "Smith",
  dateOfBirth: "1985-03-15",
  gender: "F" as const,
  addressLine1: "300 Patient Ave",
  city: "Miami",
  state: "FL",
  zip: "33130",
};

const baseClaim: EDI837ClaimInput = {
  claimNumber: "CLM-2026-001",
  tripId: 42,
  totalAmountCents: 7500,
  placeOfService: "41",
  diagnosisCodes: ["Z76.89"],
  serviceLines: [
    {
      hcpcsCode: "A0130",
      amountCents: 5000,
      units: 1,
      serviceDate: "2026-03-10",
      placeOfService: "41",
    },
    {
      hcpcsCode: "A0090",
      amountCents: 2500,
      units: 25,
      serviceDate: "2026-03-10",
      placeOfService: "41",
    },
  ],
  patient: testPatient,
  provider: testProvider,
  payer: testPayer,
};

// ─── EDI 837 Generation ─────────────────────────────────────

describe("EDI 837 Claim Generator", () => {
  it("generates a valid EDI 837 string", () => {
    const edi = generateEDI837Claim(baseClaim);
    expect(typeof edi).toBe("string");
    expect(edi.length).toBeGreaterThan(100);
  });

  it("contains ISA header segment", () => {
    const edi = generateEDI837Claim(baseClaim);
    expect(edi).toContain("ISA*");
    expect(edi).toContain("*00501*");
  });

  it("contains GS functional group with correct version", () => {
    const edi = generateEDI837Claim(baseClaim);
    expect(edi).toContain("GS*HC*");
    expect(edi).toContain("*005010X222A1~");
  });

  it("contains ST transaction set header for 837", () => {
    const edi = generateEDI837Claim(baseClaim);
    expect(edi).toContain("ST*837*");
  });

  it("includes provider NPI in NM1 segment", () => {
    const edi = generateEDI837Claim(baseClaim);
    expect(edi).toContain(testProvider.npi);
  });

  it("includes patient information", () => {
    const edi = generateEDI837Claim(baseClaim);
    expect(edi).toContain(testPatient.lastName);
    expect(edi).toContain(testPatient.firstName);
    expect(edi).toContain(testPatient.memberId);
  });

  it("includes payer information", () => {
    const edi = generateEDI837Claim(baseClaim);
    expect(edi).toContain(testPayer.payerId);
    expect(edi).toContain(testPayer.payerName);
  });

  it("includes CLM claim segment with amount", () => {
    const edi = generateEDI837Claim(baseClaim);
    // 7500 cents = 75.00
    expect(edi).toContain("CLM*CLM-2026-001*75.00*");
  });

  it("includes service line segments (SV1)", () => {
    const edi = generateEDI837Claim(baseClaim);
    expect(edi).toContain("SV1*");
    expect(edi).toContain("A0130"); // wheelchair van code
    expect(edi).toContain("A0090"); // mileage code
  });

  it("includes diagnosis codes in HI segment", () => {
    const edi = generateEDI837Claim(baseClaim);
    expect(edi).toContain("HI*ABK:Z76.89~");
  });

  it("includes prior auth when provided", () => {
    const claim = { ...baseClaim, priorAuthNumber: "PA-12345" };
    const edi = generateEDI837Claim(claim);
    expect(edi).toContain("REF*G1*PA-12345~");
  });

  it("includes pickup/dropoff when provided", () => {
    const claim = {
      ...baseClaim,
      pickupAddress: "100 Pickup St",
      dropoffAddress: "200 Dropoff Ave",
    };
    const edi = generateEDI837Claim(claim);
    expect(edi).toContain("PICKUP");
    expect(edi).toContain("DROPOFF");
  });

  it("ends with IEA trailer", () => {
    const edi = generateEDI837Claim(baseClaim);
    expect(edi).toContain("IEA*1*");
  });

  it("contains balanced segment counts (SE segment)", () => {
    const edi = generateEDI837Claim(baseClaim);
    expect(edi).toContain("SE*");
  });

  it("patient DOB is formatted without dashes", () => {
    const edi = generateEDI837Claim(baseClaim);
    expect(edi).toContain("19850315"); // DOB formatted CCYYMMDD
  });
});

// ─── HCPCS Code Mapping ────────────────────────────────────

describe("HCPCS Code Mapping", () => {
  it("maps SEDAN to A0080", () => {
    expect(getHcpcsCode("SEDAN")).toBe("A0080");
  });

  it("maps WHEELCHAIR to A0130", () => {
    expect(getHcpcsCode("WHEELCHAIR")).toBe("A0130");
  });

  it("maps TAXI to A0100", () => {
    expect(getHcpcsCode("TAXI")).toBe("A0100");
  });

  it("maps BUS to A0110", () => {
    expect(getHcpcsCode("BUS")).toBe("A0110");
  });

  it("maps MINI_BUS to A0120", () => {
    expect(getHcpcsCode("MINI_BUS")).toBe("A0120");
  });

  it("is case-insensitive", () => {
    expect(getHcpcsCode("sedan")).toBe("A0080");
    expect(getHcpcsCode("Wheelchair")).toBe("A0130");
  });

  it("defaults unknown types to A0080", () => {
    expect(getHcpcsCode("UNKNOWN_TYPE")).toBe("A0080");
    expect(getHcpcsCode("")).toBe("A0080");
  });

  it("getMileageHcpcsCode returns A0090", () => {
    expect(getMileageHcpcsCode()).toBe("A0090");
  });
});

// ─── EDI 835 Parser ─────────────────────────────────────────

describe("EDI 835 Parser", () => {
  it("handles empty/invalid input gracefully", () => {
    const result = parseEDI835("");
    expect(result.warnings).toContain("Empty or invalid EDI content");
    expect(result.claims).toHaveLength(0);
  });

  it("handles null-ish input", () => {
    const result = parseEDI835(null as any);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("parses BPR payment information", () => {
    const edi = [
      "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260310*1200*^*00501*000000001*0*P*:~",
      "GS*HP*SENDER*RECEIVER*20260310*1200*1*X*005010X221A1~",
      "ST*835*0001~",
      "BPR*I*150.00*C*ACH*CCP*01*021000089*DA*12345678*1234567890**01*021000089*DA*87654321*20260310~",
      "TRN*1*TRACE12345*1234567890~",
      "SE*5*0001~",
      "GE*1*1~",
      "IEA*1*000000001~",
    ].join("\n");

    const result = parseEDI835(edi);
    expect(result.totalPaymentCents).toBe(15000);
    expect(result.paymentMethod).toBe("ACH");
    expect(result.checkNumber).toBe("TRACE12345");
    expect(result.paymentDate).toBe("2026-03-10");
  });

  it("parses payer and payee from N1 segments", () => {
    const edi = [
      "BPR*I*100.00*C*CHK~",
      "N1*PR*Florida Medicaid*XV*FLMCD~",
      "N1*PE*UCM Transport*XX*1234567890~",
    ].join("~") + "~";

    const result = parseEDI835(edi);
    expect(result.payerName).toBe("Florida Medicaid");
    expect(result.payerId).toBe("FLMCD");
    expect(result.payeeName).toBe("UCM Transport");
    expect(result.payeeNpi).toBe("1234567890");
  });

  it("parses CLP claim payment with status", () => {
    const edi = [
      "BPR*I*75.00*C*CHK~",
      "CLP*CLM-001*1*100.00*75.00*25.00*MC*ICN12345~",
    ].join("~") + "~";

    const result = parseEDI835(edi);
    expect(result.claims).toHaveLength(1);
    const claim = result.claims[0];
    expect(claim.claimNumber).toBe("CLM-001");
    expect(claim.totalChargedCents).toBe(10000);
    expect(claim.totalPaidCents).toBe(7500);
    expect(claim.patientResponsibilityCents).toBe(2500);
    expect(claim.payerClaimControlNumber).toBe("ICN12345");
  });

  it("derives 'paid' status for fully paid claims", () => {
    const edi = "CLP*CLM-001*1*100.00*100.00*0.00~";
    const result = parseEDI835(edi);
    expect(result.claims[0].status).toBe("paid");
  });

  it("derives 'adjusted' status for partially paid claims", () => {
    const edi = "CLP*CLM-001*1*100.00*75.00~";
    const result = parseEDI835(edi);
    expect(result.claims[0].status).toBe("adjusted");
  });

  it("derives 'denied' status for denied claims", () => {
    const edi = "CLP*CLM-001*4*100.00*0.00~";
    const result = parseEDI835(edi);
    expect(result.claims[0].status).toBe("denied");
  });

  it("derives 'reversed' status for reversals", () => {
    const edi = "CLP*CLM-001*22*100.00*0.00~";
    const result = parseEDI835(edi);
    expect(result.claims[0].status).toBe("reversed");
  });

  it("parses CAS adjustment codes", () => {
    const edi = [
      "CLP*CLM-001*1*100.00*75.00~",
      "CAS*CO*45*25.00~",
    ].join("~") + "~";

    const result = parseEDI835(edi);
    expect(result.claims[0].adjustments).toHaveLength(1);
    expect(result.claims[0].adjustments[0]).toMatchObject({
      group: "CO",
      reasonCode: "45",
      amountCents: 2500,
    });
  });

  it("parses SVC service line payments", () => {
    const edi = [
      "CLP*CLM-001*1*75.00*75.00~",
      "SVC*HC:A0130*50.00*50.00**1~",
      "SVC*HC:A0090*25.00*25.00**25~",
    ].join("~") + "~";

    const result = parseEDI835(edi);
    const claim = result.claims[0];
    expect(claim.serviceLines).toHaveLength(2);
    expect(claim.serviceLines[0].procedureCode).toBe("A0130");
    expect(claim.serviceLines[0].chargedCents).toBe(5000);
    expect(claim.serviceLines[1].procedureCode).toBe("A0090");
    expect(claim.serviceLines[1].units).toBe(25);
  });

  it("parses multiple claims in one remittance", () => {
    const edi = [
      "BPR*I*200.00*C*CHK~",
      "CLP*CLM-001*1*100.00*100.00~",
      "CLP*CLM-002*1*100.00*100.00~",
    ].join("~") + "~";

    const result = parseEDI835(edi);
    expect(result.claims).toHaveLength(2);
    expect(result.claims[0].claimNumber).toBe("CLM-001");
    expect(result.claims[1].claimNumber).toBe("CLM-002");
  });

  it("handles Windows-style line endings", () => {
    const edi = "BPR*I*50.00*C*CHK~\r\nCLP*CLM-001*1*50.00*50.00~\r\n";
    const result = parseEDI835(edi);
    expect(result.totalPaymentCents).toBe(5000);
    expect(result.claims).toHaveLength(1);
  });

  it("parses DTM production date", () => {
    const edi = "DTM*405*20260310~";
    const result = parseEDI835(edi);
    expect(result.productionDate).toBe("2026-03-10");
  });

  it("records PLB provider-level adjustments as warnings", () => {
    const edi = "PLB*1234567890*20260310*WO*-50.00~";
    const result = parseEDI835(edi);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("Provider-level adjustment");
  });
});
