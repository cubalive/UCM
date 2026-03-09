/**
 * Timezone utilities for UTC-safe date/time operations.
 *
 * Rules:
 * 1. All timestamps stored in UTC (timestamptz)
 * 2. All display uses operational city/tenant timezone
 * 3. Browser timezone is NEVER the source of truth
 */

const DEFAULT_TIMEZONE = "America/New_York";

/**
 * Format a UTC date for display in a specific IANA timezone.
 */
export function formatInTimezone(
  date: Date | string,
  timezone: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    ...options,
  };
  return new Intl.DateTimeFormat("en-US", opts).format(d);
}

/**
 * Format a date as a short date string (e.g., "3/7/2026") in the given timezone.
 */
export function formatDate(date: Date | string, timezone: string): string {
  return formatInTimezone(date, timezone, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

/**
 * Format a date as date + time (e.g., "3/7/2026, 2:30 PM EST") in the given timezone.
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
 * Format a time only (e.g., "2:30 PM EST") in the given timezone.
 */
export function formatTime(date: Date | string, timezone: string): string {
  return formatInTimezone(date, timezone, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * Get the day of week (0=Sunday) for a date in a specific timezone.
 */
export function getDayInTimezone(date: Date | string, timezone: string): number {
  const d = typeof date === "string" ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return dayMap[weekday || "Sun"] ?? 0;
}

/**
 * Get the hour (0-23) for a date in a specific timezone.
 */
export function getHourInTimezone(date: Date | string, timezone: string): number {
  const d = typeof date === "string" ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  const hourPart = parts.find((p) => p.type === "hour");
  const hour = parseInt(hourPart?.value || "0", 10);
  // Intl returns 24 for midnight in hour12:false mode in some engines
  return hour === 24 ? 0 : hour;
}

/**
 * Parse a "local" datetime string (from an HTML datetime-local input) in the
 * context of a specific timezone and return a UTC Date.
 *
 * Input format: "2026-03-07T14:30" (no timezone info)
 * The timezone parameter tells us what timezone the user intended.
 */
export function parseLocalDatetime(localDatetime: string, timezone: string): Date {
  // Build an ISO-like string with the timezone offset
  // Create a date in UTC first, then adjust
  const [datePart, timePart] = localDatetime.split("T");
  if (!datePart || !timePart) {
    throw new Error(`Invalid datetime format: ${localDatetime}`);
  }

  // Use a two-pass approach: create date, compute offset, adjust
  const naive = new Date(`${datePart}T${timePart}:00Z`);

  // Get the UTC offset for this timezone at this approximate time
  const offset = getTimezoneOffsetMinutes(naive, timezone);

  // Adjust: if timezone is UTC-5, the user's 14:30 local = 19:30 UTC
  return new Date(naive.getTime() + offset * 60 * 1000);
}

/**
 * Get the UTC offset in minutes for a timezone at a given instant.
 * Returns positive for timezones behind UTC (e.g., +300 for EST = UTC-5).
 */
export function getTimezoneOffsetMinutes(date: Date, timezone: string): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: timezone });
  const utcDate = new Date(utcStr);
  const tzDate = new Date(tzStr);
  return (utcDate.getTime() - tzDate.getTime()) / 60000;
}

/**
 * Format a date for use in PDF documents — deterministic, not locale-dependent.
 */
export function formatDateForPdf(date: Date | string, timezone: string): string {
  return formatInTimezone(date, timezone, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Validate that a string is a valid IANA timezone identifier.
 */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export { DEFAULT_TIMEZONE };
