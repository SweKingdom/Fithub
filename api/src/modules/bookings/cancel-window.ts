const MS_PER_MINUTE = 60_000;

/** Last moment at which a booking for a class starting at `startAt` can still be cancelled. */
export function cancelDeadline(startAt: Date, cutoffMinutes: number): Date {
  return new Date(startAt.getTime() - cutoffMinutes * MS_PER_MINUTE);
}

/** True while `now` is at or before the deadline: exactly at the cut-off is still allowed. */
export function isWithinCancelWindow(now: Date, startAt: Date, cutoffMinutes: number): boolean {
  return now.getTime() <= cancelDeadline(startAt, cutoffMinutes).getTime();
}

/** Plain-language cut-off for messages: 120 → "2 hours", 60 → "1 hour", 90 → "90 minutes". */
export function formatCutoff(minutes: number): string {
  if (minutes > 0 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}
