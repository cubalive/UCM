import PDFDocument from "pdfkit";
import { db } from "../db";
import { companies } from "@shared/schema";
import { eq } from "drizzle-orm";

interface InvoicePdfData {
  invoice: any;
  items: any[];
  clinic: any;
  payments: any[];
  companyId?: number;
}

interface CompanyBranding {
  name: string;
  brandColor: string | null;
  brandTagline: string | null;
  logoData: string | null;
  logoMimeType: string | null;
}

const DEFAULT_COMPANY_NAME = process.env.COMPANY_NAME || "United Care Mobility LLC";
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "billing@unitedcaremobility.com";

const fmtCents = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const fmtDate = (d: string | Date | null | undefined): string => {
  if (!d) return "\u2014";
  try {
    const date = new Date(d as string);
    if (isNaN(date.getTime())) return "\u2014";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return "\u2014"; }
};

async function getCompanyBranding(companyId?: number): Promise<CompanyBranding | null> {
  if (!companyId) return null;
  try {
    const [company] = await db.select({
      name: companies.name,
      brandColor: companies.brandColor,
      brandTagline: companies.brandTagline,
      logoData: companies.logoData,
      logoMimeType: companies.logoMimeType,
    }).from(companies).where(eq(companies.id, companyId)).limit(1);
    return company || null;
  } catch {
    return null;
  }
}

