import type { FastifyBaseLogger } from 'fastify';
import type { Notifier } from '../../notifications/notifier.js';

/** What a committed class cancellation changed. Ids only, so nothing personal reaches the log. */
export interface ClassCancellationResult {
  classId: string;
  cancelledBy: string;
  bookings: { bookingId: string; memberId: string }[];
  waitlistEntries: { waitlistEntryId: string; memberId: string }[];
}

/**
 * Informs every affected member once, after the cancellation is committed. A failing notification is
 * logged and never undoes the cancellation or stops the remaining notifications.
 */
export async function notifyClassCancelled(
  result: ClassCancellationResult,
  notifier: Pick<Notifier, 'notify'>,
  logger: Pick<FastifyBaseLogger, 'error'>,
): Promise<void> {
  const { classId } = result;
  const events = [
    ...result.bookings.map(({ bookingId, memberId }) => ({
      type: 'class_cancelled' as const,
      memberId,
      classId,
      bookingId,
      waitlistEntryId: null,
    })),
    ...result.waitlistEntries.map(({ waitlistEntryId, memberId }) => ({
      type: 'class_cancelled' as const,
      memberId,
      classId,
      bookingId: null,
      waitlistEntryId,
    })),
  ];

  for (const event of events) {
    try {
      await notifier.notify(event);
    } catch (error) {
      logger.error(
        { err: error, classId, bookingId: event.bookingId, waitlistEntryId: event.waitlistEntryId },
        'class.cancelled notification failed',
      );
    }
  }
}
