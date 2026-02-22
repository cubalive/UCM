import { type Response } from "express";
import { type AuthRequest, getCompanyIdFromAuth } from "../auth";
import { db } from "../db";
import { storage } from "../storage";
import {
  timeEntries,
  timeImportBatches,
  tpPayrollRuns,
  tpPayrollItems,
  drivers,
  companyPayrollSettings,
  staffPayConfigs,
  driverStripeAccounts,
} from "@shared/schema";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
export const csvUploadMiddleware = upload.single("file");

function getCompanyId(req: AuthRequest): number {
  const cid = getCompanyIdFromAuth(req);
  if (!cid) throw new Error("NO_COMPANY");
  return cid;
}

function requireCompanyOrFail(req: AuthRequest, res: Response): number | null {
  try {
    return getCompanyId(req);
  } catch {
    res.status(403).json({ message: "Company context required" });
    return null;
  }
}

export async function listCompanyDriversHandler(req: AuthRequest, res: Response) {
  const companyId = requireCompanyOrFail(req, res);
  if (!companyId) return;
  try {
    const { isNull } = await import("drizzle-orm");
    const cityIdParam = req.query.city_id ? parseInt(req.query.city_id as string) : undefined;
    const conditions: any[] = [eq(drivers.companyId, companyId), eq(drivers.active, true), isNull(drivers.deletedAt)];
    if (cityIdParam) conditions.push(eq(drivers.cityId, cityIdParam));
    const result = await db
      .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName, cityId: drivers.cityId })
      .from(drivers)
      .where(and(...conditions));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

async function auditDenied(req: AuthRequest, reason: string) {
  try {
    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "ACCESS_DENIED",
      entity: "time_pay",
      entityId: 0,
      details: `${reason} | role=${req.user!.role} userId=${req.user!.userId} companyId=${req.user!.companyId} endpoint=${req.method} ${req.path}`,
      cityId: null,
    });
  } catch {}
}

export async function listTimeEntriesHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const driverIdParam = req.query.driver_id ? parseInt(req.query.driver_id as string) : undefined;

    const conditions: any[] = [eq(timeEntries.companyId, companyId)];
    if (from) conditions.push(gte(timeEntries.workDate, from));
    if (to) conditions.push(lte(timeEntries.workDate, to));
    if (driverIdParam) conditions.push(eq(timeEntries.driverId, driverIdParam));

    const entries = await db
      .select()
      .from(timeEntries)
      .where(and(...conditions))
      .orderBy(desc(timeEntries.workDate), desc(timeEntries.createdAt));

    const driverIds = [...new Set(entries.map((e) => e.driverId))];
    const driverMap = new Map<number, any>();
    for (const did of driverIds) {
      const d = await storage.getDriver(did);
      if (d) driverMap.set(did, d);
    }

    const enriched = entries.map((e) => {
      const d = driverMap.get(e.driverId);
      return { ...e, driverName: d ? `${d.firstName} ${d.lastName}` : "Unknown", driverEmail: d?.email || "" };
    });

    res.json(enriched);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function driverTimeEntriesHandler(req: AuthRequest, res: Response) {
  try {
    const userId = req.user!.userId;
    const user = await storage.getUser(userId);
    if (!user?.driverId) {
      return res.status(403).json({ message: "Not linked to a driver profile" });
    }

    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const conditions: any[] = [eq(timeEntries.driverId, user.driverId)];
    if (from) conditions.push(gte(timeEntries.workDate, from));
    if (to) conditions.push(lte(timeEntries.workDate, to));

    const entries = await db
      .select()
      .from(timeEntries)
      .where(and(...conditions))
      .orderBy(desc(timeEntries.workDate));

    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function manualCreateHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const { driverId, workDate, startTime, endTime, breakMinutes, hoursNumeric, hourlyRateCents, notes } = req.body;

    if (!driverId || !workDate || hoursNumeric === undefined) {
      return res.status(400).json({ message: "driverId, workDate, and hoursNumeric are required" });
    }

    const driver = await storage.getDriver(parseInt(driverId));
    if (!driver || driver.companyId !== companyId) {
      await auditDenied(req, `Driver ${driverId} not in company ${companyId}`);
      return res.status(403).json({ message: "Driver not found in your company" });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(workDate)) {
      return res.status(400).json({ message: "workDate must be YYYY-MM-DD" });
    }

    const hours = parseFloat(hoursNumeric);
    if (isNaN(hours) || hours < 0 || hours > 24) {
      return res.status(400).json({ message: "hoursNumeric must be between 0 and 24" });
    }

    const [entry] = await db
      .insert(timeEntries)
      .values({
        companyId,
        driverId: parseInt(driverId),
        workDate,
        startTime: startTime || null,
        endTime: endTime || null,
        breakMinutes: parseInt(breakMinutes) || 0,
        hoursNumeric: String(hours),
        payType: "HOURLY",
        hourlyRateCents: hourlyRateCents ? parseInt(hourlyRateCents) : null,
        notes: notes || "",
        sourceType: "MANUAL",
        sourceRef: `manual:${Date.now()}`,
        status: "DRAFT",
        createdBy: req.user!.userId,
      })
      .returning();

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CREATE_TIME_ENTRY",
      entity: "time_entry",
      entityId: entry.id,
      details: `Manual time entry for driver ${driverId}, date ${workDate}, hours ${hours}`,
      cityId: null,
    });

    res.status(201).json(entry);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({ message: "Duplicate time entry for this driver/date/source" });
    }
    res.status(500).json({ message: err.message });
  }
}

