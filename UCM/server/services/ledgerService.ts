import { db } from "../db";
import { ledgerEntries } from "@shared/schema";
import { randomUUID } from "crypto";

export type LedgerAccount =
  | "AR_CLINIC"
  | "AP_COMPANY"
  | "PLATFORM_REVENUE"
  | "STRIPE_FEES"
  | "CASH"
  | "REFUND_LIABILITY"
  | "DISPUTE_RESERVE";

interface LedgerLine {
  account: LedgerAccount;
  direction: "debit" | "credit";
  amountCents: number;
}

interface JournalParams {
  refType: string;
  refId: string;
  clinicId?: number | null;
  companyId?: number | null;
  currency?: string;
  lines: LedgerLine[];
}

export async function writeJournal(params: JournalParams): Promise<string> {
  const journalId = `J-${randomUUID().slice(0, 12)}`;

  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of params.lines) {
    if (line.direction === "debit") totalDebit += line.amountCents;
    else totalCredit += line.amountCents;
  }
  if (totalDebit !== totalCredit) {
    throw new Error(`Ledger imbalance: debit=${totalDebit} credit=${totalCredit} for ${params.refType}/${params.refId}`);
  }

  for (const line of params.lines) {
    await db.insert(ledgerEntries).values({
      journalId,
      refType: params.refType,
      refId: params.refId,
      clinicId: params.clinicId ?? null,
      companyId: params.companyId ?? null,
      account: line.account,
      direction: line.direction,
      amountCents: line.amountCents,
      currency: params.currency || "usd",
    });
  }

  return journalId;
}

export async function writeInvoiceFinalizedJournal(opts: {
  invoiceId: number;
  clinicId: number;
  companyId: number;
  totalCents: number;
  currency?: string;
}): Promise<string> {
  return writeJournal({
    refType: "invoice_finalized",
    refId: String(opts.invoiceId),
    clinicId: opts.clinicId,
    companyId: opts.companyId,
    currency: opts.currency,
    lines: [
      { account: "AR_CLINIC", direction: "debit", amountCents: opts.totalCents },
      { account: "AP_COMPANY", direction: "credit", amountCents: opts.totalCents },
    ],
  });
}

export async function writePaymentSucceededJournal(opts: {
  paymentIntentId: string;
  invoiceId: number;
  clinicId: number;
  companyId: number;
  totalCents: number;
  platformFeeCents: number;
  stripeFeeEstCents?: number;
  currency?: string;
}): Promise<string> {
  const netToCompany = opts.totalCents - opts.platformFeeCents;
  const lines: LedgerLine[] = [
    { account: "CASH", direction: "debit", amountCents: opts.totalCents },
    { account: "AR_CLINIC", direction: "credit", amountCents: opts.totalCents },
  ];

  if (opts.platformFeeCents > 0) {
    lines.push(
      { account: "AP_COMPANY", direction: "debit", amountCents: opts.totalCents },
      { account: "PLATFORM_REVENUE", direction: "credit", amountCents: opts.platformFeeCents },
      { account: "CASH", direction: "credit", amountCents: netToCompany },
    );
  } else {
    lines.push(
      { account: "AP_COMPANY", direction: "debit", amountCents: opts.totalCents },
      { account: "CASH", direction: "credit", amountCents: opts.totalCents },
    );
  }

  return writeJournal({
    refType: "payment_intent",
    refId: opts.paymentIntentId,
    clinicId: opts.clinicId,
    companyId: opts.companyId,
    currency: opts.currency,
    lines,
  });
}

export async function writeRefundJournal(opts: {
  refundId: string;
  invoiceId: number;
  clinicId: number;
  companyId: number;
  amountCents: number;
  currency?: string;
}): Promise<string> {
  return writeJournal({
    refType: "refund",
    refId: opts.refundId,
    clinicId: opts.clinicId,
    companyId: opts.companyId,
    currency: opts.currency,
    lines: [
      { account: "AR_CLINIC", direction: "debit", amountCents: opts.amountCents },
      { account: "CASH", direction: "credit", amountCents: opts.amountCents },
    ],
  });
}

export async function writeDisputeJournal(opts: {
  disputeId: string;
  clinicId?: number | null;
  companyId?: number | null;
  amountCents: number;
  currency?: string;
}): Promise<string> {
  return writeJournal({
    refType: "dispute",
    refId: opts.disputeId,
    clinicId: opts.clinicId,
    companyId: opts.companyId,
    currency: opts.currency,
    lines: [
      { account: "DISPUTE_RESERVE", direction: "debit", amountCents: opts.amountCents },
      { account: "CASH", direction: "credit", amountCents: opts.amountCents },
    ],
  });
}
