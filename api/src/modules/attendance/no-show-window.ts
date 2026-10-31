import type { NoShowConfig } from '../../config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** No-shows on classes starting after `from` count (at or after it when `inclusive`). */
export interface NoShowWindow {
  from: Date;
  inclusive: boolean;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset of the time zone from UTC at `instant`, in ms (positive east of Greenwich). */
function offsetMs(instant: Date, timeZone: string): number {
  const wall = wallClockIn(instant, timeZone);
  const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant at which the calendar month containing `now` started in `timeZone` (00:00 on the 1st). */
function startOfMonth(now: Date, timeZone: string): Date {
  const { year, month } = wallClockIn(now, timeZone);
  const wallStart = Date.UTC(year, month - 1, 1);
  // Two passes: the offset at the 1st may differ from the offset at the guess when a DST change is near.
  let instant = wallStart - offsetMs(new Date(wallStart), timeZone);
  instant = wallStart - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/**
 * Where the no-show window starts (US-130, ADR-013).
 * - `rolling_days`: classes that started after `now − windowDays days`.
 * - `calendar_month`: classes that started at or after the first day of the current month, 00:00 in the member's
 *   home club time zone.
 * There is no upper bound: attendance only exists for classes that have started.
 */
export function noShowWindowStart(
  now: Date,
  config: Pick<NoShowConfig, 'window' | 'windowDays'>,
  timezone: string,
): NoShowWindow {
  if (config.window === 'calendar_month') {
    return { from: startOfMonth(now, timezone), inclusive: true };
  }
  return { from: new Date(now.getTime() - config.windowDays * DAY_MS), inclusive: false };
}
