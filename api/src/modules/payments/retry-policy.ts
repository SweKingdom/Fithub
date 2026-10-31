/**
 * Pure retry and hold rules for payments when Stripe is unavailable (US-133, ADR-023).
 * No I/O and no clock: callers pass `now` so the rules are deterministic in tests.
 */

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;

/**
 * When to try again after failure number `attemptCount` (the new attempt count, 1-based):
 * `now + baseSeconds × 2^(attemptCount-1)`. With base 60 s: 1, 2, 4, 8 min.
 */
export function computeNextRetryAt(now: Date, attemptCount: number, baseSeconds: number): Date {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new RangeError('attemptCount must be an integer of at least 1');
  }
  const waitSeconds = baseSeconds * 2 ** (attemptCount - 1);
  return new Date(now.getTime() + waitSeconds * MS_PER_SECOND);
}

/** True when no further create attempt may be made: `attemptCount >= maxAttempts`. */
export function isExhausted(attemptCount: number, maxAttempts: number): boolean {
  return attemptCount >= maxAttempts;
}

/** The moment a `pending_payment` booking stops being held: the hold end, never beyond the class start. */
export function holdDeadline(bookedAt: Date, classStartAt: Date, holdMinutes: number): Date {
  const holdEnd = bookedAt.getTime() + holdMinutes * MS_PER_MINUTE;
  return new Date(Math.min(holdEnd, classStartAt.getTime()));
}
