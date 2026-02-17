import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import crypto from "crypto";
import { db } from "../db";
import { trips as tripsTable, tripPdfs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { storage } from "../storage";

interface PdfJobPayload {
  tripId: number;
  companyId?: number | null;
  userId?: number;
}

export async function processPdfJob(job: any): Promise<Record<string, unknown>> {
  const payload = job.payload as PdfJobPayload;
  const { tripId, companyId } = payload;

  if (!tripId) throw new Error("Missing tripId in job payload");

  const trip = await storage.getTrip(tripId);
  if (!trip) throw new Error(`Trip ${tripId} not found`);

  const clinic = trip.clinicId ? await storage.getClinic(trip.clinicId) : null;
  const patient = trip.patientId ? await storage.getPatient(trip.patientId) : null;
  const allCities = await storage.getCities();
  const city = allCities.find(c => c.id === trip.cityId);

  let driverName: string | null = null;
  let vehicleLabel: string | null = null;
  let vehicleDetails: string | null = null;
  let licensePlate: string | null = null;

  if (trip.driverId) {
    const driver = await storage.getDriver(trip.driverId);
    if (driver) driverName = `${driver.firstName} ${driver.lastName}`;
  }
  if (trip.vehicleId) {
    const vehicle = await storage.getVehicle(trip.vehicleId);
    if (vehicle) {
      vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || vehicle.licensePlate || null;
      vehicleDetails = [vehicle.make, vehicle.model].filter(Boolean).join(" ") || null;
      licensePlate = vehicle.licensePlate;
    }
  }

  const enriched = (trip as any).enriched || {};
  const sig = await storage.getTripSignature(trip.id);

  let verificationToken = (trip as any).verificationToken;
  if (!verificationToken) {
    verificationToken = crypto.randomBytes(24).toString("hex");
    await db.update(tripsTable).set({ verificationToken }).where(eq(tripsTable.id, trip.id));
  }

  const verifyUrl = `${process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://unitedcaremobility.com"}/api/verify/trip/${verificationToken}`;

  let qrDataUrl: string | null = null;
  try {
    qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 120, margin: 1 });
  } catch {}

  const pdfBuffer = await generatePdfBuffer({
    trip,
    enriched,
    clinicName: clinic?.name || null,
    patient,
    cityName: city?.name || null,
    driverName,
    vehicleLabel,
    vehicleDetails,
    licensePlate,
    sig,
    qrDataUrl,
    verifyUrl,
  });

  const base64 = pdfBuffer.toString("base64");
  await db.insert(tripPdfs).values({
    companyId: companyId ?? null,
    tripId,
    jobId: job.id,
    contentType: "application/pdf",
    bytes: base64,
  });

  return {
    tripId,
    pdfSizeBytes: pdfBuffer.length,
    storedAt: new Date().toISOString(),
  };
}

function generatePdfBuffer(data: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { trip, clinicName, patient, cityName, driverName, vehicleLabel, vehicleDetails, licensePlate, sig, qrDataUrl, verifyUrl } = data;
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 50, size: "LETTER", bufferPages: true });

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.rect(0, 0, 612, 70).fill("#1a365d");
    doc.fontSize(20).fillColor("#ffffff").text("UNITED CARE MOBILITY", 50, 18, { align: "center" });
    doc.fontSize(10).fillColor("#a0c4ff").text("Non-Emergency Medical Transportation", 50, 42, { align: "center" });

    doc.y = 85;
    doc.fillColor("#1a365d").fontSize(14).text("TRIP REPORT", { align: "center" });
    doc.moveDown(0.5);

    const fmtDate = (s: string | null) => {
      if (!s) return "\u2014";
      try {
        const [y, m, d] = s.split("-").map(Number);
        return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
      } catch { return s; }
    };

    const fmtPickup = (t: string | null) => {
      if (!t) return "\u2014";
      try {
        const [h, m] = t.split(":").map(Number);
        const d = new Date(2000, 0, 1, h, m);
        return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
      } catch { return t; }
    };

    const leftCol = 60;
    const rightCol = 320;
    let y = doc.y;

    doc.fillColor("#333333").fontSize(10);
    const fields = [
      ["Trip ID", trip.publicId || `#${trip.id}`],
      ["Date", fmtDate(trip.date)],
      ["Pickup Time", fmtPickup(trip.pickupTime)],
      ["Status", trip.status],
      ["City", cityName || "\u2014"],
      ["Clinic", clinicName || "\u2014"],
      ["Patient", patient ? `${patient.firstName} ${patient.lastName}` : "\u2014"],
      ["Driver", driverName || "\u2014"],
      ["Vehicle", vehicleLabel || "\u2014"],
      ["License Plate", licensePlate || "\u2014"],
    ];

    for (const [label, value] of fields) {
      doc.font("Helvetica-Bold").text(`${label}:`, leftCol, y);
      doc.font("Helvetica").text(String(value), rightCol, y);
      y += 16;
    }

    doc.y = y + 10;
    doc.font("Helvetica-Bold").text("Pickup:", leftCol);
    doc.font("Helvetica").text(trip.pickupAddress || "\u2014", leftCol + 60, doc.y - 12);
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").text("Dropoff:", leftCol);
    doc.font("Helvetica").text(trip.dropoffAddress || "\u2014", leftCol + 60, doc.y - 12);

    if (sig) {
      doc.moveDown(1);
      doc.font("Helvetica-Bold").text("Signatures", leftCol);
      doc.moveDown(0.3);
      if (sig.driverSigBase64) {
        doc.font("Helvetica").text("Driver: Signed", leftCol);
      }
      if (sig.clinicSigBase64) {
        doc.font("Helvetica").text("Clinic/Patient: Signed", leftCol);
      }
    }

    if (qrDataUrl) {
      try {
        const qrBuf = Buffer.from(qrDataUrl.split(",")[1], "base64");
        doc.image(qrBuf, 460, doc.y - 40, { width: 80 });
      } catch {}
    }

    doc.moveDown(2);
    doc.fontSize(7).fillColor("#888888").text(`Generated: ${new Date().toISOString()}`, leftCol);
    doc.text(`Verify: ${verifyUrl}`, leftCol);

    doc.end();
  });
}
