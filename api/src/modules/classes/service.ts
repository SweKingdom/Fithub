import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { Clock } from '../../shared/clock.js';
import { forbidden } from '../../shared/errors.js';
import type { AuthUser } from '../auth/types.js';
import { clubNotFound } from '../clubs/errors.js';
import { findInstructorInClub } from '../clubs/instructors.js';
import { findClubById } from '../clubs/repository.js';
import { toClassDto, type ClassDto } from './dto.js';
import { CLASS_MESSAGES, instructorMustBeSelf, instructorNotInClub } from './errors.js';
import { findClassDtoRow, findSchedule, insertClass } from './repository.js';
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

export interface CreateClassInput {
  clubId: string;
  name: string;
  startAt: string;
  durationMinutes: number;
  capacity: number;
  instructorId?: string | null | undefined;
}

/** Resolves who leads the class (rules 2 and 3 of US-120). */
async function resolveInstructor(
  db: Kysely<Database>,
  user: AuthUser,
  input: CreateClassInput,
): Promise<string | null> {
  const requested = input.instructorId ?? null;
  if (user.role === 'instructor') {
    if (requested === null || requested === user.id) return user.id;
    throw instructorMustBeSelf();
  }
  if (requested === null) return null;
  if (!(await findInstructorInClub(db, requested, input.clubId))) {
    throw instructorNotInClub();
  }
  return requested;
}

/**
 * Creates a `scheduled` class. Input is already validated (name trimmed, start in the future).
 * Status, creator and — for instructors — the instructor are set here, never taken from the request.
 */
export async function createClass(
  deps: { db: Kysely<Database> },
  user: AuthUser,
  input: CreateClassInput,
): Promise<ClassDto> {
  // Same answer for another club and for an unknown club: existence is not revealed.
  if (user.clubId === null || input.clubId !== user.clubId) {
    throw forbidden(CLASS_MESSAGES.ownClubOnly);
  }
  const instructorId = await resolveInstructor(deps.db, user, input);

  const id = await insertClass(deps.db, {
    club_id: input.clubId,
    name: input.name.trim(),
    start_at: new Date(input.startAt),
    duration_minutes: input.durationMinutes,
    capacity: input.capacity,
    status: 'scheduled',
    instructor_id: instructorId,
    created_by: user.id,
  });

  const row = await findClassDtoRow(deps.db, id);
  if (!row) throw new Error(`Class ${id} was not found right after it was created`);
  // No booking can exist for a class that was just created.
  return toClassDto(row, 0);
}
