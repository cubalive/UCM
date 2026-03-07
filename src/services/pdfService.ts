import PDFDocument from "pdfkit";
import { getDb } from "../db/index.js";
import { invoices, invoiceLineItems, tenants, patients } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import logger from "../lib/logger.js";
import { formatDateForPdf, DEFAULT_TIMEZONE } from "../lib/timezone.js";

export async function generateInvoicePdf(invoiceId: string, tenantId: string): Promise<Buffer> {
  const db = getDb();

  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));

  if (!invoice) throw new Error("Invoice not found");

  const lineItems = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId));

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));

  let patient = null;
  if (invoice.patientId) {
    const [p] = await db.select().from(patients).where(eq(patients.id, invoice.patientId));
    patient = p;
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fontSize(20).text(tenant?.name || "United Care Mobility", { align: "center" });
    doc.moveDown();
    doc.fontSize(16).text(`Invoice ${invoice.invoiceNumber}`, { align: "center" });
    doc.moveDown();

    // Invoice details
    doc.fontSize(10);
    const tz = tenant?.timezone || DEFAULT_TIMEZONE;
    doc.text(`Date: ${formatDateForPdf(invoice.createdAt, tz)}`);
    if (invoice.dueDate) {
      doc.text(`Due Date: ${formatDateForPdf(invoice.dueDate, tz)}`);
    }
    doc.text(`Status: ${invoice.status.toUpperCase()}`);
    if (invoice.billingPeriodStart && invoice.billingPeriodEnd) {
      doc.text(
        `Billing Period: ${formatDateForPdf(invoice.billingPeriodStart, tz)} - ${formatDateForPdf(invoice.billingPeriodEnd, tz)}`
      );
    }
    doc.moveDown();

    // Patient info
    if (patient) {
      doc.text(`Bill To: ${patient.firstName} ${patient.lastName}`);
      if (patient.address) doc.text(patient.address);
      doc.moveDown();
    }

    // Line items table
    const tableTop = doc.y;
    doc.font("Helvetica-Bold");
    doc.text("Description", 50, tableTop);
    doc.text("Qty", 350, tableTop, { width: 50, align: "right" });
    doc.text("Unit Price", 400, tableTop, { width: 70, align: "right" });
    doc.text("Amount", 470, tableTop, { width: 70, align: "right" });

    doc.moveTo(50, tableTop + 15).lineTo(540, tableTop + 15).stroke();

    doc.font("Helvetica");
    let y = tableTop + 25;

    for (const item of lineItems) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      doc.text(item.description, 50, y, { width: 290 });
      doc.text(item.quantity || "1", 350, y, { width: 50, align: "right" });
      doc.text(`$${Number(item.unitPrice).toFixed(2)}`, 400, y, { width: 70, align: "right" });
      doc.text(`$${Number(item.amount).toFixed(2)}`, 470, y, { width: 70, align: "right" });
      y += 20;
    }

    // Totals
    y += 10;
    doc.moveTo(350, y).lineTo(540, y).stroke();
    y += 10;
    doc.text("Subtotal:", 350, y, { width: 120, align: "right" });
    doc.text(`$${Number(invoice.subtotal).toFixed(2)}`, 470, y, { width: 70, align: "right" });
    y += 15;
    if (Number(invoice.tax) > 0) {
      doc.text("Tax:", 350, y, { width: 120, align: "right" });
      doc.text(`$${Number(invoice.tax).toFixed(2)}`, 470, y, { width: 70, align: "right" });
      y += 15;
    }
    doc.font("Helvetica-Bold");
    doc.text("Total:", 350, y, { width: 120, align: "right" });
    doc.text(`$${Number(invoice.total).toFixed(2)}`, 470, y, { width: 70, align: "right" });
    y += 15;
    if (Number(invoice.amountPaid) > 0) {
      doc.font("Helvetica");
      doc.text("Amount Paid:", 350, y, { width: 120, align: "right" });
      doc.text(`$${Number(invoice.amountPaid).toFixed(2)}`, 470, y, { width: 70, align: "right" });
      y += 15;
      const remaining = Number(invoice.total) - Number(invoice.amountPaid);
      doc.font("Helvetica-Bold");
      doc.text("Amount Due:", 350, y, { width: 120, align: "right" });
      doc.text(`$${remaining.toFixed(2)}`, 470, y, { width: 70, align: "right" });
    }

    doc.end();
  });
}