export async function editTimeEntryHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const [entry] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)));
    if (!entry) {
      await auditDenied(req, `Time entry ${id} not found in company ${companyId}`);
      return res.status(404).json({ message: "Time entry not found" });
    }

    if (entry.status !== "DRAFT" && entry.status !== "REJECTED") {
      return res.status(400).json({ message: "Can only edit DRAFT or REJECTED entries" });
    }

    const { editReason, hoursNumeric, startTime, endTime, breakMinutes, hourlyRateCents, notes } = req.body;
    if (!editReason) {
      return res.status(400).json({ message: "editReason is required" });
    }

    const updates: any = { updatedAt: new Date() };
    if (hoursNumeric !== undefined) {
      const h = parseFloat(hoursNumeric);
      if (isNaN(h) || h < 0 || h > 24) return res.status(400).json({ message: "hoursNumeric must be 0-24" });
      updates.hoursNumeric = String(h);
    }
    if (startTime !== undefined) updates.startTime = startTime || null;
    if (endTime !== undefined) updates.endTime = endTime || null;
    if (breakMinutes !== undefined) updates.breakMinutes = parseInt(breakMinutes) || 0;
    if (hourlyRateCents !== undefined) updates.hourlyRateCents = hourlyRateCents ? parseInt(hourlyRateCents) : null;
    if (notes !== undefined) updates.notes = notes;
    updates.status = "DRAFT";

    const [updated] = await db.update(timeEntries).set(updates).where(eq(timeEntries.id, id)).returning();

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "EDIT_TIME_ENTRY",
      entity: "time_entry",
      entityId: id,
      details: `Edited: ${editReason}`,
      cityId: null,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function submitTimeEntryHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const [entry] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)));
    if (!entry) return res.status(404).json({ message: "Time entry not found" });
    if (entry.status !== "DRAFT") return res.status(400).json({ message: "Can only submit DRAFT entries" });

    const [updated] = await db.update(timeEntries).set({ status: "SUBMITTED", updatedAt: new Date() }).where(eq(timeEntries.id, id)).returning();
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function approveTimeEntryHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const [entry] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)));
    if (!entry) {
      await auditDenied(req, `Approve denied: entry ${id} not in company ${companyId}`);
      return res.status(404).json({ message: "Time entry not found" });
    }
    if (entry.status !== "SUBMITTED" && entry.status !== "DRAFT") {
      return res.status(400).json({ message: "Can only approve DRAFT or SUBMITTED entries" });
    }

    const [updated] = await db.update(timeEntries).set({
      status: "APPROVED",
      approvedBy: req.user!.userId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(timeEntries.id, id)).returning();

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "APPROVE_TIME_ENTRY",
      entity: "time_entry",
      entityId: id,
      details: `Approved time entry for driver ${entry.driverId}, date ${entry.workDate}`,
      cityId: null,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function rejectTimeEntryHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const [entry] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)));
    if (!entry) return res.status(404).json({ message: "Time entry not found" });
    if (entry.status === "PAID") return res.status(400).json({ message: "Cannot reject PAID entries" });

    const [updated] = await db.update(timeEntries).set({
      status: "REJECTED",
      updatedAt: new Date(),
    }).where(eq(timeEntries.id, id)).returning();

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "REJECT_TIME_ENTRY",
      entity: "time_entry",
      entityId: id,
      details: `Rejected: ${req.body.reason || "No reason provided"}`,
      cityId: null,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function markPaidTimeEntryHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const [entry] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, id), eq(timeEntries.companyId, companyId)));
    if (!entry) return res.status(404).json({ message: "Time entry not found" });
    if (entry.status !== "APPROVED") return res.status(400).json({ message: "Can only mark APPROVED entries as paid" });

    const [updated] = await db.update(timeEntries).set({
      status: "PAID",
      paidAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(timeEntries.id, id)).returning();

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "MARK_PAID_TIME_ENTRY",
      entity: "time_entry",
      entityId: id,
      details: `Marked as paid: driver ${entry.driverId}, date ${entry.workDate}, hours ${entry.hoursNumeric}`,
      cityId: null,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function csvImportHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const file = (req as any).file;
    if (!file) return res.status(400).json({ message: "CSV file required" });

    const csvText = file.buffer.toString("utf-8");
    const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim());
    if (lines.length < 2) return res.status(400).json({ message: "CSV must have header + at least one data row" });

    const headerLine = lines[0].toLowerCase().replace(/["\s]/g, "");
    const headers = headerLine.split(",");
    const emailIdx = headers.indexOf("driver_email");
    const dateIdx = headers.indexOf("work_date");
    const hoursIdx = headers.indexOf("hours");
    const rateIdx = headers.indexOf("hourly_rate");
    const notesIdx = headers.indexOf("notes");
    const startIdx = headers.indexOf("start_time");
    const endIdx = headers.indexOf("end_time");
    const breakIdx = headers.indexOf("break_minutes");

    if (emailIdx === -1) return res.status(400).json({ message: "CSV must have 'driver_email' column" });
    if (dateIdx === -1) return res.status(400).json({ message: "CSV must have 'work_date' column" });
    if (hoursIdx === -1) return res.status(400).json({ message: "CSV must have 'hours' column" });

    const companyDrivers = await db.select().from(drivers).where(eq(drivers.companyId, companyId));
    const emailToDriver = new Map<string, any>();
    for (const d of companyDrivers) {
      if (d.email) emailToDriver.set(d.email.toLowerCase(), d);
    }

    const [batch] = await db.insert(timeImportBatches).values({
      companyId,
      uploadedBy: req.user!.userId,
      filename: file.originalname || "import.csv",
      rowCount: lines.length - 1,
      status: "DRAFT",
    }).returning();

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const email = (cols[emailIdx] || "").trim().toLowerCase();
      const workDate = (cols[dateIdx] || "").trim();
      const hoursStr = (cols[hoursIdx] || "").trim();

      if (!email || !workDate || !hoursStr) {
        errors.push(`Row ${i}: missing required fields`);
        skipped++;
        continue;
      }

      if (!dateRegex.test(workDate)) {
        errors.push(`Row ${i}: invalid date format '${workDate}'`);
        skipped++;
        continue;
      }

      const hours = parseFloat(hoursStr);
      if (isNaN(hours) || hours < 0 || hours > 24) {
        errors.push(`Row ${i}: invalid hours '${hoursStr}'`);
        skipped++;
        continue;
      }

      const driver = emailToDriver.get(email);
      if (!driver) {
        errors.push(`Row ${i}: driver '${email}' not found in company`);
        skipped++;
        continue;
      }

      const rateCents = rateIdx >= 0 && cols[rateIdx] ? Math.round(parseFloat(cols[rateIdx]) * 100) : null;
      const notes = notesIdx >= 0 ? (cols[notesIdx] || "").trim() : "";
      const startTime = startIdx >= 0 ? (cols[startIdx] || "").trim() || null : null;
      const endTime = endIdx >= 0 ? (cols[endIdx] || "").trim() || null : null;
      const breakMin = breakIdx >= 0 && cols[breakIdx] ? parseInt(cols[breakIdx]) || 0 : 0;

      try {
        await db.insert(timeEntries).values({
          companyId,
          driverId: driver.id,
          workDate,
          startTime,
          endTime,
          breakMinutes: breakMin,
          hoursNumeric: String(hours),
          payType: "HOURLY",
          hourlyRateCents: rateCents,
          notes,
          sourceType: "CSV",
          sourceRef: `${batch.id}:${i}`,
          status: "DRAFT",
          createdBy: req.user!.userId,
        });
        created++;
      } catch (err: any) {
        if (err.code === "23505") {
          errors.push(`Row ${i}: duplicate entry for ${email} on ${workDate}`);
          skipped++;
        } else {
          errors.push(`Row ${i}: ${err.message}`);
          skipped++;
        }
      }
    }

    const finalStatus = errors.length === lines.length - 1 ? "FAILED" : "PROCESSED";
    await db.update(timeImportBatches).set({
      createdCount: created,
      skippedCount: skipped,
      status: finalStatus,
      errorSummary: errors.join("\n"),
    }).where(eq(timeImportBatches.id, batch.id));

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "CSV_TIME_IMPORT",
      entity: "time_import_batch",
      entityId: batch.id,
      details: `Imported ${created} entries, skipped ${skipped}, from ${file.originalname}`,
      cityId: null,
    });

    const [updatedBatch] = await db.select().from(timeImportBatches).where(eq(timeImportBatches.id, batch.id));
    res.status(201).json({ batch: updatedBatch, created, skipped, errors: errors.slice(0, 20) });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export async function listImportBatchesHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const batches = await db
      .select()
      .from(timeImportBatches)
      .where(eq(timeImportBatches.companyId, companyId))
      .orderBy(desc(timeImportBatches.createdAt))
      .limit(limit);

    res.json(batches);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function csvTemplateHandler(_req: AuthRequest, res: Response) {
  const template = "driver_email,work_date,hours,hourly_rate,notes,start_time,end_time,break_minutes\njohn@example.com,2025-01-15,8.5,25.00,Regular shift,08:00,17:00,30\n";
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=timesheet_template.csv");
  res.send(template);
}

