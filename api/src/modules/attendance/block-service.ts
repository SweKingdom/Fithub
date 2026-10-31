import type { Kysely } from 'kysely';
import type { NoShowConfig } from '../../config.js';
import type { BookingBlockReason, Database } from '../../db/schema.js';
import type { Clock } from '../../shared/clock.js';
import type { AttendanceRecorded } from '../../shared/domain-events.js';
import {
  countLinked,
  findActiveBlock,
  findBlockById,
  findHomeClubTimezone,
  insertBlock,
  linkBookings,
  listUncountedNoShows,
  liftBlock,
  lockMember,
  unlinkBooking,
  type BlockRow,
} from './block-repository.js';
import { bookingBlocked } from './errors.js';
import { noShowWindowStart } from './no-show-window.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Used when the member has no home club, so there is no club time zone to show a date in. */
const FALLBACK_TIMEZONE = 'UTC';

export interface BookingBlockInfo {
  endsAt: Date;
  reason: BookingBlockReason;
  noShowCount: number | null;
  /** Plain-language text for the member; also the message of `BOOKING_BLOCKED`. */
  message: string;
}

export interface BlockServiceDeps {
  clock: Clock;
  config: NoShowConfig;
}

/** `ends_at` in the club's local time, e.g. "6 Nov 2026, 18:30". */
function formatBlockEnd(endsAt: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(endsAt);
}

function messageFor(block: BlockRow, timeZone: string): string {
  const date = formatBlockEnd(block.ends_at, timeZone);
  if (block.reason === 'no_show') {
    return `You can't book classes until ${date} because of ${block.no_show_count} missed classes.`;
  }
  return `You can't book classes until ${date}.`;
}

/** No-show blocks (US-130): creating and lifting them from attendance events, and checking them before a booking. */
export function createBlockService({ clock, config }: BlockServiceDeps) {
  /** The member's active block with its member-facing text, or null. */
  async function getActiveBlock(db: Kysely<Database>, memberId: string): Promise<BookingBlockInfo | null> {
    const block = await findActiveBlock(db, memberId, clock.now());
    if (!block) return null;
    const timeZone = (await findHomeClubTimezone(db, memberId)) ?? FALLBACK_TIMEZONE;
    return {
      endsAt: block.ends_at,
      reason: block.reason,
      noShowCount: block.no_show_count,
      message: messageFor(block, timeZone),
    };
  }

  /**
   * Call from `bookClass` (after the class checks, before `ALREADY_BOOKED`) and from the waiting-list join (after its
   * class checks). Throws `409 BOOKING_BLOCKED` while the member has an active block.
   */
  async function assertNotBlocked(trx: Kysely<Database>, memberId: string): Promise<void> {
    const block = await getActiveBlock(trx, memberId);
    if (block) throw bookingBlocked(block.message);
  }

  /** Correction away from `no_show`: unlink the booking and end the block if too few no-shows remain linked. */
  async function onNoShowRemoved(trx: Kysely<Database>, bookingId: string, now: Date): Promise<void> {
    const blockId = await unlinkBooking(trx, bookingId);
    if (blockId === null) return;
    const block = await findBlockById(trx, blockId);
    if (!block || block.reason !== 'no_show') return;
    const active = block.starts_at <= now && now < block.ends_at;
    if (active && (await countLinked(trx, blockId)) < config.threshold) {
      await liftBlock(trx, blockId, now);
    }
  }

  /**
   * Subscriber of `AttendanceRecorded`; runs inside the transaction that saved the attendance. Idempotent: a repeated
   * event finds the booking already linked or the block already active.
   */
  async function onAttendanceRecorded(trx: Kysely<Database>, event: AttendanceRecorded): Promise<void> {
    const now = clock.now();
    await lockMember(trx, event.memberId);

    if (event.previousAttendance === 'no_show' && event.attendance !== 'no_show') {
      await onNoShowRemoved(trx, event.bookingId, now);
      return;
    }
    if (event.attendance !== 'no_show') return;

    // No second block while one is active; this no-show stays uncounted for a later block.
    if (await findActiveBlock(trx, event.memberId, now)) return;

    const timeZone = (await findHomeClubTimezone(trx, event.memberId)) ?? FALLBACK_TIMEZONE;
    const bookingIds = await listUncountedNoShows(
      trx,
      event.memberId,
      noShowWindowStart(now, config, timeZone),
    );
    if (bookingIds.length < config.threshold) return;

    const block = await insertBlock(trx, {
      member_id: event.memberId,
      reason: 'no_show',
      starts_at: now,
      ends_at: new Date(now.getTime() + config.blockDays * DAY_MS),
      no_show_count: bookingIds.length,
    });
    await linkBookings(trx, block.id, bookingIds);
  }

  return { getActiveBlock, assertNotBlocked, onAttendanceRecorded };
}

export type BlockService = ReturnType<typeof createBlockService>;
