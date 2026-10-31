import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

/** Start/end time of day in the club's time zone, `HH:mm`. */
export function formatClubTime(iso: string, timeZone: string): string {
  return formatInTimeZone(iso, timeZone, 'HH:mm');
}

/** Local calendar date in the club's time zone, `yyyy-MM-dd` (used to group the schedule by day). */
export function clubDateKey(iso: string, timeZone: string): string {
  return formatInTimeZone(iso, timeZone, 'yyyy-MM-dd');
}

/** Day heading in the club's time zone, e.g. "Tuesday 3 November". */
export function formatClubDay(iso: string, timeZone: string): string {
  return formatInTimeZone(iso, timeZone, 'EEEE d MMMM');
}

/**
 * Converts a wall-clock date and time in the club's time zone to an ISO 8601 UTC string
 * (US-120, ADR-018). Throws `RangeError` for input that is not a real date and time.
 */
export function clubLocalToUtc(date: string, time: string, timezone: string): string {
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) {
    throw new RangeError('Date must be YYYY-MM-DD and time must be HH:mm.');
  }
  return fromZonedTime(`${date}T${time}:00`, timezone).toISOString();
}
