import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import { forbidden } from '../../shared/errors.js';
import type { AuthUser } from '../auth/types.js';
import { findInstructorInClub } from '../clubs/instructors.js';
import { toClassDto, type ClassDto } from './dto.js';
import { CLASS_MESSAGES, instructorMustBeSelf, instructorNotInClub } from './errors.js';
import { findClassDtoRow, insertClass } from './repository.js';

export interface CreateClassInput {
  clubId: string;
  name: string;
  startAt: string;
  durationMinutes: number;
  capacity: number;
  instructorId?: string | null | undefined;
}

export interface ClassServiceDeps {
  db: Kysely<Database>;
}

/** Resolves who leads the class (rules 2 and 3 of US-120). */
async function resolveInstructor(
  deps: ClassServiceDeps,
  user: AuthUser,
  input: CreateClassInput,
): Promise<string | null> {
  const requested = input.instructorId ?? null;
  if (user.role === 'instructor') {
    if (requested === null || requested === user.id) return user.id;
    throw instructorMustBeSelf();
  }
  if (requested === null) return null;
  if (!(await findInstructorInClub(deps.db, requested, input.clubId))) {
    throw instructorNotInClub();
  }
  return requested;
}

/**
 * Creates a `scheduled` class. Input is already validated (name trimmed, start in the future).
 * Status, creator and — for instructors — the instructor are set here, never taken from the request.
 */
export async function createClass(
  deps: ClassServiceDeps,
  user: AuthUser,
  input: CreateClassInput,
): Promise<ClassDto> {
  // Same answer for another club and for an unknown club: existence is not revealed.
  if (user.clubId === null || input.clubId !== user.clubId) {
    throw forbidden(CLASS_MESSAGES.ownClubOnly);
  }
  const instructorId = await resolveInstructor(deps, user, input);

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
  // No booking table yet (US-122): a new class has no bookings.
  return toClassDto(row, 0);
}
