import type { Kysely } from 'kysely';
import type { WaitlistConfig } from '../../config.js';
import type { Database } from '../../db/schema.js';
import type { Clock } from '../../shared/clock.js';
import { findOwnWaitlistEntry } from '../bookings/access.js';
import { countActiveBookings, findActiveBooking, lockClassForUpdate } from '../bookings/repository.js';
import type { WaitlistEntryDto } from './dto.js';
import { toWaitlistEntryDto } from './dto.js';
import {
  alreadyBooked,
  alreadyOnWaitlist,
  classNotBookable,
  classNotFound,
  classNotFull,
  waitlistClosed,
  waitlistEntryNotActive,
  waitlistEntryNotFound,
} from './errors.js';
import {
  findEntryDtoRow,
  findWaitingEntry,
  insertEntry,
  lockEntry,
  markRemoved,
  positionOf,
} from './repository.js';

export interface WaitlistDeps {
  db: Kysely<Database>;
  clock: Clock;
  config: WaitlistConfig;
}

/** The signed-in member. Always taken from the session, never from the request. */
export interface WaitlistActor {
  id: string;
}

const WAITING_UNIQUE_INDEX = 'waitlist_entry_waiting_class_member_uq';
const MS_PER_MINUTE = 60_000;

function isWaitingUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === '23505' && constraint === WAITING_UNIQUE_INDEX;
}

/**
 * Joins the waiting list of a full class. One transaction; the `gym_class` row is locked first
 * (ADR-010), so joins, leaves, bookings and promotions on one class run one at a time.
 */
export async function joinWaitlist(
  deps: WaitlistDeps,
  user: WaitlistActor,
  classId: string,
): Promise<WaitlistEntryDto> {
  const now = deps.clock.now();
  const cutoffMinutes = deps.config.promotionCutoffMinutes;

  return deps.db.transaction().execute(async (trx) => {
    const gymClass = await lockClassForUpdate(trx, classId);
    if (!gymClass) throw classNotFound();

    if (gymClass.status !== 'scheduled' || gymClass.start_at.getTime() <= now.getTime()) {
      throw classNotBookable();
    }
    if (cutoffMinutes > 0 && now.getTime() >= gymClass.start_at.getTime() - cutoffMinutes * MS_PER_MINUTE) {
      throw waitlistClosed();
    }

    // US-130 inserts `assertNotBlocked(trx, user.id)` here (409 BOOKING_BLOCKED).

    if (await findActiveBooking(trx, classId, user.id)) throw alreadyBooked();
    if (await findWaitingEntry(trx, classId, user.id)) throw alreadyOnWaitlist();

    const activeBookings = await countActiveBookings(trx, classId);
    if (gymClass.capacity - activeBookings > 0) throw classNotFull();

    let entryId: string;
    try {
      ({ id: entryId } = await insertEntry(trx, { class_id: classId, member_id: user.id, joined_at: now }));
    } catch (error) {
      if (isWaitingUniqueViolation(error)) throw alreadyOnWaitlist();
      throw error;
    }

    const position = await positionOf(trx, entryId);
    const row = await findEntryDtoRow(trx, entryId);
    if (!row) throw new Error(`waitlist entry ${entryId} vanished inside its own transaction`);
    return toWaitlistEntryDto(row, position);
  });
}

/**
 * Leaves the waiting list. Lock order `gym_class` → `waitlist_entry` (ADR-010), the same as
 * promotion, so exactly one of leave and promotion wins.
 */
export async function leaveWaitlist(deps: WaitlistDeps, user: WaitlistActor, entryId: string): Promise<void> {
  const now = deps.clock.now();

  await deps.db.transaction().execute(async (trx) => {
    const own = await findOwnWaitlistEntry(trx, entryId, user.id);
    if (!own) throw waitlistEntryNotFound();

    await lockClassForUpdate(trx, own.class_id);

    const locked = await lockEntry(trx, entryId);
    if (!locked || locked.status !== 'waiting') throw waitlistEntryNotActive();

    await markRemoved(trx, entryId, now);
  });
}
