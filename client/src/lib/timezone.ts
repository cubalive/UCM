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

/** Format any date-like value to MM/DD/YYYY */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "N/A";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "N/A";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/** Format any date-like value to MM/DD/YYYY HH:MM AM/PM */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "N/A";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "N/A";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hours = d.getHours();
  const ampm = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd}/${yyyy} ${h12}:${min} ${ampm}`;
}
