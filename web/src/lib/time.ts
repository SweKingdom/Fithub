import { formatInTimeZone } from 'date-fns-tz';

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
