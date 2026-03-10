import express, { type Express } from "express";
import { authMiddleware, requireRole, requirePermission, type AuthRequest } from "../auth";
import { requireTenantScope, requireCityAccess } from "../middleware";
import { idempotencyMiddleware } from "../lib/idempotency";
import { requireSubscription } from "../middleware/requireSubscription";
import { phiAuditDbMiddleware } from "../middleware/phiAuditMiddleware";
import {
  getRecurringSchedulesHandler,
  createRecurringScheduleHandler,
  updateRecurringScheduleHandler,
  deleteRecurringScheduleHandler,
  generateRecurringSchedulesHandler,
  assignTripHandler,
  getTripMessagesHandler,
  createTripMessageHandler,
  getTripsHandler,
  getTripByIdHandler,
  createTripHandler,
  updateTripHandler,
  updateTripStatusHandler,
  dialysisReturnCheckHandler,
  dialysisReturnAdjustHandler,
  approveTripHandler,
  cancelRequestHandler,
  rejectCancelHandler,
  cancelTripHandler,
  acceptTripHandler,
  createReturnTripHandler,
  recomputeRouteHandler,
  getTripRouteHandler,
  getTripRouteHistoryHandler,
  driverSignatureHandler,
  clinicSignatureHandler,
  getSignatureHandler,
  getTripPdfHandler,
  downloadTripPdfHandler,
  getTripInvoiceHandler,
  createTripInvoiceHandler,
  dispatchOverrideStatusHandler,
  getTripRouteProofHandler,
  getTripGpsHandler,
  patchTripPlacesHandler,
} from "../controllers/trips.controller";
import { archiveTripHandler, permanentDeleteTripHandler } from "../controllers/admin.controller";

const router = express.Router();

// PHI audit logging applied to all trip routes (HIPAA §164.312(b))
router.use(authMiddleware, phiAuditDbMiddleware as any);

router.get("/api/recurring-schedules", authMiddleware, requirePermission("trips", "read"), requireTenantScope, getRecurringSchedulesHandler as any);
router.post("/api/recurring-schedules", authMiddleware, requirePermission("trips", "write"), requireTenantScope, createRecurringScheduleHandler as any);
router.patch("/api/recurring-schedules/:id", authMiddleware, requirePermission("trips", "write"), requireTenantScope, updateRecurringScheduleHandler as any);
router.delete("/api/recurring-schedules/:id", authMiddleware, requirePermission("trips", "write"), requireTenantScope, deleteRecurringScheduleHandler as any);
router.post("/api/recurring-schedules/generate", authMiddleware, requireRole("SUPER_ADMIN"), generateRecurringSchedulesHandler as any);

router.patch("/api/trips/:id/assign", authMiddleware, requirePermission("dispatch", "write"), requireTenantScope, assignTripHandler as any);

router.get("/api/trips/:id/messages", authMiddleware, requirePermission("trips", "read"), requireTenantScope, getTripMessagesHandler as any);
router.post("/api/trips/:id/messages", authMiddleware, requirePermission("trips", "write"), requireTenantScope, createTripMessageHandler as any);

