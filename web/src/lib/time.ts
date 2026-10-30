import { fromZonedTime } from 'date-fns-tz';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

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
