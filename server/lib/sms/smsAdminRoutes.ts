import type { Express } from "express";
import { z } from "zod";
import { authMiddleware, requireRole, type AuthRequest } from "../../auth";
import { sendSms, getSmsMetrics, type SmsEventType } from "./smsService";
import { getBootStatus } from "./twilioClient";
import { buildSmsBody, previewSmsBody, type TemplateData } from "./smsTemplates";
import { sendTripSms } from "./tripNotifier";
import { storage } from "../../storage";
import { pool } from "../../db";
import { normalizePhone, maskPhone, isValidE164, getDispatchPhone } from "./twilioClient";

const gate = [authMiddleware, requireRole("SUPER_ADMIN")] as any[];

export function registerSmsAdminRoutes(app: Express) {
  app.post("/api/admin/sms/test", ...gate, async (req: any, res: any) => {
    try {
      const schema = z.object({ to: z.string().min(5) });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, message: "Body requires { to: \"+1...\" }" });
      }

      const normalized = normalizePhone(parsed.data.to);
      if (!normalized || !isValidE164(normalized)) {
        return res.status(400).json({ ok: false, message: "Invalid phone number format. Use E.164 (+1XXXXXXXXXX)" });
      }

      const userId = (req as AuthRequest).user?.userId;
      const result = await sendSms({
        companyId: 0,
        to: normalized,
        body: buildSmsBody("TEST", {}),
        purpose: "TEST",
      });

      if (result.success) {
        try {
          await storage.createAuditLog({
            userId: userId || null,
            action: "SMS_TEST",
            entity: "sms",
            entityId: null,
            details: `Test SMS sent to ${maskPhone(normalized)}, SID: ${result.sid}`,
            cityId: null,
          });
        } catch {}
      }

      res.json({
        ok: result.success,
        status: result.status,
        sid: result.sid || null,
        error: result.errorMessage || null,
        to: maskPhone(normalized),
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.post("/api/admin/sms/preview", ...gate, async (req: any, res: any) => {
    try {
      const schema = z.object({
        tripId: z.number().optional(),
        purpose: z.string(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, message: "Body requires { purpose: string, tripId?: number }" });
      }

      const purpose = parsed.data.purpose as SmsEventType;
      let templateData: TemplateData = {
        patientFirstName: "John",
        driverName: "Jane Smith",
        vehicleSummary: "Toyota Camry Silver plate ***1234",
        pickupTime: "10:30 AM",
        pickupDate: "2025-01-15",
        trackingUrl: "https://app.unitedcaremobility.com/t/abc123",
        dispatchPhone: getDispatchPhone() || "+1555XXXXXXX",
      };

      if (parsed.data.tripId) {
        try {
          const trip = await storage.getTrip(parsed.data.tripId);
          if (trip) {
            const patient = await storage.getPatient(trip.patientId);
            templateData.patientFirstName = patient?.firstName || undefined;
            templateData.pickupTime = trip.pickupTime || trip.scheduledTime || undefined;
            templateData.pickupDate = trip.scheduledDate || undefined;

            if (trip.driverId) {
              const driver = await storage.getDriver(trip.driverId);
              if (driver) templateData.driverName = `${driver.firstName} ${driver.lastName}`;
              if (trip.vehicleId) {
                const vehicle = await storage.getVehicle(trip.vehicleId);
                if (vehicle) {
                  const parts = [vehicle.make, vehicle.model, (vehicle as any).color].filter(Boolean);
                  const plate = vehicle.licensePlate ? `plate ***${vehicle.licensePlate.slice(-4)}` : "";
                  templateData.vehicleSummary = [...parts, plate].filter(Boolean).join(" ");
                }
              }
            }

            if (trip.companyId) {
              try {
                const company = await storage.getCompany(trip.companyId);
                if (company?.dispatchPhone) templateData.dispatchPhone = company.dispatchPhone;
              } catch {}
            }
          }
        } catch {}
      }

      const preview = previewSmsBody(purpose, templateData);

      res.json({
        ok: true,
        purpose,
        tripId: parsed.data.tripId || null,
        ...preview,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.get("/api/admin/sms/health", ...gate, async (_req: any, res: any) => {
    try {
      const boot = getBootStatus();
      const metrics = getSmsMetrics();

      const now24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      let counts: Record<string, number> = {};
      let lastError: { code: string; message: string; at: string } | null = null;
      let lastSid: string | null = null;

      try {
        const client = await pool.connect();
        try {
          const countRows = await client.query(
            `SELECT status, COUNT(*)::int AS cnt FROM sms_events WHERE created_at >= $1 GROUP BY status`,
            [now24h]
          );
          for (const r of countRows.rows) {
            counts[r.status] = r.cnt;
          }

          const errRow = await client.query(
            `SELECT error_code, error_message, created_at FROM sms_events WHERE status = 'failed' ORDER BY created_at DESC LIMIT 1`
          );
          if (errRow.rows[0]) {
            lastError = {
              code: errRow.rows[0].error_code || "unknown",
              message: errRow.rows[0].error_message || "unknown",
              at: errRow.rows[0].created_at,
            };
          }

          const sidRow = await client.query(
            `SELECT twilio_sid FROM sms_events WHERE twilio_sid IS NOT NULL ORDER BY created_at DESC LIMIT 1`
          );
          if (sidRow.rows[0]) {
            const sid = sidRow.rows[0].twilio_sid;
            lastSid = sid ? `${sid.slice(0, 6)}***${sid.slice(-4)}` : null;
          }
        } finally {
          client.release();
        }
      } catch {}

      let tripLogCounts: Record<string, number> = {};
      try {
        const client = await pool.connect();
        try {
          const rows = await client.query(
            `SELECT 
               COUNT(*) FILTER (WHERE error IS NULL OR error = '')::int AS sent,
               COUNT(*) FILTER (WHERE error IS NOT NULL AND error != '')::int AS failed
             FROM trip_sms_log WHERE sent_at >= $1`,
            [now24h]
          );
          if (rows.rows[0]) {
            tripLogCounts = { sent: rows.rows[0].sent, failed: rows.rows[0].failed };
          }
        } finally {
          client.release();
        }
      } catch {}

      const sent24h = (counts.sent || 0) + (tripLogCounts.sent || 0);
      const failed24h = (counts.failed || 0) + (tripLogCounts.failed || 0);
      const total24h = sent24h + failed24h + (counts.skipped || 0) + (counts.rate_limited || 0);
      const failRate = total24h > 0 ? (failed24h / total24h * 100).toFixed(1) : "0.0";

      let healthState: "HEALTHY" | "GOOD" | "CRITICAL" = "HEALTHY";
      let healthReason = "SMS system operational";

      if (!boot.configured) {
        healthState = "CRITICAL";
        healthReason = `Twilio not configured: ${boot.errors.join("; ")}`;
      } else if (failed24h > 10 || parseFloat(failRate) > 10) {
        healthState = "CRITICAL";
        healthReason = `High failure rate: ${failRate}% (${failed24h} failed of ${total24h})`;
      } else if (failed24h > 0 || parseFloat(failRate) > 2) {
        healthState = "GOOD";
        healthReason = `Some failures: ${failRate}% (${failed24h} failed of ${total24h})`;
      }

      res.json({
        ok: true,
        configured: boot.configured,
        fromNumberMasked: boot.fromNumberMasked,
        credentialErrors: boot.errors,
        healthState,
        healthReason,
        metrics: {
          sent24h,
          failed24h,
          skipped24h: counts.skipped || 0,
          rateLimited24h: counts.rate_limited || 0,
          duplicates24h: counts.duplicate || 0,
          total24h,
          failRatePct: failRate,
        },
        lastTwilioSid: lastSid,
        lastError,
        lastSendAt: metrics.lastSendAt,
        inMemoryMetrics: metrics,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  app.get("/api/admin/sms/events", ...gate, async (req: any, res: any) => {
    try {
      const companyId = req.query.companyId ? parseInt(req.query.companyId) : null;
      const tripId = req.query.tripId ? parseInt(req.query.tripId) : null;
      const limit = Math.min(parseInt(req.query.limit || "50"), 200);
      const status = req.query.status as string || null;

      let where = "WHERE 1=1";
      const params: any[] = [];
      let paramIdx = 1;

      if (companyId) {
        where += ` AND company_id = $${paramIdx++}`;
        params.push(companyId);
      }
      if (tripId) {
        where += ` AND trip_id = $${paramIdx++}`;
        params.push(tripId);
      }
      if (status) {
        where += ` AND status = $${paramIdx++}`;
        params.push(status);
      }

      const client = await pool.connect();
      try {
        const result = await client.query(
          `SELECT id, company_id, trip_id, patient_id, driver_id, to_phone, from_phone, purpose, status, twilio_sid, error_code, error_message, created_at
           FROM sms_events ${where}
           ORDER BY created_at DESC
           LIMIT $${paramIdx}`,
          [...params, limit]
        );

        res.json({
          ok: true,
          count: result.rows.length,
          events: result.rows,
        });
      } finally {
        client.release();
      }
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });
}
