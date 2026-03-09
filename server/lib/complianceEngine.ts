/**
 * Compliance Engine
 * Tracks driver and vehicle credentials, certifications, and inspections.
 * Generates alerts for expiring/missing documents and blocks non-compliant
 * entities from being dispatched.
 */
import { db } from "../db";
import {
  complianceDocuments, complianceAlerts,
  drivers, vehicles,
} from "@shared/schema";
import { eq, and, lte, gte, isNull, inArray, desc, sql } from "drizzle-orm";
import { cityNowDate } from "@shared/timeUtils";

// ─── Document Type Definitions ───────────────────────────────────────────────

export interface DocumentRequirement {
  type: string;
  label: string;
  entity: "driver" | "vehicle";
  renewalDays: number; // typical renewal period
  criticalDays: number; // days before expiry = critical alert
  warningDays: number; // days before expiry = warning alert
  required: boolean;
}

export const DOCUMENT_REQUIREMENTS: DocumentRequirement[] = [
  // Driver documents
  { type: "drivers_license", label: "Driver's License", entity: "driver", renewalDays: 365 * 4, criticalDays: 7, warningDays: 30, required: true },
  { type: "medical_certificate", label: "Medical Certificate (DOT)", entity: "driver", renewalDays: 365 * 2, criticalDays: 14, warningDays: 30, required: true },
  { type: "background_check", label: "Background Check", entity: "driver", renewalDays: 365, criticalDays: 14, warningDays: 30, required: true },
  { type: "drug_test", label: "Drug Test", entity: "driver", renewalDays: 365, criticalDays: 7, warningDays: 30, required: true },
  { type: "cpr_certification", label: "CPR Certification", entity: "driver", renewalDays: 365 * 2, criticalDays: 14, warningDays: 30, required: false },
  { type: "defensive_driving", label: "Defensive Driving Course", entity: "driver", renewalDays: 365 * 3, criticalDays: 30, warningDays: 60, required: false },
  { type: "hipaa_training", label: "HIPAA Training", entity: "driver", renewalDays: 365, criticalDays: 14, warningDays: 30, required: true },
  { type: "nemt_certification", label: "NEMT Certification", entity: "driver", renewalDays: 365, criticalDays: 14, warningDays: 30, required: true },
  // Vehicle documents
  { type: "vehicle_insurance", label: "Vehicle Insurance", entity: "vehicle", renewalDays: 180, criticalDays: 7, warningDays: 30, required: true },
  { type: "vehicle_registration", label: "Vehicle Registration", entity: "vehicle", renewalDays: 365, criticalDays: 14, warningDays: 30, required: true },
  { type: "vehicle_inspection", label: "Vehicle Inspection", entity: "vehicle", renewalDays: 365, criticalDays: 14, warningDays: 30, required: true },
  { type: "ada_compliance", label: "ADA Compliance Certificate", entity: "vehicle", renewalDays: 365, criticalDays: 14, warningDays: 30, required: false },
  { type: "fire_extinguisher", label: "Fire Extinguisher Inspection", entity: "vehicle", renewalDays: 365, criticalDays: 14, warningDays: 30, required: false },
];

// ─── Compliance Status Types ─────────────────────────────────────────────────

export type ComplianceStatus = "compliant" | "warning" | "critical" | "non_compliant";

export interface EntityComplianceReport {
  entityType: "driver" | "vehicle";
  entityId: number;
  entityName: string;
  overallStatus: ComplianceStatus;
  score: number; // 0-100
  documents: Array<{
    type: string;
    label: string;
    required: boolean;
    status: "valid" | "expiring_soon" | "expired" | "missing" | "pending_review";
    expiresAt: string | null;
    daysUntilExpiry: number | null;
  }>;
  missingRequired: string[];
  expiringCritical: string[];
  expiringWarning: string[];
}

export interface CompanyComplianceSummary {
  companyId: number;
  totalDrivers: number;
  totalVehicles: number;
  compliantDrivers: number;
  warningDrivers: number;
  criticalDrivers: number;
  nonCompliantDrivers: number;
  compliantVehicles: number;
  warningVehicles: number;
  criticalVehicles: number;
  nonCompliantVehicles: number;
  overallScore: number;
  activeAlerts: number;
  topIssues: Array<{ type: string; count: number; severity: string }>;
}

// ─── Check Entity Compliance ─────────────────────────────────────────────────

