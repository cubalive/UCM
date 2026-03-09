/**
 * Frontend timezone utilities.
 *
 * Rules:
 * 1. Browser timezone is NEVER the source of truth
 * 2. All display uses the operational timezone passed from the server
 * 3. datetime-local inputs must be converted using the operational timezone
 */

/**
 * Format a UTC date for display in a specific IANA timezone.
 */
export function formatInTimezone(
  date: Date | string,
  timezone: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    ...options,
  }).format(d);
}

/**
 * Format date + time with timezone abbreviation.
 * e.g., "3/7/2026, 2:30 PM EST"
 */
export function formatDateTime(date: Date | string, timezone: string): string {
  return formatInTimezone(date, timezone, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * Format date only. e.g., "3/7/2026"
 */
export function formatDate(date: Date | string, timezone: string): string {
  return formatInTimezone(date, timezone, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

/**
 * Format time only with timezone abbreviation. e.g., "2:30 PM EST"
 */
export function formatTime(date: Date | string, timezone: string): string {
  return formatInTimezone(date, timezone, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * Parse a "datetime-local" input value in the context of an operational timezone
 * and return a UTC ISO string to send to the server.
 *
 * Input: "2026-03-07T14:30" (no timezone info from HTML input)
 * The timezone tells us what the user intended.
 */
export function localInputToUTC(localDatetime: string, timezone: string): string {
  const [datePart, timePart] = localDatetime.split("T");
  if (!datePart || !timePart) return localDatetime;

  const naive = new Date(`${datePart}T${timePart}:00Z`);
  const offset = getTimezoneOffsetMinutes(naive, timezone);
  return new Date(naive.getTime() + offset * 60 * 1000).toISOString();
}

/**
 * Convert a UTC date to a "datetime-local" input value in a specific timezone.
 * Used to pre-fill datetime-local inputs with the correct local time.
 */
export function utcToLocalInput(utcDate: Date | string, timezone: string): string {
  const d = typeof utcDate === "string" ? new Date(utcDate) : utcDate;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  let hour = get("hour");
  if (hour === "24") hour = "00";
  const minute = get("minute");

  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: timezone });
  const utcDate = new Date(utcStr);
  const tzDate = new Date(tzStr);
  return (utcDate.getTime() - tzDate.getTime()) / 60000;
}
