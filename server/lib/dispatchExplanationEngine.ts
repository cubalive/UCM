/**
 * Dispatch Explanation Engine
 *
 * Generates human-readable natural language explanations of dispatch decisions.
 * Takes a trip, driver, and confidence breakdown and produces a sentence that
 * a dispatcher can read and immediately understand why a driver was chosen.
 */

import { db } from "../db";
import { trips, drivers } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { DispatchConfidence } from "./dispatchConfidenceEngine";

// ─── Main Function ───────────────────────────────────────────────────────────

export async function explainDispatchDecision(
  tripId: number,
  driverId: number,
  confidence: DispatchConfidence
): Promise<string> {
  // Fetch driver name
  const [driver] = await db
    .select({ firstName: drivers.firstName, lastName: drivers.lastName })
    .from(drivers)
    .where(eq(drivers.id, driverId))
    .limit(1);

  const driverName = driver ? driver.firstName : `Driver #${driverId}`;
  const f = confidence.factors;

  // Build explanation parts from strongest factors
  const parts: string[] = [];

  // Always lead with the driver name and proximity
  if (f.proximity.score >= 70) {
    parts.push(`${driverName} was selected because she is ${f.proximity.detail.toLowerCase()}`);
  } else if (f.proximity.score >= 40) {
    parts.push(`${driverName} was selected despite being ${f.proximity.detail.toLowerCase()}`);
  } else {
    parts.push(`${driverName} was selected even though proximity is a concern (${f.proximity.detail.toLowerCase()})`);
  }

  // Driver reliability — always mention
  if (f.driverScore.score >= 80) {
    parts.push(`has an excellent track record (${f.driverScore.detail})`);
  } else if (f.driverScore.score >= 60) {
    parts.push(`has a good track record (${f.driverScore.detail})`);
  } else {
    parts.push(`has a developing track record (${f.driverScore.detail})`);
  }

  // Vehicle match — mention if particularly relevant
  if (f.vehicleMatch.score === 100) {
    parts.push(`and ${formatVehicleExplanation(f.vehicleMatch.detail)}`);
  } else if (f.vehicleMatch.score === 0) {
    parts.push(`but vehicle compatibility is a concern (${f.vehicleMatch.detail.toLowerCase()})`);
  }

  // Patient history — mention if there's a relationship
  if (f.patientHistory.score >= 70) {
    parts.push(`${driverName} has ${f.patientHistory.detail.toLowerCase()}`);
  }

  // Load balance — mention only if notable
  if (f.loadBalance.score >= 80) {
    parts.push(`with a light workload today (${f.loadBalance.detail.toLowerCase()})`);
  } else if (f.loadBalance.score < 40) {
    parts.push(`though workload is high (${f.loadBalance.detail.toLowerCase()})`);
  }

  // Fatigue — mention if concerning
  if (f.fatigue.score < 50) {
    parts.push(`Note: ${f.fatigue.detail}`);
  }

  // Build the final sentence
  let explanation = parts[0];
  if (parts.length === 2) {
    explanation += `, ${parts[1]}.`;
  } else if (parts.length > 2) {
    // Join first two with comma, third with "and"
    explanation += `, ${parts[1]}`;
    for (let i = 2; i < parts.length; i++) {
      if (i === parts.length - 1) {
        explanation += `. ${capitalize(parts[i])}`;
      } else {
        explanation += `, ${parts[i]}`;
      }
    }
    explanation += ".";
  } else {
    explanation += ".";
  }

  // Append confidence qualifier
  if (confidence.confidence === "high") {
    explanation += ` Overall confidence: high (${confidence.overallScore}/100).`;
  } else if (confidence.confidence === "medium") {
    explanation += ` Overall confidence: medium (${confidence.overallScore}/100) — dispatcher review recommended.`;
  } else {
    explanation += ` Overall confidence: low (${confidence.overallScore}/100) — manual review strongly recommended.`;
  }

  return explanation;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatVehicleExplanation(detail: string): string {
  const lower = detail.toLowerCase();
  if (lower.includes("wav") || lower.includes("wheelchair")) {
    return `her vehicle matches this patient's wheelchair requirement`;
  }
  if (lower.includes("stretcher")) {
    return `her stretcher vehicle matches this patient's stretcher requirement`;
  }
  return `her vehicle is compatible (${lower})`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
