import type { Kysely } from 'kysely';
import type { WaitlistConfig } from '../../config.js';
import type { Database } from '../../db/schema.js';
import type { Notifier } from '../../notifications/notifier.js';
import type { Clock } from '../../shared/clock.js';
import type { Logger } from '../../shared/logger.js';
import {
  countActiveBookings,
  findActiveBooking,
  insertBooking,
  lockClassForUpdate,
  type LockedClass,
} from '../bookings/repository.js';
import {
  claimEntry,
  listWaitingForPromotion,
  markRemoved,
  setPromotedBooking,
  type WaitingCandidate,
} from './repository.js';

export interface PromotionContext {
  clock: Clock;
  config: WaitlistConfig;
  logger: Logger;
}

/** One member who got a place. Ids only. */
export interface Promotion {
  entryId: string;
  bookingId: string;
  memberId: string;
  classId: string;
  bookingStatus: 'confirmed' | 'pending_payment';
}

/** `already_booked`: the entry is obsolete and is removed. Later stories add more outcomes (blocked, no credit). */
export type PromotionEligibility = 'eligible' | 'already_booked';

export async function checkPromotionEligibility(
  trx: Kysely<Database>,
  entry: WaitingCandidate,
  classRow: Pick<LockedClass, 'id'>,
): Promise<PromotionEligibility> {
  const active = await findActiveBooking(trx, classRow.id, entry.member_id);
  return active ? 'already_booked' : 'eligible';
}

/**
 * Gives each free place of the class to the next member on the waiting list (first joined first).
 * Must run inside the transaction that frees the place; it takes the class lock itself (a no-op when the caller
 * already holds it). Idempotent: returns `[]` when there is nothing to do (class missing or not `scheduled`,
 * past the promotion cut-off, no free place, nobody waiting). The caller calls `notifyPromotions` after commit.
 */
export async function promoteNext(
  trx: Kysely<Database>,
  classId: string,
  ctx: PromotionContext,
): Promise<Promotion[]> {
  const now = ctx.clock.now();
  const cls = await lockClassForUpdate(trx, classId);
  if (!cls || cls.status !== 'scheduled') return [];
  const cutoffAt = cls.start_at.getTime() - ctx.config.promotionCutoffMinutes * 60_000;
  if (now.getTime() >= cutoffAt) return [];

  let free = cls.capacity - (await countActiveBookings(trx, classId));
  if (free <= 0) return [];

  const promotions: Promotion[] = [];
  for (const entry of await listWaitingForPromotion(trx, classId)) {
    if (free <= 0) break;

    if ((await checkPromotionEligibility(trx, entry, cls)) === 'already_booked') {
      await markRemoved(trx, entry.id, now);
      continue;
    }
    if (!(await claimEntry(trx, entry.id, now))) continue;

    const bookingStatus = entry.member_type === 'drop_in' ? 'pending_payment' : 'confirmed';
    const booking = await insertBooking(trx, {
      class_id: classId,
      member_id: entry.member_id,
      status: bookingStatus,
      source: 'waitlist',
      booked_at: now,
    });
    await setPromotedBooking(trx, entry.id, booking.id);
    free -= 1;
    promotions.push({
      entryId: entry.id,
      bookingId: booking.id,
      memberId: entry.member_id,
      classId,
      bookingStatus,
    });
    ctx.logger.info(
      { entryId: entry.id, bookingId: booking.id, memberId: entry.member_id, classId, bookingStatus },
      'waitlist.promoted',
    );
  }
  return promotions;
}

/**
 * Tells each promoted member, once per promotion. Call it after the transaction committed. A notifier that fails
 * is logged and never undoes the promotion or stops the other notifications.
 */
export async function notifyPromotions(
  promotions: readonly Promotion[],
  notifier: Notifier,
  logger: Logger,
): Promise<void> {
  for (const promotion of promotions) {
    try {
      await notifier.notify({
        type: 'waitlist_promoted',
        memberId: promotion.memberId,
        bookingId: promotion.bookingId,
        classId: promotion.classId,
      });
    } catch (error) {
      logger.error(
        {
          memberId: promotion.memberId,
          bookingId: promotion.bookingId,
          classId: promotion.classId,
          error: error instanceof Error ? error.message : String(error),
        },
        'notification.failed',
      );
    }
  }
}
