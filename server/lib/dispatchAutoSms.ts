import crypto from "crypto";
import { storage } from "../storage";
import { sendSms, normalizePhone, buildNotifyMessage, getDispatchPhone, type TripNotifyStatus } from "./twilioSms";

const TRACKING_STATUSES: TripNotifyStatus[] = ["driver_assigned", "en_route", "arriving_soon"];

export async function autoNotifyPatient(
  tripId: number,
  status: TripNotifyStatus,
  extraVars?: { eta_minutes?: number | null; base_url?: string }
) {
  try {
    const alreadySent = await storage.hasSmsBeenSent(tripId, status);
    if (alreadySent) {
      console.log(`[SMS-AUTO] Skipped ${status} for trip ${tripId}: already sent`);
      return;
    }

    const trip = await storage.getTrip(tripId);
    if (!trip) return;

    const patient = await storage.getPatient(trip.patientId);
    if (!patient?.phone) return;

    const phone = normalizePhone(patient.phone);
    if (!phone) return;

    const optedOut = await storage.isPhoneOptedOut(phone);
    if (optedOut) {
      console.log(`[SMS-AUTO] Skipped ${status} for trip ${tripId}: patient opted out`);
      return;
    }

    let driverName: string | undefined;
    let vehicleLabel: string | undefined;

    if (trip.driverId) {
      const driver = await storage.getDriver(trip.driverId);
      if (driver) {
        driverName = `${driver.firstName} ${driver.lastName}`;
        if (trip.vehicleId) {
          const vehicle = await storage.getVehicle(trip.vehicleId);
          if (vehicle) vehicleLabel = `${vehicle.name} (${vehicle.licensePlate})`;
        }
      }
    }

    let trackingUrl: string | undefined;
    if (TRACKING_STATUSES.includes(status)) {
      try {
        const base = extraVars?.base_url
          ? extraVars.base_url
          : process.env.REPLIT_DEV_DOMAIN
            ? `https://${process.env.REPLIT_DEV_DOMAIN}`
            : "https://localhost:5000";

        const existing = await storage.getActiveTokenForTrip(tripId);
        if (existing) {
          trackingUrl = `${base}/t/${existing.token}`;
        } else {
          const tokenValue = crypto.randomBytes(32).toString("hex");
          const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
          await storage.createTripShareToken({ tripId, token: tokenValue, expiresAt });
          trackingUrl = `${base}/t/${tokenValue}`;
        }
      } catch (err: any) {
        console.error(`[SMS-AUTO] Failed to generate tracking URL for trip ${tripId}:`, err.message);
      }
    }

    const message = buildNotifyMessage(status, {
      pickup_time: `${trip.scheduledDate} ${trip.pickupTime || trip.scheduledTime}`,
      driver_name: driverName,
      vehicle_label: vehicleLabel,
      eta_minutes: extraVars?.eta_minutes ?? null,
      dispatch_phone: getDispatchPhone(),
      tracking_url: trackingUrl,
      pickup_lat: trip.pickupLat ?? null,
      pickup_lng: trip.pickupLng ?? null,
    });

    const result = await sendSms(phone, message);
    if (result.success) {
      console.log(`[SMS-AUTO] Sent ${status} for trip ${tripId} to ${phone}, SID: ${result.sid}`);
      await storage.createTripSmsLog({ tripId, kind: status });
    } else {
      console.error(`[SMS-AUTO] Failed ${status} for trip ${tripId}: ${result.error}`);
    }
  } catch (err: any) {
    console.error(`[SMS-AUTO] Error sending ${status} for trip ${tripId}: ${err.message}`);
  }
}