export async function generateInvoicePdf(data: InvoicePdfData, res: any): Promise<void> {
  const { invoice, items, clinic, payments, companyId } = data;

  const branding = await getCompanyBranding(companyId);
  const companyName = branding?.name || DEFAULT_COMPANY_NAME;
  const tagline = branding?.brandTagline || "Medical Transportation Services";
  const accentColor = branding?.brandColor || "#10b981";

  const doc = new PDFDocument({ margin: 50, size: "LETTER", bufferPages: true });

  const filename = `invoice_${invoice.invoiceNumber || invoice.id}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  doc.pipe(res);

  // Header with company logo
  let headerTextX = 50;
  if (branding?.logoData && branding.logoMimeType) {
    try {
      const logoBuffer = Buffer.from(branding.logoData, "base64");
      doc.image(logoBuffer, 50, 45, { width: 40, height: 40, fit: [40, 40] });
      headerTextX = 100;
    } catch {
      // logo decode failed, skip
    }
  }

  // Accent bar at top
  doc.rect(0, 0, 612, 6).fill(accentColor);

  doc.fontSize(18).font("Helvetica-Bold").text(companyName, headerTextX, 50);
  doc.fontSize(10).font("Helvetica").text(tagline, headerTextX, 72);
  doc.moveDown(0.5);

  doc.fontSize(22).font("Helvetica-Bold").text("INVOICE", 400, 50, { align: "right" });

  let y = 110;
  doc.moveTo(50, y).lineTo(562, y).strokeColor(accentColor).stroke();
  y += 15;

  doc.fontSize(10).font("Helvetica-Bold");
  doc.text("Invoice Number:", 50, y);
  doc.font("Helvetica").text(invoice.invoiceNumber || `#${invoice.id}`, 160, y);

  doc.font("Helvetica-Bold").text("Date Issued:", 350, y);
  doc.font("Helvetica").text(fmtDate(invoice.finalizedAt || invoice.createdAt), 440, y);
  y += 18;

  doc.font("Helvetica-Bold").text("Billing Period:", 50, y);
  doc.font("Helvetica").text(`${invoice.periodStart} to ${invoice.periodEnd}`, 160, y);

  doc.font("Helvetica-Bold").text("Due Date:", 350, y);
  doc.font("Helvetica").text(fmtDate(invoice.dueDate), 440, y);
  y += 18;

  doc.font("Helvetica-Bold").text("Status:", 50, y);
  const statusLabel = invoice.paymentStatus === "paid" ? "PAID" :
    invoice.paymentStatus === "overdue" ? "OVERDUE" :
    invoice.paymentStatus === "partial" ? "PARTIAL" : "UNPAID";
  const statusColor = invoice.paymentStatus === "paid" ? "#16a34a" :
    invoice.paymentStatus === "overdue" ? "#dc2626" : "#ca8a04";
  doc.font("Helvetica-Bold").fillColor(statusColor).text(statusLabel, 160, y);
  doc.fillColor("#000000");
  y += 30;

  doc.font("Helvetica-Bold").text("Bill To:", 50, y);
  y += 15;
  doc.font("Helvetica").text(clinic?.name || `Clinic ID ${invoice.clinicId}`, 50, y);
  if (clinic?.address) { y += 14; doc.text(clinic.address, 50, y); }
  if (clinic?.phone) { y += 14; doc.text(`Phone: ${clinic.phone}`, 50, y); }
  if (clinic?.email) { y += 14; doc.text(`Email: ${clinic.email}`, 50, y); }
  y += 30;

  doc.moveTo(50, y).lineTo(562, y).strokeColor("#e0e0e0").stroke();
  y += 10;

  const colDesc = 50;
  const colAmt = 480;
  doc.font("Helvetica-Bold").fontSize(10);
  doc.text("Description", colDesc, y);
  doc.text("Amount", colAmt, y, { width: 82, align: "right" });
  y += 16;
  doc.moveTo(50, y).lineTo(562, y).strokeColor("#cccccc").stroke();
  y += 8;

  doc.font("Helvetica").fontSize(9);
  for (const item of items) {
    if (y > 680) {
      doc.addPage();
      y = 50;
    }
    const desc = item.description || `Trip ${item.tripId}`;
    doc.text(desc, colDesc, y, { width: 420 });
    doc.text(fmtCents(item.amountCents), colAmt, y, { width: 82, align: "right" });
    y += 16;
  }

  if (items.length === 0) {
    doc.text("No line items", colDesc, y);
    y += 16;
  }

  y += 10;
  doc.moveTo(50, y).lineTo(562, y).strokeColor("#e0e0e0").stroke();
  y += 15;

  doc.font("Helvetica").fontSize(10);
  const totalsX = 380;
  const totalsValX = 480;
  const totalsW = 82;

  doc.text("Subtotal:", totalsX, y);
  doc.text(fmtCents(invoice.subtotalCents || 0), totalsValX, y, { width: totalsW, align: "right" });
  y += 18;

  if (invoice.feesCents) {
    doc.text("Fees:", totalsX, y);
    doc.text(fmtCents(invoice.feesCents), totalsValX, y, { width: totalsW, align: "right" });
    y += 18;
  }

  if (invoice.taxCents) {
    doc.text("Tax:", totalsX, y);
    doc.text(fmtCents(invoice.taxCents), totalsValX, y, { width: totalsW, align: "right" });
    y += 18;
  }

  doc.font("Helvetica-Bold").fontSize(12);
  doc.text("Total:", totalsX, y);
  doc.text(fmtCents(invoice.totalCents || 0), totalsValX, y, { width: totalsW, align: "right" });
  y += 22;

  doc.font("Helvetica").fontSize(10);
  doc.text("Amount Paid:", totalsX, y);
  doc.text(fmtCents(invoice.amountPaidCents || 0), totalsValX, y, { width: totalsW, align: "right" });
  y += 18;

  doc.font("Helvetica-Bold").fontSize(12);
  const balanceColor = (invoice.balanceDueCents || 0) > 0 ? "#dc2626" : "#16a34a";
  doc.fillColor(balanceColor);
  doc.text("Balance Due:", totalsX, y);
  doc.text(fmtCents(invoice.balanceDueCents || 0), totalsValX, y, { width: totalsW, align: "right" });
  doc.fillColor("#000000");
  y += 30;

  if (payments.length > 0) {
    if (y > 620) { doc.addPage(); y = 50; }
    doc.font("Helvetica-Bold").fontSize(11).text("Payment History", 50, y);
    y += 18;

    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Date", 50, y);
    doc.text("Method", 200, y);
    doc.text("Reference", 300, y);
    doc.text("Amount", 480, y, { width: 82, align: "right" });
    y += 14;
    doc.moveTo(50, y).lineTo(562, y).strokeColor("#cccccc").stroke();
    y += 6;

    doc.font("Helvetica").fontSize(9);
    for (const pmt of payments) {
      doc.text(fmtDate(pmt.paidAt), 50, y);
      doc.text(pmt.method.toUpperCase(), 200, y);
      doc.text(pmt.reference || "\u2014", 300, y, { width: 170 });
      doc.text(fmtCents(pmt.amountCents), 480, y, { width: 82, align: "right" });
      y += 14;
    }
    y += 10;
  }

  if (y > 700) { doc.addPage(); y = 50; }
  doc.moveTo(50, y).lineTo(562, y).strokeColor(accentColor).stroke();
  y += 15;
  doc.font("Helvetica").fontSize(8).fillColor("#999999");
  doc.text(`${companyName} | ${SUPPORT_EMAIL}`, 50, y, { align: "center", width: 512 });
  y += 12;
  doc.text("Thank you for choosing our medical transportation services.", 50, y, { align: "center", width: 512 });
  doc.fillColor("#000000");

  doc.end();
}
