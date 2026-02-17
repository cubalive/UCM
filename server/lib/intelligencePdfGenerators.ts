import PDFDocument from "pdfkit";

const BRAND_COLOR = "#1a365d";
const HEADER_BG = "#2563eb";
const LIGHT_BG = "#f1f5f9";
const BORDER_COLOR = "#cbd5e1";

function createDoc(): PDFKit.PDFDocument {
  return new PDFDocument({ size: "LETTER", margin: 40, bufferPages: true });
}

function addHeader(doc: PDFKit.PDFDocument, title: string, subtitle?: string) {
  doc.rect(0, 0, 612, 70).fill(BRAND_COLOR);
  doc.fontSize(18).fillColor("white").text("UCM National Measurement System", 40, 20);
  doc.fontSize(11).text(title, 40, 42);
  if (subtitle) doc.fontSize(9).text(subtitle, 40, 56);
  doc.fillColor("black").moveDown(2);
  doc.y = 85;
}

function addFooter(doc: PDFKit.PDFDocument) {
  const y = doc.page.height - 30;
  doc.fontSize(7).fillColor("#94a3b8").text(`Generated ${new Date().toISOString()} | UCM Confidential`, 40, y);
}

function addSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor(BRAND_COLOR).text(title);
  doc.moveDown(0.3);
  doc.fillColor("black");
}

function addTable(doc: PDFKit.PDFDocument, headers: string[], rows: string[][], colWidths: number[]) {
  const startX = 40;
  let y = doc.y;
  const rowHeight = 16;

  doc.rect(startX, y, colWidths.reduce((a, b) => a + b, 0), rowHeight).fill(LIGHT_BG);
  let x = startX;
  for (let i = 0; i < headers.length; i++) {
    doc.fontSize(8).fillColor(BRAND_COLOR).text(headers[i], x + 3, y + 3, { width: colWidths[i] - 6 });
    x += colWidths[i];
  }
  y += rowHeight;

  for (const row of rows) {
    if (y > doc.page.height - 60) {
      doc.addPage();
      addFooter(doc);
      y = 40;
    }
    x = startX;
    for (let i = 0; i < row.length; i++) {
      doc.fontSize(8).fillColor("black").text(row[i] || "-", x + 3, y + 3, { width: colWidths[i] - 6 });
      x += colWidths[i];
    }
    y += rowHeight;
  }
  doc.y = y + 5;
}

export async function generateCertificationPdf(data: {
  quarterKey: string;
  certifications: { clinicName: string; certLevel: string; score: number; breakdown: any }[];
}): Promise<Buffer> {
  const doc = createDoc();
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  addHeader(doc, `Certification Report — ${data.quarterKey}`, `${data.certifications.length} clinics evaluated`);
  addFooter(doc);

  addSectionTitle(doc, "Certification Summary");
  const levels = { PLATINUM: 0, GOLD: 0, SILVER: 0, AT_RISK: 0 };
  for (const c of data.certifications) {
    if (c.certLevel in levels) (levels as any)[c.certLevel]++;
  }
  doc.fontSize(9).text(`Platinum: ${levels.PLATINUM}  |  Gold: ${levels.GOLD}  |  Silver: ${levels.SILVER}  |  At Risk: ${levels.AT_RISK}`);
  doc.moveDown(0.5);

  addSectionTitle(doc, "Clinic Certifications");
  addTable(
    doc,
    ["Clinic", "Level", "Score", "TRI", "Completion", "On-Time", "Audit Ready"],
    data.certifications.map((c) => [
      c.clinicName,
      c.certLevel,
      String(c.score),
      String(c.breakdown?.tri || 0),
      String(c.breakdown?.completionRate || 0) + "%",
      String(c.breakdown?.onTimeRate || 0) + "%",
      String(c.breakdown?.auditReadiness || 0) + "%",
    ]),
    [140, 70, 50, 50, 60, 60, 70]
  );

  addSectionTitle(doc, "Definitions");
  doc.fontSize(7).fillColor("#64748b");
  doc.text("PLATINUM: Score >= 90 | GOLD: Score >= 75 | SILVER: Score >= 55 | AT_RISK: Score < 55");
  doc.text("Score = TRI(40%) + Completion(20%) + On-Time(20%) + Audit Readiness(20%)");

  doc.end();
  return new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
}

