import { formatTimestampInTz, formatTimeDisplay, formatTripPickupDisplay, tzAbbreviation } from "@shared/timeUtils";

export { formatTimestampInTz, formatTimeDisplay, formatTripPickupDisplay, tzAbbreviation };

export function formatPickupTimeDisplay(time24: string | null | undefined): string {
  if (!time24) return "N/A";
  return formatTimeDisplay(time24);
}

export function formatTripDateTime(scheduledDate: string | null | undefined, pickupTime: string | null | undefined): string {
  if (!scheduledDate) return "N/A";
  const [y, m, d] = scheduledDate.split("-");
  const datePart = `${m}/${d}/${y}`;
  if (!pickupTime) return datePart;
  return `${datePart} ${formatTimeDisplay(pickupTime)}`;
}

export function formatCreatedAt(timestamp: string | Date | null | undefined, tripTz: string): string {
  return formatTimestampInTz(timestamp, tripTz, "MM/dd/yyyy hh:mm a");
}

export function formatTimestampShort(timestamp: string | Date | null | undefined, tripTz: string): string {
  return formatTimestampInTz(timestamp, tripTz, "hh:mm a");
}

export function getTripTz(trip: { tripTimezone?: string | null; } | null | undefined, fallback: string = "America/Chicago"): string {
  return trip?.tripTimezone || fallback;
}

export function getCityTzFromTrip(trip: { tripTimezone?: string | null } | null, cities?: Array<{ id: number; timezone?: string }>, cityId?: number): string {
  if (trip?.tripTimezone) return trip.tripTimezone;
  if (cities && cityId) {
    const city = cities.find(c => c.id === cityId);
    if (city?.timezone) return city.timezone;
  }
  return "America/Chicago";
}