export async function getEntityCompliance(
  entityType: "driver" | "vehicle",
  entityId: number,
  companyId: number
): Promise<EntityComplianceReport> {
  const docs = await db.select().from(complianceDocuments).where(
    and(
      eq(complianceDocuments.entityType, entityType),
      eq(complianceDocuments.entityId, entityId),
      eq(complianceDocuments.companyId, companyId)
    )
  );

  const requirements = DOCUMENT_REQUIREMENTS.filter(r => r.entity === entityType);
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const docStatuses: EntityComplianceReport["documents"] = [];
  const missingRequired: string[] = [];
  const expiringCritical: string[] = [];
  const expiringWarning: string[] = [];

  let validCount = 0;
  let totalRequired = 0;

  for (const req of requirements) {
    if (req.required) totalRequired++;

    const doc = docs.find(d => d.documentType === req.type);

    if (!doc) {
      docStatuses.push({
        type: req.type,
        label: req.label,
        required: req.required,
        status: "missing",
        expiresAt: null,
        daysUntilExpiry: null,
      });
      if (req.required) missingRequired.push(req.label);
      continue;
    }

    if (!doc.expiresAt) {
      docStatuses.push({
        type: req.type,
        label: req.label,
        required: req.required,
        status: doc.status === "pending_review" ? "pending_review" : "valid",
        expiresAt: null,
        daysUntilExpiry: null,
      });
      if (doc.status !== "pending_review") validCount++;
      continue;
    }

    const expiryDate = new Date(doc.expiresAt);
    const daysUntil = Math.ceil((expiryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

    let status: "valid" | "expiring_soon" | "expired" | "missing" | "pending_review";
    if (daysUntil < 0) {
      status = "expired";
      if (req.required) missingRequired.push(req.label);
    } else if (daysUntil <= req.criticalDays) {
      status = "expiring_soon";
      expiringCritical.push(req.label);
      validCount += 0.5; // Partial credit
    } else if (daysUntil <= req.warningDays) {
      status = "expiring_soon";
      expiringWarning.push(req.label);
      validCount += 0.8;
    } else {
      status = "valid";
      validCount++;
    }

    docStatuses.push({
      type: req.type,
      label: req.label,
      required: req.required,
      status,
      expiresAt: doc.expiresAt,
      daysUntilExpiry: daysUntil,
    });
  }

  const score = totalRequired > 0 ? Math.round((validCount / totalRequired) * 100) : 100;

  let overallStatus: ComplianceStatus;
  if (missingRequired.length > 0) overallStatus = "non_compliant";
  else if (expiringCritical.length > 0) overallStatus = "critical";
  else if (expiringWarning.length > 0) overallStatus = "warning";
  else overallStatus = "compliant";

  // Get entity name
  let entityName = `${entityType} #${entityId}`;
  if (entityType === "driver") {
    const [d] = await db.select({ firstName: drivers.firstName, lastName: drivers.lastName })
      .from(drivers).where(eq(drivers.id, entityId));
    if (d) entityName = `${d.firstName} ${d.lastName}`;
  } else {
    const [v] = await db.select({ name: vehicles.name }).from(vehicles).where(eq(vehicles.id, entityId));
    if (v) entityName = v.name;
  }

  return {
    entityType,
    entityId,
    entityName,
    overallStatus,
    score,
    documents: docStatuses,
    missingRequired,
    expiringCritical,
    expiringWarning,
  };
}

// ─── Company-Wide Compliance Summary ─────────────────────────────────────────

export async function getCompanyComplianceSummary(companyId: number): Promise<CompanyComplianceSummary> {
  const activeDrivers = await db.select({ id: drivers.id }).from(drivers).where(
    and(eq(drivers.companyId, companyId), eq(drivers.status, "ACTIVE"), isNull(drivers.deletedAt))
  );

  const activeVehicles = await db.select({ id: vehicles.id }).from(vehicles).where(
    and(eq(vehicles.companyId, companyId), eq(vehicles.status, "ACTIVE"), isNull(vehicles.deletedAt))
  );

  let compliantDrivers = 0, warningDrivers = 0, criticalDrivers = 0, nonCompliantDrivers = 0;
  let compliantVehicles = 0, warningVehicles = 0, criticalVehicles = 0, nonCompliantVehicles = 0;
  let totalScore = 0;
  const issueMap = new Map<string, { count: number; severity: string }>();

  for (const d of activeDrivers) {
    const report = await getEntityCompliance("driver", d.id, companyId);
    totalScore += report.score;
    switch (report.overallStatus) {
      case "compliant": compliantDrivers++; break;
      case "warning": warningDrivers++; break;
      case "critical": criticalDrivers++; break;
      case "non_compliant": nonCompliantDrivers++; break;
    }
    for (const doc of report.documents) {
      if (doc.status !== "valid") {
        const key = `${doc.type}_${doc.status}`;
        const existing = issueMap.get(key) || { count: 0, severity: doc.status === "expired" || doc.status === "missing" ? "critical" : "warning" };
        existing.count++;
        issueMap.set(key, existing);
      }
    }
  }

  for (const v of activeVehicles) {
    const report = await getEntityCompliance("vehicle", v.id, companyId);
    totalScore += report.score;
    switch (report.overallStatus) {
      case "compliant": compliantVehicles++; break;
      case "warning": warningVehicles++; break;
      case "critical": criticalVehicles++; break;
      case "non_compliant": nonCompliantVehicles++; break;
    }
  }

  const totalEntities = activeDrivers.length + activeVehicles.length;
  const overallScore = totalEntities > 0 ? Math.round(totalScore / totalEntities) : 100;

  // Count active alerts
  const [alertCount] = await db.select({
    count: sql<number>`count(*)::int`,
  }).from(complianceAlerts).where(
    and(eq(complianceAlerts.companyId, companyId), eq(complianceAlerts.acknowledged, false))
  );

  const topIssues = Array.from(issueMap.entries())
    .map(([type, data]) => ({ type, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    companyId,
    totalDrivers: activeDrivers.length,
    totalVehicles: activeVehicles.length,
    compliantDrivers, warningDrivers, criticalDrivers, nonCompliantDrivers,
    compliantVehicles, warningVehicles, criticalVehicles, nonCompliantVehicles,
    overallScore,
    activeAlerts: alertCount?.count || 0,
    topIssues,
  };
}

// ─── Generate Compliance Alerts (Scheduler) ──────────────────────────────────

export async function generateComplianceAlerts(companyId: number): Promise<number> {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  let alertsCreated = 0;

  // Find all documents expiring within 30 days or already expired
  const warningDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const expiringDocs = await db.select().from(complianceDocuments).where(
    and(
      eq(complianceDocuments.companyId, companyId),
      lte(complianceDocuments.expiresAt, warningDate)
    )
  );

  for (const doc of expiringDocs) {
    if (!doc.expiresAt) continue;

    const expiryDate = new Date(doc.expiresAt);
    const daysUntil = Math.ceil((expiryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

    let alertType: string;
    let severity: string;
    let message: string;

    const req = DOCUMENT_REQUIREMENTS.find(r => r.type === doc.documentType);
    const label = req?.label || doc.documentType;

    if (daysUntil < 0) {
      alertType = "expired";
      severity = "critical";
      message = `${label} for ${doc.entityType} #${doc.entityId} expired ${Math.abs(daysUntil)} days ago`;
    } else if (daysUntil <= 7) {
      alertType = "expiring_7d";
      severity = "critical";
      message = `${label} for ${doc.entityType} #${doc.entityId} expires in ${daysUntil} days`;
    } else {
      alertType = "expiring_30d";
      severity = "warning";
      message = `${label} for ${doc.entityType} #${doc.entityId} expires in ${daysUntil} days`;
    }

    // Avoid duplicate alerts (check if same alert already exists today)
    const [existing] = await db.select({ id: complianceAlerts.id }).from(complianceAlerts).where(
      and(
        eq(complianceAlerts.companyId, companyId),
        eq(complianceAlerts.documentId, doc.id),
        eq(complianceAlerts.alertType, alertType),
        gte(complianceAlerts.createdAt, new Date(todayStr))
      )
    );

    if (!existing) {
      await db.insert(complianceAlerts).values({
        companyId,
        documentId: doc.id,
        entityType: doc.entityType,
        entityId: doc.entityId,
        alertType,
        message,
        severity,
      });
      alertsCreated++;
    }
  }

  // Check for missing required documents
  const activeDrivers = await db.select({ id: drivers.id }).from(drivers).where(
    and(eq(drivers.companyId, companyId), eq(drivers.status, "ACTIVE"), isNull(drivers.deletedAt))
  );

  const driverRequirements = DOCUMENT_REQUIREMENTS.filter(r => r.entity === "driver" && r.required);

  for (const driver of activeDrivers) {
    const driverDocs = await db.select({ documentType: complianceDocuments.documentType })
      .from(complianceDocuments).where(
        and(
          eq(complianceDocuments.entityType, "driver"),
          eq(complianceDocuments.entityId, driver.id),
          eq(complianceDocuments.companyId, companyId)
        )
      );

    const existingTypes = new Set(driverDocs.map(d => d.documentType));

    for (const req of driverRequirements) {
      if (!existingTypes.has(req.type)) {
        const [existingAlert] = await db.select({ id: complianceAlerts.id }).from(complianceAlerts).where(
          and(
            eq(complianceAlerts.companyId, companyId),
            eq(complianceAlerts.entityType, "driver"),
            eq(complianceAlerts.entityId, driver.id),
            eq(complianceAlerts.alertType, "missing"),
            eq(complianceAlerts.acknowledged, false)
          )
        );

        if (!existingAlert) {
          await db.insert(complianceAlerts).values({
            companyId,
            entityType: "driver",
            entityId: driver.id,
            alertType: "missing",
            message: `Missing required document: ${req.label} for driver #${driver.id}`,
            severity: "critical",
          });
          alertsCreated++;
        }
      }
    }
  }

  return alertsCreated;
}

// ─── Dispatch Eligibility Check ──────────────────────────────────────────────

export async function isDriverDispatchEligible(
  driverId: number,
  companyId: number
): Promise<{ eligible: boolean; reason?: string }> {
  const report = await getEntityCompliance("driver", driverId, companyId);

  if (report.overallStatus === "non_compliant") {
    return {
      eligible: false,
      reason: `Non-compliant: missing ${report.missingRequired.join(", ")}`,
    };
  }

  if (report.overallStatus === "critical" && report.missingRequired.length > 0) {
    return {
      eligible: false,
      reason: `Critical compliance issues: ${report.expiringCritical.join(", ")}`,
    };
  }

  return { eligible: true };
}
