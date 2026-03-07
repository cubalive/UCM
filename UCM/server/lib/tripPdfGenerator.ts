import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import crypto from "crypto";
import { storage } from "../storage";
import { db } from "../db";
import { trips as tripsTable } from "@shared/schema";
import { eq } from "drizzle-orm";

interface TripPdfData {
  trip: any;
  enriched: any;
  clinicName: string | null;
  patient: any | null;
  cityName: string | null;
  driverName: string | null;
  vehicleLabel: string | null;
  vehicleDetails: string | null;
  licensePlate: string | null;
}

const fmtTime = (isoStr: string | Date | null | undefined): string => {
  if (!isoStr) return "\u2014";
  try {
    const d = new Date(isoStr as string);
    if (isNaN(d.getTime())) return "\u2014";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch { return "\u2014"; }
};

const fmtDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "\u2014";
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  } catch { return dateStr || "\u2014"; }
};

const fmtPickup = (t: string | null | undefined): string => {
  if (!t) return "\u2014";
  try {
    const [h, m] = t.split(":").map(Number);
    const d = new Date(2000, 0, 1, h, m);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch { return t; }
};

export async function generateTripPdf(data: TripPdfData, res: any): Promise<void> {
  const { trip, enriched, clinicName, patient, cityName, driverName, vehicleLabel, vehicleDetails, licensePlate } = data;

  const sig = await storage.getTripSignature(trip.id);

  let verificationToken = trip.verificationToken;
  if (!verificationToken) {
    verificationToken = crypto.randomBytes(24).toString("hex");
    await db.update(tripsTable).set({ verificationToken }).where(eq(tripsTable.id, trip.id));
  }

  const verifyUrl = `${process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://unitedcaremobility.com"}/api/verify/trip/${verificationToken}`;

  let qrDataUrl: string | null = null;
  try {
    qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 120, margin: 1 });
  } catch {}

  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ margin: 50, size: "LETTER", bufferPages: true });

  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const writePromise = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  doc.rect(0, 0, 612, 70).fill("#1a365d");
  doc.fontSize(20).fillColor("#ffffff").text("UNITED CARE MOBILITY", 50, 18, { align: "center" });
  doc.fontSize(10).fillColor("#a0c4ff").text("Non-Emergency Medical Transportation", 50, 42, { align: "center" });

  doc.y = 85;
  doc.fillColor("#1a365d").fontSize(14).text("TRIP REPORT", { align: "center" });
  doc.moveDown(0.2);
  if (clinicName) {
    doc.fontSize(10).fillColor("#444").text(clinicName, { align: "center" });
  }
  doc.moveDown(0.8);

  doc.fillColor("#000").fontSize(11).text(fmtDate(trip.scheduledDate), { align: "left" });
  doc.fontSize(9);
  doc.text(`Trip ID: ${enriched.publicId || trip.id}`);
  if (clinicName) doc.text(`Clinic: ${clinicName}`);
  if (cityName) doc.text(`City: ${cityName}`);
  if (enriched.patientName) doc.text(`Patient: ${enriched.patientName}`);
  const serviceLabel = trip.mobilityRequirement === "WHEELCHAIR" ? "Wheelchair" : trip.mobilityRequirement === "STRETCHER" ? "Stretcher" : trip.mobilityRequirement === "BARIATRIC" ? "Bariatric" : "Sedan";
  doc.text(`Service Type: ${serviceLabel}`);
  if (patient?.wheelchairRequired) doc.text("Special Needs: Wheelchair Required");
  if (patient?.notes) doc.text(`Patient Notes: ${patient.notes}`);
  if (trip.passengerCount && trip.passengerCount > 1) doc.text(`Passengers: ${trip.passengerCount}`);
  const outcomeLabel = trip.status === "COMPLETED" ? "Completed" : trip.status === "NO_SHOW" ? "No Show" : trip.status === "CANCELLED" ? "Cancelled" : trip.status;
  doc.text(`Status: ${outcomeLabel}`);
  if (trip.billingOutcome) doc.text(`Billing Outcome: ${trip.billingOutcome}`);
  if (trip.billingReason) doc.text(`Billing Reason: ${trip.billingReason}`);
  doc.moveDown(0.8);

  drawSectionDivider(doc);

  doc.fontSize(11).fillColor("#1a365d").text("Route");
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor("#000");
  doc.text(`Pickup (A): ${trip.pickupAddress || "\u2014"}`);
  doc.text(`Dropoff (B): ${trip.dropoffAddress || "\u2014"}`);
  if (trip.distanceMiles) doc.text(`Distance: ${parseFloat(trip.distanceMiles as string).toFixed(1)} miles`);
  if (trip.durationMinutes) doc.text(`Est. Duration: ${trip.durationMinutes} min`);
  doc.moveDown(0.5);

  let mapUrl = trip.staticMapFullUrl || trip.staticMapThumbUrl || null;
  if (!mapUrl && trip.pickupLat && trip.pickupLng && trip.dropoffLat && trip.dropoffLng) {
    const gmKey = process.env.GOOGLE_MAPS_API_KEY;
    if (gmKey) {
      const pA = `${trip.pickupLat},${trip.pickupLng}`;
      const pB = `${trip.dropoffLat},${trip.dropoffLng}`;
      mapUrl = `https://maps.googleapis.com/maps/api/staticmap?size=600x300&markers=color:green|label:A|${pA}&markers=color:red|label:B|${pB}&path=color:0x4285F4FF|weight:4|${pA}|${pB}&key=${gmKey}`;
    }
  }
  if (mapUrl) {
    try {
      const mapResponse = await fetch(mapUrl as string);
      if (mapResponse.ok) {
        const mapBuffer = Buffer.from(await mapResponse.arrayBuffer());
        doc.image(mapBuffer, { width: 380, align: "center" });
        doc.moveDown(0.4);
      }
    } catch {}
  }

  drawSectionDivider(doc);

  doc.fontSize(11).fillColor("#1a365d").text("Proof Timeline");
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor("#000");

  const allSteps: { label: string; time: string; reason?: string }[] = [
    { label: "Scheduled Pickup", time: fmtPickup(trip.pickupTime) },
    { label: "Scheduled Dropoff (ETA)", time: fmtPickup(trip.estimatedArrivalTime) },
    { label: "Created", time: fmtTime(trip.createdAt) },
    { label: "Approved", time: fmtTime(trip.approvedAt) },
    { label: "Assigned to Driver", time: fmtTime(trip.assignedAt) },
    { label: "Driver Accepted", time: fmtTime(enriched.acceptedAt) },
    { label: "En Route to Pickup", time: fmtTime(trip.startedAt) },
    { label: "Arrived at Pickup", time: fmtTime(trip.arrivedPickupAt) },
    { label: "Picked Up", time: fmtTime(trip.pickedUpAt) },
    { label: "En Route to Dropoff", time: fmtTime(trip.enRouteDropoffAt) },
    { label: "Arrived at Dropoff", time: fmtTime(trip.arrivedDropoffAt) },
  ];
  if (trip.status === "COMPLETED") {
    allSteps.push({ label: "Completed", time: fmtTime(trip.completedAt) });
  } else if (trip.status === "CANCELLED") {
    allSteps.push({ label: "Cancelled", time: fmtTime(trip.cancelledAt), reason: trip.cancelledReason || undefined });
  } else if (trip.status === "NO_SHOW") {
    allSteps.push({ label: "No-Show", time: fmtTime(trip.cancelledAt), reason: trip.cancelledReason || undefined });
  } else {
    allSteps.push({ label: "Completed", time: "\u2014" });
  }

  let onsiteMinutes: number | null = null;
  if (trip.arrivedPickupAt && trip.completedAt) {
    onsiteMinutes = Math.round((new Date(trip.completedAt).getTime() - new Date(trip.arrivedPickupAt).getTime()) / 60000);
  }
  let transportMinutes: number | null = null;
  if (trip.pickedUpAt && trip.arrivedDropoffAt) {
    transportMinutes = Math.round((new Date(trip.arrivedDropoffAt).getTime() - new Date(trip.pickedUpAt).getTime()) / 60000);
  }

  for (const evt of allSteps) {
    const bullet = evt.time !== "\u2014" ? "\u2713" : "\u2022";
    const color = evt.time !== "\u2014" ? "#16a34a" : "#999";
    doc.fillColor(color).text(`${bullet} `, { continued: true });
    doc.fillColor("#000").text(`${evt.label}: ${evt.time}`);
    if (evt.reason) doc.fillColor("#666").text(`    Reason: ${evt.reason}`).fillColor("#000");
  }

  if (onsiteMinutes != null) { doc.moveDown(0.2); doc.text(`On-Site Duration: ${onsiteMinutes} min`); }
  if (transportMinutes != null) doc.text(`Transport Duration: ${transportMinutes} min`);
  doc.moveDown(0.6);

  drawSectionDivider(doc);

  doc.fontSize(11).fillColor("#1a365d").text("Driver & Vehicle");
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor("#000");
  doc.text(`Driver: ${driverName || "Unassigned"}`);
  if (vehicleLabel) doc.text(`Vehicle: ${vehicleLabel}`);
  if (licensePlate) doc.text(`License Plate: ${licensePlate}`);
  if (vehicleDetails) doc.text(`Details: ${vehicleDetails}`);
  doc.moveDown(0.6);

  drawSectionDivider(doc);

  doc.fontSize(11).fillColor("#1a365d").text("Signatures");
  doc.moveDown(0.3);

  const sigStartY = doc.y;
  const halfWidth = 240;

  doc.fontSize(8).fillColor("#666").text("Driver Signature", 50, sigStartY);
  if (sig?.driverSigBase64) {
    try {
      const sigBuf = Buffer.from(sig.driverSigBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      doc.image(sigBuf, 50, sigStartY + 12, { width: 180, height: 50 });
    } catch {}
    doc.fontSize(7).fillColor("#999").text(
      `Signed: ${sig.driverSignedAt ? new Date(sig.driverSignedAt).toLocaleString("en-US") : "N/A"}`,
      50, sigStartY + 65
    );
  } else {
    doc.fontSize(9).fillColor("#ccc").text("[Not signed]", 50, sigStartY + 25);
  }

  doc.fontSize(8).fillColor("#666").text("Clinic/Patient Signature", 50 + halfWidth + 20, sigStartY);
  if (sig?.clinicSigBase64) {
    try {
      const sigBuf = Buffer.from(sig.clinicSigBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
      doc.image(sigBuf, 50 + halfWidth + 20, sigStartY + 12, { width: 180, height: 50 });
    } catch {}
    doc.fontSize(7).fillColor("#999").text(
      `Signed: ${sig.clinicSignedAt ? new Date(sig.clinicSignedAt).toLocaleString("en-US") : "N/A"}`,
      50 + halfWidth + 20, sigStartY + 65
    );
  } else {
    doc.fontSize(9).fillColor("#ccc").text("[Not signed]", 50 + halfWidth + 20, sigStartY + 25);
  }

  doc.y = sigStartY + 80;
  doc.moveDown(0.6);

  drawSectionDivider(doc);

  const footerY = doc.y;
  doc.fontSize(11).fillColor("#1a365d").text("Verification", 50, footerY);
  doc.moveDown(0.2);

  if (qrDataUrl) {
    try {
      const qrBuf = Buffer.from(qrDataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
      doc.image(qrBuf, 50, doc.y, { width: 80, height: 80 });
    } catch {}
  }

  const qrTextX = qrDataUrl ? 145 : 50;
  doc.fontSize(7).fillColor("#666").text("Scan QR code to verify this document", qrTextX, footerY + 18);
  doc.text(`Verification URL: ${verifyUrl}`, qrTextX, footerY + 30, { width: 350 });
  doc.text(`Token: ${verificationToken.substring(0, 16)}...`, qrTextX, footerY + 42);

  doc.y = Math.max(doc.y, footerY + 90);
  doc.moveDown(0.5);

  doc.fontSize(7).fillColor("#aaa").text(`Generated: ${new Date().toLocaleString("en-US")} | United Care Mobility`, { align: "center" });
  doc.text("This document is digitally verifiable. Tampering will invalidate the hash.", { align: "center" });

  doc.end();

  const pdfBuffer = await writePromise;

  const pdfHash = crypto.createHash("sha256").update(pdfBuffer).digest("hex");
  await db.update(tripsTable).set({ pdfHash }).where(eq(tripsTable.id, trip.id));

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="trip-${enriched.publicId || trip.id}.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-PDF-Hash", pdfHash);
  res.end(pdfBuffer);
}

function drawSectionDivider(doc: PDFKit.PDFDocument) {
  doc.moveTo(50, doc.y).lineTo(560, doc.y).stroke("#e0e0e0");
  doc.moveDown(0.4);
}
