import PDFDocument from "pdfkit";
import type { IndexesResult } from "./indexEngine";

const BRAND_COLOR = "#1a56db";
const HEADER_BG = "#f0f4ff";
const TABLE_HEADER_BG = "#e5edff";
const BORDER_COLOR = "#d1d5db";
const TEXT_COLOR = "#111827";
const MUTED_COLOR = "#6b7280";

function scoreColor(score: number): string {
  if (score >= 80) return "#059669";
  if (score >= 60) return "#d97706";
  if (score >= 40) return "#ea580c";
  return "#dc2626";
}

function riskColor(level: string): string {
  if (level === "low") return "#059669";
  if (level === "medium") return "#d97706";
  if (level === "high") return "#ea580c";
  return "#dc2626";
}

export async function generateIndexesPdf(data: IndexesResult): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margins: { top: 40, bottom: 40, left: 40, right: 40 } });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - 80;
    const scopeLabel = data.meta.scope === "general" ? "General (All States)"
      : data.meta.scope === "state" ? `State: ${data.meta.state}`
      : `City: ${data.meta.city}`;

    doc.rect(40, 40, pageWidth, 60).fill(BRAND_COLOR);
    doc.fillColor("#ffffff").fontSize(18).font("Helvetica-Bold")
      .text("UCM Intelligence — Indexes Report", 55, 55, { width: pageWidth - 30 });
    doc.fontSize(10).font("Helvetica")
      .text(`${scopeLabel}  |  ${data.meta.dateFrom} to ${data.meta.dateTo}  |  Generated: ${new Date(data.meta.computedAt).toLocaleDateString("en-US")}`, 55, 78, { width: pageWidth - 30 });

    let y = 115;
    const s = data.summary;

    doc.fillColor(TEXT_COLOR).fontSize(12).font("Helvetica-Bold")
      .text("Index Summary (10 Proprietary Indexes)", 40, y);
    y += 20;

    const indexCards = [
      { label: "1. TRI Nevada\u2122", value: `${s.tri.score}`, sub: `On-time: ${s.tri.onTime} | Late: ${s.tri.late} | No-show: ${s.tri.noShow} | Completed: ${s.tri.completed}`, type: "score" },
      { label: "2. Clinic Trust Score", value: `${s.cts.score}`, sub: `TRI: ${s.cts.triComponent} | Return: ${s.cts.returnReliability}% | Proof: ${s.cts.proofCompleteness}%`, type: "score" },
      { label: "3. Driver Stability", value: `${s.driverStability.score}`, sub: `Assigned: ${s.driverStability.assigned} | Completed: ${s.driverStability.completed} | Late: ${s.driverStability.latePickups} | Cancels: ${s.driverStability.driverCancels}`, type: "score" },
      { label: "4. Driver Utilization", value: `${s.driverUtilization.percent}%`, sub: `Active: ${s.driverUtilization.activeTripMinutes} min | Scheduled: ${s.driverUtilization.scheduledMinutes} min`, type: "percent" },
      { label: "5. Dispatch Efficiency", value: `${s.dispatchEfficiency.efficiency}%`, sub: `Auto: ${s.dispatchEfficiency.autoAssigned} | Manual: ${s.dispatchEfficiency.manualOverrideCount} | Reassign: ${s.dispatchEfficiency.reassignmentCount}`, type: "percent" },
      { label: "6. Revenue Leakage", value: `$${s.revenueLeakage.leakageTotal.toLocaleString()}`, sub: Object.entries(s.revenueLeakage.leakageByReason).map(([k, v]) => `${k}: $${v}`).join(" | ") || "No leakage detected", type: "dollar" },
      { label: "7. Clinic Load", value: `${s.clinicLoad.ratio}`, sub: `Level: ${s.clinicLoad.level.toUpperCase()} | Trips: ${s.clinicLoad.activeTrips} | Drivers: ${s.clinicLoad.scheduledDrivers}`, type: "load" },
      { label: "8. Weekly Profit", value: `$${s.weeklyProfit.profit.toLocaleString()}`, sub: `Revenue: $${s.weeklyProfit.revenue} | Cost: $${s.weeklyProfit.cost} | Margin: ${s.weeklyProfit.margin}%`, type: "dollar" },
      { label: "9. Replacement Pressure", value: `${s.replacementPressure.shortageCount}`, sub: `Risk: ${s.replacementPressure.riskLevel.toUpperCase()} | ${s.replacementPressure.recommendedAction}`, type: "risk" },
      { label: "10. Late Risk Predictor", value: `Red: ${s.lateRisk.summaryRed}`, sub: `Yellow: ${s.lateRisk.summaryYellow} | Green: ${s.lateRisk.summaryGreen} | At-risk trips: ${s.lateRisk.riskyTrips.length}`, type: "risk" },
    ];

    const cardW = (pageWidth - 10) / 2;
    const cardH = 48;

    for (let i = 0; i < indexCards.length; i++) {
      const card = indexCards[i];
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = 40 + col * (cardW + 10);
      const cy = y + row * (cardH + 6);

      if (cy + cardH > doc.page.height - 60) {
        doc.addPage();
        y = 40;
      }

      const actualCy = y + row * (cardH + 6);

      doc.rect(cx, actualCy, cardW, cardH).lineWidth(0.5).stroke(BORDER_COLOR);
      doc.fillColor(TEXT_COLOR).fontSize(8).font("Helvetica-Bold")
        .text(card.label, cx + 8, actualCy + 6, { width: cardW - 80 });
      doc.fillColor(BRAND_COLOR).fontSize(14).font("Helvetica-Bold")
        .text(card.value, cx + cardW - 75, actualCy + 4, { width: 67, align: "right" });
      doc.fillColor(MUTED_COLOR).fontSize(6.5).font("Helvetica")
        .text(card.sub, cx + 8, actualCy + 22, { width: cardW - 16 });
    }

    y += Math.ceil(indexCards.length / 2) * (cardH + 6) + 15;

    if (data.breakdown.length > 0) {
      if (y > doc.page.height - 200) {
        doc.addPage();
        y = 40;
      }

      const breakdownLabel = data.meta.scope === "general" ? "Breakdown by State"
        : data.meta.scope === "state" ? "Breakdown by City"
        : "Breakdown by Clinic";

      doc.fillColor(TEXT_COLOR).fontSize(12).font("Helvetica-Bold")
        .text(breakdownLabel, 40, y);
      y += 18;

      const cols = [
        { label: "Name", width: 90 },
        { label: "TRI", width: 35 },
        { label: "CTS", width: 35 },
        { label: "Stability", width: 42 },
        { label: "Util%", width: 35 },
        { label: "Dispatch%", width: 42 },
        { label: "Leak$", width: 42 },
        { label: "Load", width: 32 },
        { label: "Profit$", width: 48 },
        { label: "Pressure", width: 42 },
        { label: "Risk", width: 30 },
      ];

      const totalColWidth = cols.reduce((s, c) => s + c.width, 0);
      const scale = pageWidth / totalColWidth;

      doc.rect(40, y, pageWidth, 14).fill(TABLE_HEADER_BG);
      let hx = 40;
      for (const col of cols) {
        const w = col.width * scale;
        doc.fillColor(TEXT_COLOR).fontSize(6.5).font("Helvetica-Bold")
          .text(col.label, hx + 2, y + 3, { width: w - 4 });
        hx += w;
      }
      y += 14;

      for (let ri = 0; ri < data.breakdown.length; ri++) {
        if (y > doc.page.height - 60) {
          doc.addPage();
          y = 40;
        }

        const row = data.breakdown[ri];
        if (ri % 2 === 0) {
          doc.rect(40, y, pageWidth, 13).fill("#f9fafb");
        }

        let rx = 40;
        const vals = [
          row.label,
          row.tri.toFixed(1),
          row.cts.toFixed(1),
          row.driverStability.toFixed(1),
          row.driverUtilization.toFixed(1),
          row.dispatchEfficiency.toFixed(1),
          `$${row.leakage.toFixed(0)}`,
          row.load.toFixed(1),
          `$${row.profit.toFixed(0)}`,
          String(row.replacementPressure),
          String(row.lateRisk),
        ];

        for (let ci = 0; ci < cols.length; ci++) {
          const w = cols[ci].width * scale;
          doc.fillColor(TEXT_COLOR).fontSize(6).font("Helvetica")
            .text(vals[ci], rx + 2, y + 3, { width: w - 4 });
          rx += w;
        }
        y += 13;
      }
    }

    if (s.lateRisk.riskyTrips.length > 0) {
      y += 15;
      if (y > doc.page.height - 150) {
        doc.addPage();
        y = 40;
      }

      doc.fillColor(TEXT_COLOR).fontSize(12).font("Helvetica-Bold")
        .text("Late Risk — Top At-Risk Trips", 40, y);
      y += 18;

      const riskCols = [
        { label: "Trip ID", width: 70 },
        { label: "Date", width: 65 },
        { label: "Time", width: 45 },
        { label: "Score", width: 35 },
        { label: "Clinic", width: 100 },
        { label: "Driver", width: 80 },
        { label: "Reasons", width: pageWidth - 395 },
      ];

      doc.rect(40, y, pageWidth, 14).fill(TABLE_HEADER_BG);
      let rhx = 40;
      for (const col of riskCols) {
        doc.fillColor(TEXT_COLOR).fontSize(6.5).font("Helvetica-Bold")
          .text(col.label, rhx + 2, y + 3, { width: col.width - 4 });
        rhx += col.width;
      }
      y += 14;

      const topRisky = s.lateRisk.riskyTrips.slice(0, 15);
      for (let ri = 0; ri < topRisky.length; ri++) {
        if (y > doc.page.height - 50) {
          doc.addPage();
          y = 40;
        }

        const t = topRisky[ri];
        if (ri % 2 === 0) doc.rect(40, y, pageWidth, 13).fill("#f9fafb");

        const rVals = [
          t.publicId,
          t.scheduledDate,
          t.pickupTime,
          String(t.riskScore),
          t.clinicName,
          t.driverName,
          t.reasons.join("; "),
        ];

        let rrx = 40;
        for (let ci = 0; ci < riskCols.length; ci++) {
          doc.fillColor(ci === 3 && t.riskScore >= 60 ? "#dc2626" : ci === 3 && t.riskScore >= 30 ? "#d97706" : TEXT_COLOR)
            .fontSize(6).font("Helvetica")
            .text(rVals[ci], rrx + 2, y + 3, { width: riskCols[ci].width - 4 });
          rrx += riskCols[ci].width;
        }
        y += 13;
      }
    }

    y += 20;
    if (y > doc.page.height - 80) {
      doc.addPage();
      y = 40;
    }

    doc.rect(40, y, pageWidth, 0.5).fill(BORDER_COLOR);
    y += 8;
    doc.fillColor(MUTED_COLOR).fontSize(7).font("Helvetica")
      .text("TRI Nevada\u2122 = 100*(OnTimeCompleted/Completed) - 0.5*100*(Late/Completed) - 1.0*100*(NoShow/(Completed+NoShow))", 40, y, { width: pageWidth });
    y += 10;
    doc.text("Grace period: 10 minutes. Thresholds: \u226580 Excellent | \u226560 Good | \u226540 Fair | <40 Needs Improvement", 40, y, { width: pageWidth });
    y += 10;
    doc.text("CTS: 50% TRI + 25% Return Reliability + 25% Proof Completeness. Driver Utilization: active_trip_min / (8h * drivers * days).", 40, y, { width: pageWidth });
    y += 12;
    doc.fillColor(MUTED_COLOR).fontSize(6)
      .text(`United Care Mobility \u00A9 ${new Date().getFullYear()} — Confidential`, 40, y, { width: pageWidth, align: "center" });

    doc.end();
  });
}
