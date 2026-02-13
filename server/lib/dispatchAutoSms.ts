import { storage } from "../storage";
import { sendSms, normalizePhone, buildNotifyMessage, getDispatchPhone, type TripNotifyStatus } from "./twilioSms";

export async function autoNotifyPatient(
  tripId: number,
  status: TripNotifyStatus,
  extraVars?: { eta_minutes?: number | null }
) {
  try {
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

    const message = buildNotifyMessage(status, {
      pickup_time: `${trip.scheduledDate} ${trip.scheduledTime}`,
      driver_name: driverName,
      vehicle_label: vehicleLabel,
      eta_minutes: extraVars?.eta_minutes ?? null,
      dispatch_phone: getDispatchPhone(),
    });

    const result = await sendSms(phone, message);
    if (result.success) {
      console.log(`[SMS-AUTO] Sent ${status} for trip ${tripId} to ${phone}, SID: ${result.sid}`);
    } else {
      console.error(`[SMS-AUTO] Failed ${status} for trip ${tripId}: ${result.error}`);
    }
  } catch (err: any) {
    console.error(`[SMS-AUTO] Error sending ${status} for trip ${tripId}: ${err.message}`);
  }
}
