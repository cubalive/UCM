import { format, parseISO } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";

export function toUtcFromCityLocal(localISO: string, cityTz: string): Date {
  return fromZonedTime(localISO, cityTz);
}

export function toUtcISOFromCityLocal(localISO: string, cityTz: string): string {
  return toUtcFromCityLocal(localISO, cityTz).toISOString();
}

export function toCityLocalFromUtc(utcDate: Date | string, cityTz: string): Date {
  const d = typeof utcDate === "string" ? parseISO(utcDate) : utcDate;
  return toZonedTime(d, cityTz);
}

export function formatCityTime(
  utcDate: Date | string,
  cityTz: string,
  fmt: string = "MM/dd/yyyy hh:mm a"
): string {
  const zoned = toCityLocalFromUtc(utcDate, cityTz);
  return format(zoned, fmt);
}

export function formatCityDate(utcDate: Date | string, cityTz: string): string {
  return formatCityTime(utcDate, cityTz, "MM/dd/yyyy");
}

export function formatCityTimeOnly(utcDate: Date | string, cityTz: string): string {
  return formatCityTime(utcDate, cityTz, "hh:mm a");
}

export function nowInCity(cityTz: string): Date {
  return toZonedTime(new Date(), cityTz);
}

export function nowInCityISO(cityTz: string): string {
  return format(nowInCity(cityTz), "yyyy-MM-dd'T'HH:mm:ss");
}

export function cityNowDate(cityTz: string): string {
  return format(nowInCity(cityTz), "yyyy-MM-dd");
}

export function cityNowTime(cityTz: string): string {
  return format(nowInCity(cityTz), "HH:mm");
}

export function tripLocalDateTime(scheduledDate: string, pickupTime: string, tripTz: string): string {
  const localISO = `${scheduledDate}T${pickupTime}`;
  const zoned = toCityLocalFromUtc(toUtcFromCityLocal(localISO, tripTz), tripTz);
  return format(zoned, "MM/dd/yyyy hh:mm a");
}

export function formatTripPickupDisplay(scheduledDate: string, pickupTime: string, _tripTz: string): string {
  if (!scheduledDate || !pickupTime) return "N/A";
  const [y, m, d] = scheduledDate.split("-");
  const [hh, mm] = pickupTime.split(":");
  const hour = parseInt(hh, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${m}/${d}/${y} ${h12}:${mm} ${ampm}`;
}

export function formatTimeDisplay(time24: string): string {
  if (!time24) return "N/A";
  const [hh, mm] = time24.split(":");
  const hour = parseInt(hh, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${mm} ${ampm}`;
}

export function tzAbbreviation(cityTz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: cityTz,
      timeZoneName: "short",
    }).formatToParts(new Date());
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    return tzPart?.value || cityTz;
  } catch {
    return cityTz;
  }
}

export function formatTimestampInTz(
  timestamp: Date | string | null | undefined,
  cityTz: string,
  fmt: string = "MM/dd/yyyy hh:mm a"
): string {
  if (!timestamp) return "N/A";
  try {
    const d = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    if (isNaN(d.getTime())) return "N/A";
    return formatCityTime(d, cityTz, fmt);
  } catch {
    return "N/A";
  }
}
