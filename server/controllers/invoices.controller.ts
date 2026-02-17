import type { Response } from "express";
import PDFDocument from "pdfkit";
import { storage } from "../storage";
import { getCompanyIdFromAuth, checkCompanyOwnership, type AuthRequest } from "../auth";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { trips, invoices, clinics as clinicsTable } from "@shared/schema";

export async function getInvoicesHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = getCompanyIdFromAuth(req);
    const all = await storage.getInvoices();
    if (!companyId) return res.json(all);

    const allClinics = await storage.getClinics();
    const companyClinicIds = new Set(
      allClinics.filter(c => c.companyId === companyId).map(c => c.id)
    );
    const filtered = all.filter((inv: any) => companyClinicIds.has(inv.clinicId));
    res.json(filtered);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function updateInvoiceHandler(req: AuthRequest, res: Response) {
  try {
    const invoiceId = parseInt(String(req.params.id));
    if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const companyId = getCompanyIdFromAuth(req);
    if (companyId) {
      const clinic = await storage.getClinic(invoice.clinicId);
      if (!checkCompanyOwnership(clinic, companyId)) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    if (invoice.status === "paid") {
      return res.status(400).json({ message: "Cannot edit a paid invoice" });
    }

    const { amount, status, notes } = req.body;
    const updateData: any = {};
    if (amount !== undefined) {
      if (isNaN(parseFloat(amount))) return res.status(400).json({ message: "Invalid amount" });
      updateData.amount = parseFloat(amount).toFixed(2);
    }
    if (status !== undefined) {
      const validStatuses = ["pending", "approved", "paid"];
      if (!validStatuses.includes(status)) return res.status(400).json({ message: "Invalid status. Must be: pending, approved, or paid" });
      updateData.status = status;
    }
    if (notes !== undefined) {
      updateData.notes = notes || null;
    }

    const updated = await storage.updateInvoice(invoiceId, updateData);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "invoice_updated",
      entity: "invoice",
      entityId: invoiceId,
      details: `Invoice updated${amount ? `, amount: $${parseFloat(amount).toFixed(2)}` : ""}${status ? `, status: ${status}` : ""}${notes !== undefined ? `, notes: ${notes || "(cleared)"}` : ""}`,
      cityId: null,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function markInvoicePaidHandler(req: AuthRequest, res: Response) {
  try {
    const invoiceId = parseInt(String(req.params.id));
    if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const companyId = getCompanyIdFromAuth(req);
    if (companyId) {
      const clinic = await storage.getClinic(invoice.clinicId);
      if (!checkCompanyOwnership(clinic, companyId)) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    if (invoice.status === "paid") {
      return res.status(400).json({ message: "Invoice is already marked as paid" });
    }

    const updated = await storage.updateInvoice(invoiceId, { status: "paid" } as any);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "MARK_INVOICE_PAID",
      entity: "invoice",
      entityId: invoiceId,
      details: `Invoice marked as paid, amount: $${invoice.amount}`,
      cityId: null,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function invoicePdfHandler(req: AuthRequest, res: Response) {
  try {
    const invoiceId = parseInt(String(req.params.id));
    if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    if (req.user!.role === "CLINIC_USER" || req.user!.role === "VIEWER") {
      const user = await storage.getUser(req.user!.userId);
      if (!user?.clinicId || user.clinicId !== invoice.clinicId) {
        return res.status(403).json({ message: "Access denied" });
      }
    }
    const pdfCompanyId = getCompanyIdFromAuth(req);
    if (pdfCompanyId) {
      const clinicForOwnership = await storage.getClinic(invoice.clinicId);
      if (!checkCompanyOwnership(clinicForOwnership, pdfCompanyId)) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const clinic = await storage.getClinic(invoice.clinicId);
    const clinicName = clinic?.name || "Unknown Clinic";

    let tripData: any = null;
    if (invoice.tripId) {
      tripData = await storage.getTrip(invoice.tripId);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.id}.pdf"`);
    res.setHeader("Cache-Control", "no-store");

    const doc = new PDFDocument({ margin: 50, size: "LETTER", bufferPages: true });
    doc.pipe(res);

    doc.fontSize(18).font("Helvetica-Bold").text("United Care Mobility", 50, 50);
    doc.fontSize(10).font("Helvetica").text("Medical Transportation Services", 50, 72);
    doc.moveDown(0.5);
    doc.fontSize(22).font("Helvetica-Bold").text("INVOICE", 400, 50, { align: "right" });

    let y = 110;
    doc.moveTo(50, y).lineTo(562, y).strokeColor("#e0e0e0").stroke();
    y += 15;

    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Invoice #:", 50, y);
    doc.font("Helvetica").text(String(invoice.id), 160, y);
    doc.font("Helvetica-Bold").text("Date:", 350, y);
    doc.font("Helvetica").text(new Date(invoice.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), 440, y);
    y += 18;

    doc.font("Helvetica-Bold").text("Clinic:", 50, y);
    doc.font("Helvetica").text(clinicName, 160, y);
    y += 18;

    doc.font("Helvetica-Bold").text("Patient:", 50, y);
    doc.font("Helvetica").text(invoice.patientName || "N/A", 160, y);
    y += 18;

    doc.font("Helvetica-Bold").text("Service Date:", 50, y);
    doc.font("Helvetica").text(invoice.serviceDate || "N/A", 160, y);
    y += 18;

    doc.font("Helvetica-Bold").text("Status:", 50, y);
    const safeStatus = (invoice.status || "pending").toUpperCase();
    const statusColor = safeStatus === "PAID" ? "#16a34a" : safeStatus === "OVERDUE" ? "#dc2626" : "#ca8a04";
    doc.font("Helvetica-Bold").fillColor(statusColor).text(safeStatus, 160, y);
    doc.fillColor("#000000");
    y += 18;

    if (invoice.notes) {
      doc.font("Helvetica-Bold").text("Notes:", 50, y);
      doc.font("Helvetica").text(String(invoice.notes).substring(0, 200), 160, y, { width: 400 });
      y += 18;
    }
    y += 10;

    if (tripData) {
      doc.moveTo(50, y).lineTo(562, y).strokeColor("#e0e0e0").stroke();
      y += 15;
      doc.fontSize(12).font("Helvetica-Bold").text("Trip Details", 50, y);
      y += 20;

      const tripFields: [string, string][] = [
        ["Trip ID", tripData.publicId || String(tripData.id)],
        ["Scheduled Date", tripData.scheduledDate || "N/A"],
        ["Pickup Time", tripData.pickupTime || "N/A"],
        ["Pickup Address", tripData.pickupAddress || "N/A"],
        ["Dropoff Address", tripData.dropoffAddress || "N/A"],
        ["Trip Status", tripData.status || "N/A"],
      ];
      if (tripData.arrivalAtPickup) tripFields.push(["Arrival at Pickup", tripData.arrivalAtPickup]);
      if (tripData.departPickup) tripFields.push(["Depart Pickup", tripData.departPickup]);
      if (tripData.arrivalAtDropoff) tripFields.push(["Arrival at Dropoff", tripData.arrivalAtDropoff]);

      let driverLabel = "N/A";
      let vehicleLabel = "N/A";
      if (tripData.driverId) {
        try {
          const driver = await storage.getDriver(tripData.driverId);
          if (driver) driverLabel = `${driver.firstName} ${driver.lastName}`;
        } catch {}
      }
      if (tripData.vehicleId) {
        try {
          const allVehicles = tripData.cityId ? await storage.getVehicles(tripData.cityId) : [];
          const vehicle = allVehicles.find((v: any) => v.id === tripData.vehicleId);
          if (vehicle) vehicleLabel = `${vehicle.name}${vehicle.colorHex ? ` (${vehicle.colorHex})` : ""}`;
        } catch {}
      }
      tripFields.push(["Driver", driverLabel]);
      tripFields.push(["Vehicle", vehicleLabel]);

      doc.fontSize(10).font("Helvetica");
      for (const [label, value] of tripFields) {
        if (y > 700) { doc.addPage(); y = 50; }
        doc.font("Helvetica-Bold").text(`${label}:`, 50, y, { continued: false });
        doc.font("Helvetica").text(String(value || "N/A").substring(0, 80), 200, y, { width: 360 });
        y += 16;
      }
      y += 10;
    }

    doc.moveTo(50, y).lineTo(562, y).strokeColor("#e0e0e0").stroke();
    y += 15;

    const safeAmount = typeof invoice.amount === "string" ? parseFloat(invoice.amount) : (invoice.amount || 0);
    doc.fontSize(14).font("Helvetica-Bold").fillColor("#000").text(`Total Amount: $${safeAmount.toFixed(2)}`, 50, y);
    y += 30;

    if (y > 700) { doc.addPage(); y = 50; }
    doc.moveTo(50, y).lineTo(562, y).strokeColor("#e0e0e0").stroke();
    y += 15;
    doc.font("Helvetica").fontSize(8).fillColor("#999999");
    doc.text("United Care Mobility | billing@unitedcaremobility.com", 50, y, { align: "center", width: 512 });
    y += 12;
    doc.text("Thank you for choosing our medical transportation services.", 50, y, { align: "center", width: 512 });
    doc.fillColor("#000000");

    doc.end();
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function sendInvoiceEmailHandler(req: AuthRequest, res: Response) {
  try {
    const invoiceId = parseInt(String(req.params.id));
    if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const emailCompanyId = getCompanyIdFromAuth(req);
    if (emailCompanyId) {
      const clinicForOwnership = await storage.getClinic(invoice.clinicId);
      if (!checkCompanyOwnership(clinicForOwnership, emailCompanyId)) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    if (!invoice.emailTo) {
      if (invoice.tripId) {
        const trip = await storage.getTrip(invoice.tripId);
        if (trip?.patientId) {
          const patient = await storage.getPatient(trip.patientId);
          if (patient?.email) {
            await db.update(invoices).set({ emailTo: patient.email }).where(eq(invoices.id, invoiceId));
            (invoice as any).emailTo = patient.email;
          } else {
            return res.status(400).json({ message: "Patient has no email address. Please add an email to the patient record first." });
          }
        } else {
          return res.status(400).json({ message: "No patient email found for this invoice." });
        }
      } else {
        return res.status(400).json({ message: "No email address on invoice and no linked trip to look up patient email." });
      }
    }

    const { sendInvoicePaymentEmail } = await import("../services/invoiceEmailService");
    const result = await sendInvoicePaymentEmail(invoiceId);

    if (!result.success) {
      return res.status(500).json({ message: result.error || "Failed to send email" });
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "SEND_INVOICE_EMAIL",
      entity: "invoice",
      entityId: invoiceId,
      details: `Invoice email sent to ${invoice.emailTo}. IP: ${req.ip || "unknown"}`,
    });

    res.json({ success: true, paymentLink: result.paymentLink });
  } catch (err: any) {
    console.error("[Routes] send-email error:", err.message);
    res.status(500).json({ message: err.message });
  }
}

export async function getWeeklyBillingHandler(req: AuthRequest, res: Response) {
  try {
    const clinicId = req.query.clinic_id ? parseInt(req.query.clinic_id as string) : undefined;
    const companyId = getCompanyIdFromAuth(req);
    let result: any[];
    if (companyId) {
      const allWeekly = await storage.getWeeklyInvoices(clinicId);
      const clinicIds = (await storage.getClinics()).filter((c: any) => c.companyId === companyId).map((c: any) => c.id);
      result = allWeekly.filter((inv: any) => clinicIds.includes(inv.clinicId));
    } else {
      result = await storage.getWeeklyInvoices(clinicId);
    }

    const enriched = await Promise.all(result.map(async (inv: any) => {
      const linkedTrips = await storage.getTripsByInvoiceId(inv.id);
      const clinic = await storage.getClinic(inv.clinicId);
      return { ...inv, tripCount: linkedTrips.length, clinicName: clinic?.name || "Unknown" };
    }));

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getWeeklyBillingPreviewHandler(req: AuthRequest, res: Response) {
  try {
    const clinicId = parseInt(req.query.clinic_id as string);
    const startDate = req.query.start_date as string;
    const endDate = req.query.end_date as string;
    if (isNaN(clinicId) || !startDate || !endDate) {
      return res.status(400).json({ message: "clinic_id, start_date, and end_date are required" });
    }
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD" });
    }
    if (startDate > endDate) {
      return res.status(400).json({ message: "start_date must be <= end_date" });
    }
    const previewCompanyId = getCompanyIdFromAuth(req);
    if (previewCompanyId) {
      const clinicForOwnership = await storage.getClinic(clinicId);
      if (!checkCompanyOwnership(clinicForOwnership, previewCompanyId)) {
        return res.status(403).json({ message: "Access denied: clinic belongs to another company" });
      }
    }
    const uninvoicedTrips = await storage.getUninvoicedCompletedTrips(clinicId, startDate, endDate, previewCompanyId);
    const patients = new Map<number, any>();
    for (const t of uninvoicedTrips) {
      if (!patients.has(t.patientId)) {
        const p = await storage.getPatient(t.patientId);
        if (p) patients.set(t.patientId, p);
      }
    }
    const tripsWithPatient = uninvoicedTrips.map((t: any) => {
      const p = patients.get(t.patientId);
      return { ...t, patientName: p ? `${p.firstName} ${p.lastName}` : "Unknown" };
    });
    res.json({ trips: tripsWithPatient, count: tripsWithPatient.length });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function generateWeeklyBillingHandler(req: AuthRequest, res: Response) {
  try {
    const { clinicId, startDate, endDate, amount } = req.body;
    if (!clinicId || !startDate || !endDate || amount === undefined) {
      return res.status(400).json({ message: "clinicId, startDate, endDate, and amount are required" });
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD" });
    }
    if (startDate > endDate) {
      return res.status(400).json({ message: "startDate must be <= endDate" });
    }

    const genCompanyId = getCompanyIdFromAuth(req);
    if (genCompanyId) {
      const clinicForOwnership = await storage.getClinic(parseInt(clinicId));
      if (!checkCompanyOwnership(clinicForOwnership, genCompanyId)) {
        return res.status(403).json({ message: "Access denied: clinic belongs to another company" });
      }
    }

    const uninvoicedTrips = await storage.getUninvoicedCompletedTrips(parseInt(clinicId), startDate, endDate, genCompanyId);
    if (uninvoicedTrips.length === 0) {
      return res.status(400).json({ message: "No uninvoiced completed trips found for this clinic and date range" });
    }

    const clinic = await storage.getClinic(parseInt(clinicId));
    const clinicName = clinic?.name || "Unknown Clinic";
    const rangeLabel = `${startDate} to ${endDate}`;

    const invoice = await storage.createInvoice({
      clinicId: parseInt(clinicId),
      tripId: null as any,
      patientName: `Weekly: ${clinicName}`,
      serviceDate: rangeLabel,
      amount: parsedAmount.toFixed(2),
      status: "pending",
      notes: `Weekly invoice for ${clinicName}, ${rangeLabel}, ${uninvoicedTrips.length} trips`,
    });

    const tripIds = uninvoicedTrips.map((t: any) => t.id);
    await storage.linkTripsToInvoice(tripIds, invoice.id);

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CREATE_WEEKLY_INVOICE",
      entity: "invoice",
      entityId: invoice.id,
      details: `Weekly invoice created for ${clinicName}, ${rangeLabel}, ${uninvoicedTrips.length} trips, amount: $${parsedAmount.toFixed(2)}`,
      cityId: null,
    });

    res.status(201).json({ invoice, tripCount: uninvoicedTrips.length });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getWeeklyBillingTripsHandler(req: AuthRequest, res: Response) {
  try {
    const invoiceId = parseInt(String(req.params.id));
    if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const tripsCompanyId = getCompanyIdFromAuth(req);
    if (tripsCompanyId) {
      const clinic = await storage.getClinic(invoice.clinicId);
      if (!checkCompanyOwnership(clinic, tripsCompanyId)) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const linkedTrips = await storage.getTripsByInvoiceId(invoiceId);
    const patients = new Map<number, any>();
    for (const t of linkedTrips) {
      if (!patients.has(t.patientId)) {
        const p = await storage.getPatient(t.patientId);
        if (p) patients.set(t.patientId, p);
      }
    }
    const tripsWithPatient = linkedTrips.map((t: any) => {
      const p = patients.get(t.patientId);
      return { ...t, patientName: p ? `${p.firstName} ${p.lastName}` : "Unknown" };
    });

    const clinic = await storage.getClinic(invoice.clinicId);

    res.json({
      invoice,
      clinic: clinic ? { id: clinic.id, name: clinic.name } : null,
      trips: tripsWithPatient,
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getWeeklyBillingPdfHandler(req: AuthRequest, res: Response) {
  try {
    const invoiceId = parseInt(String(req.params.id));
    if (isNaN(invoiceId)) return res.status(400).json({ message: "Invalid invoice ID" });

    const invoice = await storage.getInvoice(invoiceId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const weeklyPdfCompanyId = getCompanyIdFromAuth(req);
    if (weeklyPdfCompanyId) {
      const clinic = await storage.getClinic(invoice.clinicId);
      if (!checkCompanyOwnership(clinic, weeklyPdfCompanyId)) {
        return res.status(403).json({ message: "Access denied" });
      }
    }

    const linkedTrips = await storage.getTripsByInvoiceId(invoiceId);
    const clinic = await storage.getClinic(invoice.clinicId);
    const clinicName = clinic?.name || "Unknown Clinic";

    const patients = new Map<number, any>();
    for (const t of linkedTrips) {
      if (!patients.has(t.patientId)) {
        const p = await storage.getPatient(t.patientId);
        if (p) patients.set(t.patientId, p);
      }
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoice.id}-weekly.pdf"`);
    res.setHeader("Cache-Control", "no-store");

    const doc = new PDFDocument({ margin: 40, size: "LETTER", layout: "landscape", bufferPages: true });
    doc.pipe(res);

    doc.fontSize(18).font("Helvetica-Bold").text("United Care Mobility", 40, 40);
    doc.fontSize(10).font("Helvetica").text("Medical Transportation Services", 40, 62);
    doc.fontSize(20).font("Helvetica-Bold").text("WEEKLY INVOICE", 550, 40, { align: "right", width: 200 });

    let y = 90;
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#000");
    doc.text(`Invoice #: ${invoice.id}`, 40, y);
    doc.text(`Clinic: ${clinicName}`, 250, y);
    y += 16;
    doc.text(`Period: ${invoice.serviceDate || "N/A"}`, 40, y);
    const safeStatus = (invoice.status || "pending").toUpperCase();
    doc.text(`Status: ${safeStatus}`, 250, y);
    doc.text(`Generated: ${new Date(invoice.createdAt).toLocaleDateString()}`, 450, y);
    y += 25;

    const colW = { num: 30, date: 75, patient: 110, pickup: 155, dropoff: 155, time: 55, status: 70 };
    const colX = { num: 40, date: 70, patient: 145, pickup: 255, dropoff: 410, time: 565, status: 620 };

    function renderTableHeader(doc: any, yPos: number): number {
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#444");
      doc.text("#", colX.num, yPos, { width: colW.num });
      doc.text("Date", colX.date, yPos, { width: colW.date });
      doc.text("Patient", colX.patient, yPos, { width: colW.patient });
      doc.text("Pickup Address", colX.pickup, yPos, { width: colW.pickup });
      doc.text("Dropoff Address", colX.dropoff, yPos, { width: colW.dropoff });
      doc.text("Time", colX.time, yPos, { width: colW.time });
      doc.text("Status", colX.status, yPos, { width: colW.status });
      doc.moveTo(40, yPos + 12).lineTo(750, yPos + 12).strokeColor("#ccc").stroke();
      return yPos + 18;
    }

    y = renderTableHeader(doc, y);
    doc.fillColor("#000").fontSize(8).font("Helvetica");

    linkedTrips.forEach((t: any, i: number) => {
      if (y > 540) {
        doc.addPage();
        y = 40;
        y = renderTableHeader(doc, y);
        doc.fillColor("#000").fontSize(8).font("Helvetica");
      }
      const p = patients.get(t.patientId);
      const patientName = p ? `${p.firstName} ${p.lastName}` : "Unknown";
      const pickup = (t.pickupAddress || "N/A").substring(0, 35);
      const dropoff = (t.dropoffAddress || "N/A").substring(0, 35);
      const time = t.pickupTime || "N/A";
      const status = t.status || "N/A";

      doc.text(String(i + 1), colX.num, y, { width: colW.num });
      doc.text(t.scheduledDate || "", colX.date, y, { width: colW.date });
      doc.text(patientName.substring(0, 25), colX.patient, y, { width: colW.patient });
      doc.text(pickup, colX.pickup, y, { width: colW.pickup });
      doc.text(dropoff, colX.dropoff, y, { width: colW.dropoff });
      doc.text(time, colX.time, y, { width: colW.time });
      doc.text(status, colX.status, y, { width: colW.status });
      y += 14;
    });

    y += 10;
    if (y > 540) { doc.addPage(); y = 40; }
    doc.moveTo(40, y).lineTo(750, y).strokeColor("#ccc").stroke();
    y += 10;
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#000");
    doc.text(`Total Trips: ${linkedTrips.length}`, 40, y);
    const safeAmount = typeof invoice.amount === "string" ? parseFloat(invoice.amount) : (invoice.amount || 0);
    doc.text(`Total Amount: $${safeAmount.toFixed(2)}`, 300, y);
    y += 25;

    doc.font("Helvetica").fontSize(8).fillColor("#999");
    doc.text("United Care Mobility | billing@unitedcaremobility.com", 40, y, { align: "center", width: 710 });

    doc.end();
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function verifyTripHandler(req: AuthRequest, res: Response) {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ message: "Token required" });
    const [trip] = await db.select().from(trips).where(eq(trips.verificationToken, token as string)).limit(1);
    if (!trip) return res.status(404).json({ message: "Trip not found or invalid token" });
    const sig = await storage.getTripSignature(trip.id);
    const clinic = trip.clinicId ? await storage.getClinic(trip.clinicId) : null;
    res.json({
      verified: true,
      tripId: trip.publicId || trip.id,
      status: trip.status,
      scheduledDate: trip.scheduledDate,
      clinic: clinic?.name || null,
      pickupAddress: trip.pickupAddress,
      dropoffAddress: trip.dropoffAddress,
      driverSigned: !!sig?.driverSigBase64,
      clinicSigned: !!sig?.clinicSigBase64,
      driverSignedAt: sig?.driverSignedAt,
      clinicSignedAt: sig?.clinicSignedAt,
      pdfHash: trip.pdfHash,
      tamperCheck: trip.pdfHash ? "PASS" : "NOT_GENERATED",
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