router.get("/api/trips", authMiddleware, requirePermission("trips", "read"), requireTenantScope, requireCityAccess, getTripsHandler as any);
router.get("/api/trips/:id", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "SUPER_ADMIN", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER"), requireTenantScope, getTripByIdHandler as any);
router.post("/api/trips", authMiddleware, requireRole("ADMIN", "DISPATCH", "VIEWER", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "SUPER_ADMIN"), requireTenantScope, requireSubscription, idempotencyMiddleware, createTripHandler as any);
router.patch("/api/trips/:id", authMiddleware, requirePermission("trips", "write"), requireTenantScope, updateTripHandler as any);

router.patch("/api/trips/:id/status", authMiddleware, requireRole("ADMIN", "DISPATCH", "DRIVER", "SUPER_ADMIN", "COMPANY_ADMIN"), requireTenantScope, updateTripStatusHandler as any);
router.post("/api/trips/:id/status/override", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN"), requireTenantScope, dispatchOverrideStatusHandler as any);

router.post("/api/trips/:id/accept", authMiddleware, requireRole("DRIVER"), requireTenantScope, acceptTripHandler as any);

router.get("/api/trips/:id/dialysis-return-check", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN"), requireTenantScope, dialysisReturnCheckHandler as any);
router.post("/api/trips/:id/dialysis-return-adjust", authMiddleware, requireRole("ADMIN", "DISPATCH", "SUPER_ADMIN", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN"), requireTenantScope, dialysisReturnAdjustHandler as any);

router.patch("/api/trips/:id/approve", authMiddleware, requirePermission("trips", "write"), requireTenantScope, approveTripHandler as any);
router.patch("/api/trips/:id/cancel-request", authMiddleware, requireRole("VIEWER", "CLINIC_USER", "CLINIC_ADMIN"), requireTenantScope, cancelRequestHandler as any);
router.patch("/api/trips/:id/reject-cancel", authMiddleware, requirePermission("trips", "write"), requireTenantScope, rejectCancelHandler as any);
router.patch("/api/trips/:id/cancel", authMiddleware, requirePermission("trips", "write"), requireTenantScope, cancelTripHandler as any);
router.post("/api/trips/:id/cancel", authMiddleware, requirePermission("trips", "write"), requireTenantScope, cancelTripHandler as any);

router.post("/api/trips/:id/archive", authMiddleware, requirePermission("trips", "write"), requireTenantScope, archiveTripHandler as any);
router.delete("/api/trips/:id", authMiddleware, requireRole("SUPER_ADMIN"), requireTenantScope, permanentDeleteTripHandler as any);

router.post("/api/trips/:id/return-trip", authMiddleware, requirePermission("trips", "write"), requireTenantScope, createReturnTripHandler as any);
router.get("/api/trips/:id/route", authMiddleware, requirePermission("trips", "read"), requireTenantScope, getTripRouteHandler as any);
router.get("/api/trips/:id/route/history", authMiddleware, requirePermission("trips", "read"), requireTenantScope, getTripRouteHistoryHandler as any);
router.post("/api/trips/:id/route/recompute", authMiddleware, requirePermission("dispatch", "write"), requireTenantScope, recomputeRouteHandler as any);
router.get("/api/trips/:id/route/proof", authMiddleware, requirePermission("trips", "read"), requireTenantScope, getTripRouteProofHandler as any);

router.get("/api/trips/:id/gps", authMiddleware, requirePermission("trips", "read"), requireTenantScope, getTripGpsHandler as any);
router.patch("/api/trips/:id/places", authMiddleware, requirePermission("dispatch", "write"), requireTenantScope, patchTripPlacesHandler as any);

router.get("/api/trips/:id/gps-quality", authMiddleware, requirePermission("trips", "read"), requireTenantScope, async (req: any, res: any) => {
  try {
    const tripId = parseInt(req.params.id);
    if (isNaN(tripId)) return res.status(400).json({ error: "Invalid trip ID" });
    const { computeTripPingQuality } = await import("../lib/gpsPingQuality");
    const quality = await computeTripPingQuality(tripId);
    res.json({ ok: true, tripId, ...quality });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to compute GPS quality" });
  }
});

router.post("/api/trips/:id/signature/driver", authMiddleware, requireRole("DRIVER", "SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), requireTenantScope, driverSignatureHandler as any);
router.post("/api/trips/:id/signature/clinic", authMiddleware, requireRole("CLINIC_USER", "CLINIC_ADMIN", "SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), requireTenantScope, clinicSignatureHandler as any);
router.get("/api/trips/:id/signature", authMiddleware, requirePermission("trips", "read"), requireTenantScope, getSignatureHandler as any);

router.get("/api/trips/:id/pdf", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER", "DRIVER"), requireTenantScope, getTripPdfHandler as any);
router.get("/api/trips/:id/pdf/download", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER", "DRIVER"), requireTenantScope, downloadTripPdfHandler as any);

router.get("/api/trips/:id/invoice", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN", "CLINIC_USER", "CLINIC_ADMIN", "CLINIC_VIEWER"), requireTenantScope, getTripInvoiceHandler as any);
router.post("/api/trips/:id/invoice", authMiddleware, requirePermission("invoices", "write"), requireTenantScope, requireSubscription, createTripInvoiceHandler as any);

router.get("/api/trips/:id/financials", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "DISPATCH", "COMPANY_ADMIN"), requireTenantScope, async (req: any, res: any) => {
  try {
    const tripId = parseInt(req.params.id);
    if (isNaN(tripId)) return res.status(400).json({ error: "Invalid trip ID" });
    const { getTripFinancialBreakdown } = await import("../services/financialEngine");
    const breakdown = await getTripFinancialBreakdown(tripId);
    if (!breakdown) return res.status(404).json({ error: "Trip not found or no billing data" });
    res.json(breakdown);
  } catch (err: any) {
    console.error("[FINANCIALS] Error:", err.message);
    res.status(500).json({ error: "Failed to load financial breakdown" });
  }
});

router.get("/api/company/:companyId/ledger-summary", authMiddleware, requireRole("SUPER_ADMIN", "ADMIN", "COMPANY_ADMIN"), requireTenantScope, async (req: any, res: any) => {
  try {
    const companyId = parseInt(req.params.companyId);
    if (isNaN(companyId)) return res.status(400).json({ error: "Invalid company ID" });
    const { dateFrom, dateTo } = req.query;
    const { getCompanyLedgerSummary } = await import("../services/financialEngine");
    const summary = await getCompanyLedgerSummary(companyId, dateFrom, dateTo);
    res.json(summary);
  } catch (err: any) {
    console.error("[LEDGER] Error:", err.message);
    res.status(500).json({ error: "Failed to load ledger summary" });
  }
});

// ─── Trip Notes ─────────────────────────────────────────────────────────────
router.get("/api/trips/:tripId/notes", authMiddleware, requirePermission("trips", "read"), requireTenantScope, async (req: AuthRequest, res: any) => {
  try {
    const tripId = parseInt(req.params.tripId as string);
    if (isNaN(tripId)) return res.status(400).json({ error: "Invalid trip ID" });
    const { getNotes } = await import("../lib/tripNotesService");
    const viewerRole = req.user?.role || "VIEWER";
    const notes = await getNotes(tripId, viewerRole);
    res.json({ ok: true, notes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/trips/:tripId/notes", authMiddleware, requirePermission("trips", "write"), requireTenantScope, async (req: AuthRequest, res: any) => {
  try {
    const tripId = parseInt(req.params.tripId as string);
    if (isNaN(tripId)) return res.status(400).json({ error: "Invalid trip ID" });
    const { noteType, content, isInternal } = req.body;
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(400).json({ error: "Company context required" });
    const { addNote } = await import("../lib/tripNotesService");
    const note = await addNote(tripId, companyId, req.user!.userId, req.user!.role, noteType || "general", content, isInternal || false);
    res.json({ ok: true, note });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/api/trips/:tripId/notes/:noteId", authMiddleware, requirePermission("trips", "write"), requireTenantScope, async (req: AuthRequest, res: any) => {
  try {
    const noteId = parseInt(req.params.noteId as string);
    if (isNaN(noteId)) return res.status(400).json({ error: "Invalid note ID" });
    const { content } = req.body;
    const { editNote } = await import("../lib/tripNotesService");
    const note = await editNote(noteId, req.user!.userId, content);
    res.json({ ok: true, note });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/api/trips/:tripId/notes/:noteId", authMiddleware, requirePermission("trips", "write"), requireTenantScope, async (req: AuthRequest, res: any) => {
  try {
    const noteId = parseInt(req.params.noteId as string);
    if (isNaN(noteId)) return res.status(400).json({ error: "Invalid note ID" });
    const { deleteNote } = await import("../lib/tripNotesService");
    const note = await deleteNote(noteId, req.user!.userId);
    res.json({ ok: true, note });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/api/trips/:tripId/notes/:noteId/pin", authMiddleware, requirePermission("trips", "write"), requireTenantScope, async (req: AuthRequest, res: any) => {
  try {
    const noteId = parseInt(req.params.noteId as string);
    if (isNaN(noteId)) return res.status(400).json({ error: "Invalid note ID" });
    const { pinNote } = await import("../lib/tripNotesService");
    const note = await pinNote(noteId);
    res.json({ ok: true, note });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export function registerTripRoutes(app: Express) {
  app.use(router);
}
