import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { Clock } from '../../shared/clock.js';
import type { AuthUser } from '../auth/types.js';
import { clubNotFound } from '../clubs/errors.js';
import { findClubById } from '../clubs/repository.js';
import { findSchedule } from './repository.js';
import { toScheduleItem, type ScheduleQuery, type ScheduleResponse } from './schedule.dto.js';
import { computeWindow } from './schedule-window.js';

export interface ScheduleDeps {
  db: Kysely<Database>;
  clock: Clock;
}

/** Upcoming classes (two-week window) with free places and the signed-in member's own booking status. */
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
  const window = computeWindow(
    deps.clock.now(),
    query.from === undefined ? undefined : new Date(query.from),
    query.to === undefined ? undefined : new Date(query.to),
  );

  const rows = window.empty
    ? []
    : await findSchedule(deps.db, { clubId: query.clubId, from: window.from, to: window.to, memberId });

  return {
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    items: rows.map(toScheduleItem),
  };
}
