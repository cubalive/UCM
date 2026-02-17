import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authMiddleware, requireRole, type AuthRequest } from "../auth";
import { tripLockedGuard } from "./tripLockGuard";
import {
  sendSms,
  isTwilioConfigured,
  isValidE164,
  normalizePhone,
  buildNotifyMessage,
  getDispatchPhone,
  type TripNotifyStatus,
} from "./twilioSms";

const VALID_NOTIFY_STATUSES: TripNotifyStatus[] = [
  "scheduled",
  "driver_assigned",
  "en_route",
  "arriving_soon",
  "eta_10",
  "eta_5",
  "arrived",
  "picked_up",
  "completed",
  "canceled",
];

const sendSmsSchema = z.object({
  to: z.string().min(1),
  message: z.string().min(1).max(1600),
});

const tripNotifySchema = z.object({
  status: z.enum([
    "scheduled",
    "driver_assigned",
    "en_route",
    "arriving_soon",
    "eta_10",
    "eta_5",
    "arrived",
    "picked_up",
    "completed",
    "canceled",
  ]),
});

export function registerSmsRoutes(app: Express) {
  app.get("/api/sms/health", (_req, res) => {
    res.json({
      ok: true,
      twilioConfigured: isTwilioConfigured(),
      dispatchPhoneConfigured: !!getDispatchPhone(),
    });
  });

  app.post(
    "/api/sms/send",
    authMiddleware,
    requireRole("DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        if (!isTwilioConfigured()) {
          return res.status(503).json({ message: "SMS service not configured" });
        }
        const parsed = sendSmsSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid request: 'to' and 'message' required" });
        }

        const { message } = parsed.data;
        const to = normalizePhone(parsed.data.to);

        if (!to) {
          return res.status(400).json({ message: "Could not normalize phone number. Provide a valid US number." });
        }

        const optedOut = await storage.isPhoneOptedOut(to);
        if (optedOut) {
          return res.status(422).json({ message: "Recipient has opted out of SMS" });
        }

        const result = await sendSms(to, message);
        if (!result.success) {
          return res.status(502).json({ message: result.error || "SMS send failed" });
        }

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "SMS_SEND",
          entity: "sms",
          entityId: null,
          details: `SMS sent to ${to}: ${message.substring(0, 80)}`,
          cityId: null,
        });

        res.json({ ok: true, sid: result.sid });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post(
    "/api/trips/:id/notify",
    authMiddleware,
    requireRole("DISPATCH"),
    async (req: AuthRequest, res) => {
      try {
        if (!isTwilioConfigured()) {
          return res.status(503).json({ message: "SMS service not configured" });
        }
        const tripId = parseInt(req.params.id as string);
        if (isNaN(tripId)) {
          return res.status(400).json({ message: "Invalid trip ID" });
        }

        const parsed = tripNotifySchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            message: `Invalid status. Must be one of: ${VALID_NOTIFY_STATUSES.join(", ")}`,
          });
        }

        const trip = await storage.getTrip(tripId);
        if (!trip) {
          return res.status(404).json({ message: "Trip not found" });
        }
        if (tripLockedGuard(trip, req, res)) return;

        const patient = await storage.getPatient(trip.patientId);
        if (!patient) {
          return res.status(404).json({ message: "Patient not found" });
        }

        const patientPhone = patient.phone ? normalizePhone(patient.phone) : null;
        if (!patientPhone) {
          return res.status(422).json({ message: "Patient phone missing or could not be normalized" });
        }

        const optedOut = await storage.isPhoneOptedOut(patientPhone);
        if (optedOut) {
          return res.status(422).json({ message: "Patient has opted out of SMS" });
        }

        let driverName: string | undefined;
        let vehicleLabel: string | undefined;
        let etaMinutes: number | null = null;

        if (trip.driverId) {
          const driver = await storage.getDriver(trip.driverId);
          if (driver) {
            driverName = `${driver.firstName} ${driver.lastName}`;

            if (trip.vehicleId) {
              const vehicle = await storage.getVehicle(trip.vehicleId);
              if (vehicle) {
                vehicleLabel = `${vehicle.name} (${vehicle.licensePlate})`;
              }
            }

            if (parsed.data.status === "en_route" && driver.lastLat && driver.lastLng && trip.pickupLat && trip.pickupLng) {
              try {
                const { etaMinutes: calcEta } = await import("./googleMaps");
                const eta = await calcEta(
                  { lat: driver.lastLat, lng: driver.lastLng },
                  { lat: trip.pickupLat, lng: trip.pickupLng }
                );
                if (eta) {
                  etaMinutes = eta.minutes;
                }
              } catch {
              }
            }
          }
        }

        let trackingUrl: string | undefined;
        const trackingStatuses: TripNotifyStatus[] = ["driver_assigned", "en_route", "arriving_soon"];
        if (trackingStatuses.includes(parsed.data.status)) {
          try {
            const existing = await storage.getActiveTokenForTrip(tripId);
            if (existing) {
              trackingUrl = `${req.protocol}://${req.get("host")}/t/${existing.token}`;
            } else {
              const crypto = await import("crypto");
              const tokenValue = crypto.randomBytes(32).toString("hex");
              const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
              await storage.createTripShareToken({ tripId, token: tokenValue, expiresAt });
              trackingUrl = `${req.protocol}://${req.get("host")}/t/${tokenValue}`;
            }
          } catch {}
        }

        const message = buildNotifyMessage(parsed.data.status, {
          pickup_time: `${trip.scheduledDate} ${trip.pickupTime || trip.scheduledTime}`,
          driver_name: driverName,
          vehicle_label: vehicleLabel,
          eta_minutes: etaMinutes,
          dispatch_phone: getDispatchPhone(),
          tracking_url: trackingUrl,
          pickup_lat: trip.pickupLat ?? null,
          pickup_lng: trip.pickupLng ?? null,
        });

        const result = await sendSms(patientPhone, message);
        if (!result.success) {
          await storage.createTripSmsLog({ tripId, kind: parsed.data.status, toPhone: patientPhone, error: result.error || "SMS send failed" });
          return res.status(502).json({ message: result.error || "SMS send failed" });
        }

        await storage.createTripSmsLog({ tripId, kind: parsed.data.status, toPhone: patientPhone, providerSid: result.sid || null });

        await storage.createAuditLog({
          userId: req.user!.userId,
          action: "SMS_NOTIFY",
          entity: "trip",
          entityId: trip.id,
          details: `SMS notification (${parsed.data.status}) sent to patient ${patient.firstName} ${patient.lastName}`,
          cityId: trip.cityId,
        });

        res.json({
          ok: true,
          sid: result.sid,
          status: parsed.data.status,
          message,
          patient: `${patient.firstName} ${patient.lastName}`,
        });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/sms/test", authMiddleware, requireRole("SUPER_ADMIN"), async (req: AuthRequest, res) => {
    try {
      const to = req.query.to as string;
      if (!to) {
        return res.status(400).json({ message: "Query parameter 'to' is required (phone number)" });
      }
      if (!isTwilioConfigured()) {
        return res.status(503).json({ message: "Twilio is not configured" });
      }
      const normalized = normalizePhone(to);
      if (!normalized) {
        return res.status(400).json({ message: "Invalid phone number format" });
      }
      const optedOut = await storage.isPhoneOptedOut(normalized);
      if (optedOut) {
        return res.status(422).json({ message: "Phone number has opted out of SMS" });
      }
      const result = await sendSms(normalized, "United Care Mobility test message. Reply STOP to opt out.");
      if (!result.success) {
        return res.status(502).json({ message: result.error || "SMS send failed" });
      }
      res.json({ ok: true, sid: result.sid, to: normalized });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post(
    "/api/sms/simulate-eta",
    authMiddleware,
    requireRole("SUPER_ADMIN"),
    async (req: AuthRequest, res) => {
      try {
        const schema = z.object({
          tripId: z.number(),
          etaMinutes: z.number().min(0).max(120),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ message: "Required: tripId (number), etaMinutes (number 0-120)" });
        }

        const { tripId, etaMinutes: simEta } = parsed.data;

        const trip = await storage.getTrip(tripId);
        if (!trip) {
          return res.status(404).json({ message: "Trip not found" });
        }

        const results: { threshold: string; action: string }[] = [];

        if (simEta <= 10) {
          const already10 = await storage.hasSmsBeenSent(tripId, "eta_10");
          if (already10) {
            results.push({ threshold: "eta_10", action: "skipped (already sent)" });
          } else {
            const { autoNotifyPatient } = await import("./dispatchAutoSms");
            await autoNotifyPatient(tripId, "eta_10", { eta_minutes: simEta });
            results.push({ threshold: "eta_10", action: "sent" });
          }
        } else {
          results.push({ threshold: "eta_10", action: "not triggered (ETA > 10)" });
        }

        if (simEta <= 5) {
          const already5 = await storage.hasSmsBeenSent(tripId, "eta_5");
          if (already5) {
            results.push({ threshold: "eta_5", action: "skipped (already sent)" });
          } else {
            const { autoNotifyPatient } = await import("./dispatchAutoSms");
            await autoNotifyPatient(tripId, "eta_5", { eta_minutes: simEta });
            results.push({ threshold: "eta_5", action: "sent" });
          }
        } else {
          results.push({ threshold: "eta_5", action: "not triggered (ETA > 5)" });
        }

        res.json({ ok: true, tripId, simulatedEta: simEta, results });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.get("/api/eta/health", async (_req, res) => {
    try {
      const { isJobEngineRunning } = await import("./jobEngine");
      res.json({ ok: true, scheduler: isJobEngineRunning() });
    } catch (err: any) {
      res.json({ ok: false, scheduler: false, error: err.message });
    }
  });

  app.post(
    "/api/eta/run-once",
    authMiddleware,
    requireRole("SUPER_ADMIN"),
    async (_req: AuthRequest, res) => {
      try {
        const { runEtaCycleOnce } = await import("./etaEngine");
        const result = await runEtaCycleOnce();
        res.json({ ok: true, ...result });
      } catch (err: any) {
        res.status(500).json({ message: err.message });
      }
    }
  );

  app.post("/api/twilio/inbound", async (req, res) => {
    try {
      const body = (req.body.Body || "").trim().toUpperCase();
      const rawFrom = req.body.From || "";

      if (!rawFrom) {
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      const from = normalizePhone(rawFrom) || rawFrom;

      const stopWords = ["STOP", "UNSUBSCRIBE", "CANCEL", "QUIT", "END"];
      const startWords = ["START", "YES", "UNSTOP"];

      let responseText = "";

      if (stopWords.includes(body)) {
        await storage.setPhoneOptOut(from, true);
        responseText = "You have been unsubscribed. Reply START to re-subscribe.";
        console.log(`[SMS] Opt-out received from ${from}`);
      } else if (startWords.includes(body)) {
        await storage.setPhoneOptOut(from, false);
        responseText = "You have been re-subscribed to notifications.";
        console.log(`[SMS] Opt-in received from ${from}`);
      }

      const twiml = responseText
        ? `<Response><Message>${responseText}</Message></Response>`
        : "<Response></Response>";

      res.type("text/xml").send(twiml);
    } catch (err: any) {
      console.error("[SMS] Inbound webhook error:", err.message);
      res.type("text/xml").send("<Response></Response>");
    }
  });
}
