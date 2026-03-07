import crypto from "crypto";
import { storage } from "../../storage";
import { sendSms, type SmsEventType, normalizePhone, getDispatchPhone } from "./smsService";
import { buildSmsBody, type TemplateData } from "./smsTemplates";

const TRACKING_EVENTS: SmsEventType[] = ["TRIP_CONFIRMED", "REMINDER_24H", "DRIVER_ASSIGNED", "EN_ROUTE"];

function getBaseUrl(): string {
  return process.env.PUBLIC_BASE_URL_APP
    || process.env.PUBLIC_BASE_URL
    || (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://app.unitedcaremobility.com");
}

function formatVehicleSummary(vehicle: any): string {
  const parts: string[] = [];
  if (vehicle.make) parts.push(vehicle.make);
  if (vehicle.model) parts.push(vehicle.model);
  if ((vehicle as any).color) parts.push((vehicle as any).color);
  const plateLast4 = vehicle.licensePlate ? vehicle.licensePlate.slice(-4) : "";
  if (plateLast4) parts.push(`plate ***${plateLast4}`);
  return parts.length > 0 ? parts.join(" ") : vehicle.name || "Vehicle";
}

export async function sendTripSms(
  tripId: number,
  eventType: SmsEventType,
  extras?: { etaMinutes?: number | null }
): Promise<void> {
  try {
    const trip = await storage.getTrip(tripId);
    if (!trip) {
      console.warn(`[SMS-TRIP] tripId=${tripId} event=${eventType} skipped: trip not found`);
      return;
    }

    if (!trip.companyId) {
      console.warn(`[SMS-TRIP] tripId=${tripId} event=${eventType} skipped: no company_id`);
      return;
    }

    const patient = await storage.getPatient(trip.patientId);
    if (!patient) {
      console.warn(`[SMS-TRIP] tripId=${tripId} event=${eventType} skipped: patient not found`);
      return;
    }

    const phone = patient.phone ? normalizePhone(patient.phone) : null;
    if (!phone) {
      console.warn(`[SMS-TRIP] tripId=${tripId} event=${eventType} skipped: no valid patient phone`);
      return;
    }

    let driverName: string | undefined;
    let vehicleSummary: string | undefined;
    let driverId: number | undefined;

    if (trip.driverId) {
      driverId = trip.driverId;
      const driver = await storage.getDriver(trip.driverId);
      if (driver) {
        driverName = `${driver.firstName} ${driver.lastName}`;
        if (trip.vehicleId) {
          try {
            const vehicle = await storage.getVehicle(trip.vehicleId);
            if (vehicle) vehicleSummary = formatVehicleSummary(vehicle);
          } catch {}
        }
      }
    }

    let trackingUrl: string | undefined;
    if (TRACKING_EVENTS.includes(eventType)) {
      try {
        const baseUrl = getBaseUrl();
        const existing = await storage.getActiveTokenForTrip(tripId);
        if (existing) {
          trackingUrl = `${baseUrl}/t/${existing.token}`;
        } else {
          const tokenValue = crypto.randomBytes(32).toString("hex");
          const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
          await storage.createTripShareToken({ tripId, token: tokenValue, expiresAt });
          trackingUrl = `${baseUrl}/t/${tokenValue}`;
        }
      } catch (err: any) {
        console.error(`[SMS-TRIP] tripId=${tripId} tracking token error: ${err.message}`);
      }
    }

    let dispatchPhone: string | undefined;
    if (trip.companyId) {
      try {
        const company = await storage.getCompany(trip.companyId);
        if (company?.dispatchPhone) dispatchPhone = company.dispatchPhone;
      } catch {}
    }
    if (!dispatchPhone) {
      dispatchPhone = getDispatchPhone() || undefined;
    }

    const templateData: TemplateData = {
      patientFirstName: patient.firstName || undefined,
      driverName,
      vehicleSummary,
      pickupTime: trip.pickupTime || trip.scheduledTime || undefined,
      pickupDate: trip.scheduledDate || undefined,
      etaMinutes: extras?.etaMinutes ?? null,
      trackingUrl,
      dispatchPhone,
    };

    const body = buildSmsBody(eventType, templateData);

    await sendSms({
      companyId: trip.companyId,
      to: phone,
      body,
      purpose: eventType,
      tripId: trip.id,
      patientId: trip.patientId,
      driverId,
    });
  } catch (err: any) {
    console.error(`[SMS-TRIP] tripId=${tripId} event=${eventType} error: ${err.message}`);
  }
}
