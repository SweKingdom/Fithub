export const SCHEDULE_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScheduleWindow {
  from: Date;
  to: Date;
  /** True when nothing can fall inside the window (`from >= to` after clamping). */
  empty: boolean;
}

/**
 * Effective schedule window: `now` (exclusive) to `now + 14 × 24 h` (inclusive).
 * Optional `from`/`to` narrow it; values outside are clamped to it.
 */
export function computeWindow(now: Date, from?: Date, to?: Date): ScheduleWindow {
  const windowEnd = now.getTime() + SCHEDULE_WINDOW_DAYS * DAY_MS;
  const effectiveFrom = Math.max((from ?? now).getTime(), now.getTime());
  const effectiveTo = Math.min((to ?? new Date(windowEnd)).getTime(), windowEnd);
  return {
    from: new Date(effectiveFrom),
    to: new Date(effectiveTo),
    empty: effectiveFrom >= effectiveTo,
  };
}
