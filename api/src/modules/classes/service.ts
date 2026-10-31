import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { Clock } from '../../shared/clock.js';
import type { AuthUser } from '../auth/types.js';
import { clubNotFound } from '../clubs/errors.js';
import { findClubById } from '../clubs/repository.js';
import { findSchedule, type RecentlyStartedFilter } from './repository.js';
import { toScheduleItem, type ScheduleQuery, type ScheduleResponse } from './schedule.dto.js';
import { computeWindow } from './schedule-window.js';

export interface ScheduleDeps {
  db: Kysely<Database>;
  clock: Clock;
  /** `ATTENDANCE_EDIT_WINDOW_HOURS`: how long after its end a started class stays on the staff schedule. */
  attendanceEditWindowHours: number;
}

/**
 * Upcoming classes (two-week window) with free places and the signed-in member's own booking status.
 * Instructors and club managers also get the started classes of their own club until the attendance
 * window closes, so they can open the attendance list from the schedule (US-129).
 */
export async function getSchedule(
  deps: ScheduleDeps,
  user: AuthUser,
  query: ScheduleQuery,
): Promise<ScheduleResponse> {
  if (query.clubId !== undefined) {
    const club = await findClubById(deps.db, query.clubId);
    if (!club) throw clubNotFound();
  }

  // The member id only ever comes from the session; staff get no booking data.
  const memberId = user.role === 'member' ? user.id : null;
  const now = deps.clock.now();
  const window = computeWindow(
    now,
    query.from === undefined ? undefined : new Date(query.from),
    query.to === undefined ? undefined : new Date(query.to),
  );

  // Only for staff with a home club, and not when the caller narrowed the start of the period.
  const recentlyStarted: RecentlyStartedFilter | undefined =
    user.role !== 'member' && user.clubId !== null && query.from === undefined
      ? { clubId: user.clubId, now, editWindowHours: deps.attendanceEditWindowHours }
      : undefined;

  const rows = window.empty
    ? []
    : await findSchedule(deps.db, {
        clubId: query.clubId,
        from: window.from,
        to: window.to,
        memberId,
        recentlyStarted,
      });

  return {
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    items: rows.map(toScheduleItem),
  };
}