export async function generateRankingPdf(data: {
  quarterKey: string;
  scope: string;
  metricKey: string;
  entries: { clinicName: string; rank: number; score: number; percentile: number; payload: any }[];
}): Promise<Buffer> {
  const doc = createDoc();
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  addHeader(doc, `Ranking Report — ${data.quarterKey}`, `Scope: ${data.scope} | Metric: ${data.metricKey.toUpperCase()}`);
  addFooter(doc);

  addSectionTitle(doc, "Rankings");
  addTable(
    doc,
    ["Rank", "Clinic", "Score", "Percentile", "Completed", "On-Time", "Late", "No-Show"],
    data.entries.map((e) => [
      `#${e.rank}`,
      e.clinicName,
      String(e.score),
      `${e.percentile}%`,
      String(e.payload?.completed || 0),
      String(e.payload?.onTime || 0),
      String(e.payload?.late || 0),
      String(e.payload?.noShow || 0),
    ]),
    [40, 130, 50, 60, 55, 55, 45, 50]
  );

  addSectionTitle(doc, "Definitions");
  doc.fontSize(7).fillColor("#64748b");
  doc.text("TRI = Transport Reliability Index | CTS = Clinic Trust Score");
  doc.text("Percentile: 100th = top performer, 0th = lowest performer");

  doc.end();
  return new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
}

export async function generateAuditPdf(data: {
  periodStart: string;
  periodEnd: string;
  results: { clinicName: string; score: number; totalTrips: number; completeTrips: number; missingBreakdown: any[] }[];
}): Promise<Buffer> {
  const doc = createDoc();
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  addHeader(doc, `Audit Shield Report`, `Period: ${data.periodStart} to ${data.periodEnd}`);
  addFooter(doc);

  addSectionTitle(doc, "Audit Readiness Overview");
  const avgScore = data.results.length > 0 ? data.results.reduce((a, b) => a + b.score, 0) / data.results.length : 0;
  doc.fontSize(9).text(`Average Readiness: ${avgScore.toFixed(1)}% | Clinics Evaluated: ${data.results.length}`);
  doc.moveDown(0.5);

  addSectionTitle(doc, "Clinic Audit Readiness");
  addTable(
    doc,
    ["Clinic", "Score", "Total Trips", "Complete", "Missing Items"],
    data.results.map((r) => [
      r.clinicName,
      `${r.score}%`,
      String(r.totalTrips),
      String(r.completeTrips),
      r.missingBreakdown.map((m: any) => `${m.category}(${m.count})`).join(", ") || "None",
    ]),
    [130, 55, 65, 60, 220]
  );

  addSectionTitle(doc, "Evidence Checklist");
  doc.fontSize(7).fillColor("#64748b");
  doc.text("Required: Scheduled time, Pickup arrival timestamp, Completion timestamp, Driver assignment");
  doc.text("For cancelled/no-show: Outcome reason required");

  doc.end();
  return new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
}