export async function generatePayrollHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const { periodStart, periodEnd } = req.query as { periodStart?: string; periodEnd?: string };
    if (!periodStart || !periodEnd) {
      return res.status(400).json({ message: "periodStart and periodEnd query params required (YYYY-MM-DD)" });
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(periodStart) || !dateRegex.test(periodEnd)) {
      return res.status(400).json({ message: "Invalid date format" });
    }

    const approved = await db
      .select()
      .from(timeEntries)
      .where(and(
        eq(timeEntries.companyId, companyId),
        eq(timeEntries.status, "APPROVED"),
        gte(timeEntries.workDate, periodStart),
        lte(timeEntries.workDate, periodEnd),
      ));

    if (approved.length === 0) {
      return res.status(400).json({ message: "No approved time entries found in this period" });
    }

    const [settings] = await db.select().from(companyPayrollSettings).where(eq(companyPayrollSettings.companyId, companyId));
    const defaultRateCents = settings?.hourlyRateCents || null;

    const grouped = new Map<number, { hours: number; cents: number }>();
    const missingRate: number[] = [];

    for (const e of approved) {
      const hours = parseFloat(e.hoursNumeric as string) || 0;
      const rateCents = e.hourlyRateCents || defaultRateCents;
      if (!rateCents) {
        missingRate.push(e.id);
        continue;
      }
      const cents = Math.round(hours * rateCents);
      const prev = grouped.get(e.driverId) || { hours: 0, cents: 0 };
      grouped.set(e.driverId, { hours: prev.hours + hours, cents: prev.cents + cents });
    }

    if (missingRate.length > 0 && grouped.size === 0) {
      return res.status(400).json({
        message: `No hourly rate found for ${missingRate.length} entries. Set hourly_rate_cents on entries or company payroll settings.`,
        entryIds: missingRate,
      });
    }

    const [run] = await db.insert(tpPayrollRuns).values({
      companyId,
      periodStart,
      periodEnd,
      status: "DRAFT",
      createdBy: req.user!.userId,
    }).returning();

    const items: any[] = [];
    for (const [driverId, totals] of grouped) {
      const [item] = await db.insert(tpPayrollItems).values({
        runId: run.id,
        companyId,
        driverId,
        totalHours: String(totals.hours),
        totalCents: totals.cents,
        currency: "USD",
        status: "DRAFT",
      }).returning();
      items.push(item);
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "GENERATE_TP_PAYROLL",
      entity: "tp_payroll_run",
      entityId: run.id,
      details: `Generated payroll run ${periodStart} to ${periodEnd}, ${items.length} drivers, ${approved.length} entries`,
      cityId: null,
    });

    res.status(201).json({ run, items, missingRateEntries: missingRate.length });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function listPayrollRunsHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const runs = await db
      .select()
      .from(tpPayrollRuns)
      .where(eq(tpPayrollRuns.companyId, companyId))
      .orderBy(desc(tpPayrollRuns.createdAt));

    res.json(runs);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function getPayrollRunHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const runId = parseInt(req.params.runId);
    if (isNaN(runId)) return res.status(400).json({ message: "Invalid run ID" });

    const [run] = await db.select().from(tpPayrollRuns).where(and(eq(tpPayrollRuns.id, runId), eq(tpPayrollRuns.companyId, companyId)));
    if (!run) return res.status(404).json({ message: "Payroll run not found" });

    const items = await db.select().from(tpPayrollItems).where(eq(tpPayrollItems.runId, runId));

    const driverIds = [...new Set(items.map((i) => i.driverId))];
    const driverMap = new Map<number, any>();
    for (const did of driverIds) {
      const d = await storage.getDriver(did);
      if (d) driverMap.set(did, d);
    }

    const enrichedItems = items.map((i) => {
      const d = driverMap.get(i.driverId);
      return { ...i, driverName: d ? `${d.firstName} ${d.lastName}` : "Unknown" };
    });

    res.json({ run, items: enrichedItems });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function finalizePayrollHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const runId = parseInt(req.params.runId);
    if (isNaN(runId)) return res.status(400).json({ message: "Invalid run ID" });

    const [run] = await db.select().from(tpPayrollRuns).where(and(eq(tpPayrollRuns.id, runId), eq(tpPayrollRuns.companyId, companyId)));
    if (!run) return res.status(404).json({ message: "Payroll run not found" });
    if (run.status !== "DRAFT") return res.status(400).json({ message: "Only DRAFT runs can be finalized" });

    const [updated] = await db.update(tpPayrollRuns).set({ status: "FINALIZED" }).where(eq(tpPayrollRuns.id, runId)).returning();

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "FINALIZE_TP_PAYROLL",
      entity: "tp_payroll_run",
      entityId: runId,
      details: `Finalized payroll run ${run.periodStart} to ${run.periodEnd}`,
      cityId: null,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function payPayrollHandler(req: AuthRequest, res: Response) {
  try {
    const companyId = requireCompanyOrFail(req, res);
    if (!companyId) return;

    const runId = parseInt(req.params.runId);
    if (isNaN(runId)) return res.status(400).json({ message: "Invalid run ID" });

    const [run] = await db.select().from(tpPayrollRuns).where(and(eq(tpPayrollRuns.id, runId), eq(tpPayrollRuns.companyId, companyId)));
    if (!run) return res.status(404).json({ message: "Payroll run not found" });
    if (run.status !== "FINALIZED") return res.status(400).json({ message: "Only FINALIZED runs can be paid" });

    const items = await db.select().from(tpPayrollItems).where(eq(tpPayrollItems.runId, runId));
    const transferResults: { driverId: number; status: string; transferId?: string; error?: string; amountCents: number }[] = [];
    let stripeConfigured = !!process.env.STRIPE_SECRET_KEY;
    let allSuccess = true;

    if (stripeConfigured) {
      const Stripe = (await import("stripe")).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      const idempotencyBase = `tp_payroll_${runId}`;

      for (const item of items) {
        try {
          const [driverAccount] = await db.select().from(driverStripeAccounts)
            .where(and(
              eq(driverStripeAccounts.driverId, item.driverId),
              eq(driverStripeAccounts.companyId, companyId)
            ));

          if (!driverAccount || driverAccount.status !== "ACTIVE" || !driverAccount.payoutsEnabled) {
            transferResults.push({ driverId: item.driverId, status: "no_stripe", amountCents: item.totalCents, error: "Driver Stripe account not active" });
            allSuccess = false;
            continue;
          }

          const transfer = await stripe.transfers.create({
            amount: item.totalCents,
            currency: "usd",
            destination: driverAccount.stripeAccountId,
            transfer_group: idempotencyBase,
            metadata: {
              tp_payroll_run_id: String(runId),
              driver_id: String(item.driverId),
              company_id: String(companyId),
              period: `${run.periodStart} to ${run.periodEnd}`,
            },
          }, {
            idempotencyKey: `${idempotencyBase}_driver_${item.driverId}`,
          });

          await db.update(tpPayrollItems).set({ status: "PAID" }).where(eq(tpPayrollItems.id, item.id));
          transferResults.push({ driverId: item.driverId, status: "transferred", transferId: transfer.id, amountCents: item.totalCents });
        } catch (err: any) {
          console.error(`[TP-Payroll] Stripe transfer failed for driver ${item.driverId}:`, err.message);
          transferResults.push({ driverId: item.driverId, status: "failed", error: err.message, amountCents: item.totalCents });
          allSuccess = false;
        }
      }
    } else {
      await db.update(tpPayrollItems).set({ status: "PAID" }).where(eq(tpPayrollItems.runId, runId));
      for (const item of items) {
        transferResults.push({ driverId: item.driverId, status: "manual", amountCents: item.totalCents });
      }
    }

    const finalStatus = allSuccess ? "PAID" : "PAID";
    const [updated] = await db.update(tpPayrollRuns).set({ status: finalStatus }).where(eq(tpPayrollRuns.id, runId)).returning();

    const now = new Date();
    const paidDriverIds = transferResults
      .filter(r => r.status === "transferred" || r.status === "manual")
      .map(r => r.driverId);

    for (const driverId of paidDriverIds) {
      await db.update(timeEntries).set({ status: "PAID", paidAt: now, updatedAt: now })
        .where(and(
          eq(timeEntries.companyId, companyId),
          eq(timeEntries.driverId, driverId),
          eq(timeEntries.status, "APPROVED"),
          gte(timeEntries.workDate, run.periodStart),
          lte(timeEntries.workDate, run.periodEnd),
        ));
    }

    const transferCount = transferResults.filter(r => r.status === "transferred").length;
    const failCount = transferResults.filter(r => r.status === "failed" || r.status === "no_stripe").length;

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "PAY_TP_PAYROLL",
      entity: "tp_payroll_run",
      entityId: runId,
      details: stripeConfigured
        ? `Payroll run PAID: ${run.periodStart} to ${run.periodEnd}. Transferred: ${transferCount}, Failed: ${failCount}`
        : `Payroll run marked PAID (manual): ${run.periodStart} to ${run.periodEnd}`,
      cityId: null,
    });

    res.json({
      ...updated,
      transfers: transferResults,
      stripeEnabled: stripeConfigured,
      note: stripeConfigured
        ? (failCount > 0 ? `${transferCount} transferred, ${failCount} failed` : `${transferCount} drivers paid via Stripe`)
        : "Stripe not configured. Entries marked PAID for manual payment.",
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function listStaffPayConfigsHandler(req: AuthRequest, res: Response) {
  const companyId = requireCompanyOrFail(req, res);
  if (!companyId) return;
  try {
    const { isNull } = await import("drizzle-orm");
    const allDrivers = await db
      .select({
        id: drivers.id,
        firstName: drivers.firstName,
        lastName: drivers.lastName,
        email: drivers.email,
        phone: drivers.phone,
        status: drivers.status,
      })
      .from(drivers)
      .where(and(eq(drivers.companyId, companyId), eq(drivers.active, true), isNull(drivers.deletedAt)));

    const configs = await db
      .select()
      .from(staffPayConfigs)
      .where(and(eq(staffPayConfigs.companyId, companyId), eq(staffPayConfigs.active, true)));

    const [defaultSettings] = await db
      .select()
      .from(companyPayrollSettings)
      .where(eq(companyPayrollSettings.companyId, companyId))
      .limit(1);

    const configMap = new Map(configs.map(c => [c.driverId, c]));

    const merged = allDrivers.map(d => {
      const override = configMap.get(d.id);
      return {
        driver: d,
        payConfig: override || null,
        effectivePayType: override?.payType || (defaultSettings?.payMode === "PER_TRIP" ? "PER_TRIP" : "HOURLY"),
        effectiveHourlyRateCents: override?.hourlyRateCents ?? defaultSettings?.hourlyRateCents ?? null,
        effectivePerTripFlatCents: override?.perTripFlatCents ?? defaultSettings?.perTripFlatCents ?? null,
        effectivePerTripPercentBps: override?.perTripPercentBps ?? defaultSettings?.perTripPercentBps ?? null,
        effectiveFixedSalaryCents: override?.fixedSalaryCents ?? null,
        hasOverride: !!override,
      };
    });

    res.json({ drivers: merged, companyDefaults: defaultSettings || null });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function upsertStaffPayConfigHandler(req: AuthRequest, res: Response) {
  const companyId = requireCompanyOrFail(req, res);
  if (!companyId) return;
  try {
    const { driverId, payType, hourlyRateCents, fixedSalaryCents, fixedPeriod, perTripFlatCents, perTripPercentBps, notes } = req.body;

    if (!driverId || !payType) {
      return res.status(400).json({ message: "driverId and payType are required" });
    }

    const validPayTypes = ["HOURLY", "FIXED", "PER_TRIP"];
    if (!validPayTypes.includes(payType)) {
      return res.status(400).json({ message: "payType must be HOURLY, FIXED, or PER_TRIP" });
    }

    const existing = await db
      .select()
      .from(staffPayConfigs)
      .where(and(eq(staffPayConfigs.companyId, companyId), eq(staffPayConfigs.driverId, driverId)))
      .limit(1);

    let result;
    if (existing.length > 0) {
      [result] = await db
        .update(staffPayConfigs)
        .set({
          payType,
          hourlyRateCents: hourlyRateCents ?? null,
          fixedSalaryCents: fixedSalaryCents ?? null,
          fixedPeriod: fixedPeriod ?? "MONTHLY",
          perTripFlatCents: perTripFlatCents ?? null,
          perTripPercentBps: perTripPercentBps ?? null,
          notes: notes ?? "",
          active: true,
          updatedAt: new Date(),
        })
        .where(eq(staffPayConfigs.id, existing[0].id))
        .returning();
    } else {
      [result] = await db
        .insert(staffPayConfigs)
        .values({
          companyId,
          driverId,
          payType,
          hourlyRateCents: hourlyRateCents ?? null,
          fixedSalaryCents: fixedSalaryCents ?? null,
          fixedPeriod: fixedPeriod ?? "MONTHLY",
          perTripFlatCents: perTripFlatCents ?? null,
          perTripPercentBps: perTripPercentBps ?? null,
          notes: notes ?? "",
        })
        .returning();
    }

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "UPSERT_STAFF_PAY_CONFIG",
      entity: "staff_pay_config",
      entityId: result.id,
      details: `Set ${payType} pay config for driver #${driverId}`,
      cityId: null,
    });

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}

export async function deleteStaffPayConfigHandler(req: AuthRequest, res: Response) {
  const companyId = requireCompanyOrFail(req, res);
  if (!companyId) return;
  try {
    const configId = parseInt(req.params.id);
    if (!configId) return res.status(400).json({ message: "Invalid config ID" });

    const [existing] = await db
      .select()
      .from(staffPayConfigs)
      .where(and(eq(staffPayConfigs.id, configId), eq(staffPayConfigs.companyId, companyId)));

    if (!existing) return res.status(404).json({ message: "Pay config not found" });

    await db
      .update(staffPayConfigs)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(staffPayConfigs.id, configId));

    await storage.createAuditLog({
      userId: req.user!.userId,
      action: "DELETE_STAFF_PAY_CONFIG",
      entity: "staff_pay_config",
      entityId: configId,
      details: `Removed pay override for driver #${existing.driverId}`,
      cityId: null,
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
}