export async function generatePredictionPdf(data: {
  dateFrom: string;
  dateTo: string;
  lateRisk: any;
  staffingRisk: any;
}): Promise<Buffer> {
  const doc = createDoc();
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  addHeader(doc, `Prediction Report`, `Period: ${data.dateFrom} to ${data.dateTo}`);
  addFooter(doc);

  addSectionTitle(doc, "Late Risk Summary");
  doc.fontSize(9).text(`Red: ${data.lateRisk.summaryRed} | Yellow: ${data.lateRisk.summaryYellow} | Green: ${data.lateRisk.summaryGreen}`);
  doc.moveDown(0.5);

  if (data.lateRisk.riskyTrips?.length > 0) {
    addSectionTitle(doc, "High Risk Trips");
    addTable(
      doc,
      ["Trip ID", "Date", "Time", "Risk", "Clinic", "Driver", "Reasons"],
      data.lateRisk.riskyTrips.slice(0, 15).map((t: any) => [
        t.publicId || String(t.tripId),
        t.scheduledDate,
        t.pickupTime,
        `${t.riskScore} (${t.riskLabel})`,
        t.clinicName,
        t.driverName,
        t.reasons.join("; "),
      ]),
      [70, 65, 40, 55, 90, 70, 140]
    );
  }

  addSectionTitle(doc, "Staffing Risk Forecast");
  doc.fontSize(9).text(`Overall Risk: ${data.staffingRisk.overallRisk.toUpperCase()} | ${data.staffingRisk.recommendation}`);
  doc.moveDown(0.5);

  if (data.staffingRisk.days?.length > 0) {
    addTable(
      doc,
      ["Date", "Trips", "Drivers", "Ratio", "Risk", "Forecast"],
      data.staffingRisk.days.map((d: any) => [
        d.date,
        String(d.scheduledTrips),
        String(d.availableDrivers),
        String(d.ratio),
        d.riskLevel,
        d.forecast,
      ]),
      [70, 50, 50, 50, 55, 255]
    );
  }

  doc.end();
  return new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
}

export async function generateQuarterlyReportPdf(data: {
  clinicName: string;
  quarterKey: string;
  periodStart: string;
  periodEnd: string;
  metrics: Record<string, any>;
}): Promise<Buffer> {
  const doc = createDoc();
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  addHeader(doc, `Quarterly Report — ${data.quarterKey}`, `${data.clinicName} | ${data.periodStart} to ${data.periodEnd}`);
  addFooter(doc);

  const m = data.metrics;

  if (m.certification) {
    addSectionTitle(doc, "Certification");
    doc.fontSize(10).text(`Level: ${m.certification.certLevel || "N/A"}  |  Score: ${m.certification.score || "N/A"}`);
    doc.moveDown(0.3);
  }

  if (m.ranking) {
    addSectionTitle(doc, "Ranking");
    doc.fontSize(10).text(`Rank: #${m.ranking.rank || "N/A"}  |  Percentile: ${m.ranking.percentile || "N/A"}%  |  Score: ${m.ranking.score || "N/A"}`);
    doc.moveDown(0.3);
  }

  if (m.auditReadiness) {
    addSectionTitle(doc, "Audit Readiness");
    doc.fontSize(10).text(`Score: ${m.auditReadiness.score || "N/A"}%  |  Complete: ${m.auditReadiness.completeTrips || 0} / ${m.auditReadiness.totalTrips || 0}`);
    doc.moveDown(0.3);
  }

  if (m.prediction) {
    addSectionTitle(doc, "Risk Summary");
    doc.fontSize(10).text(`Late Risk: Red(${m.prediction.summaryRed || 0}) Yellow(${m.prediction.summaryYellow || 0}) Green(${m.prediction.summaryGreen || 0})`);
    doc.moveDown(0.3);
  }

  if (m.indexes) {
    addSectionTitle(doc, "Index Summary");
    const idxEntries = Object.entries(m.indexes).filter(([k]) => k !== "lateRisk");
    for (const [key, val] of idxEntries) {
      const v = val as any;
      const scoreVal = v.score ?? v.percent ?? v.efficiency ?? v.leakageTotal ?? v.ratio ?? v.revenue ?? v.shortageCount ?? "-";
      doc.fontSize(9).text(`${key}: ${scoreVal}`);
    }
  }

  addSectionTitle(doc, "Definitions");
  doc.fontSize(7).fillColor("#64748b");
  doc.text("TRI = Transport Reliability Index | CTS = Clinic Trust Score");
  doc.text("Certification: PLATINUM(90+) GOLD(75+) SILVER(55+) AT_RISK(<55)");

  doc.end();
  return new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
}
