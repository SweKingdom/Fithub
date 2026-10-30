import type { Transaction } from 'kysely';
import type { Database } from '../db/schema.js';

/** A booking was cancelled (ADR-009, ADR-016). `cause` tells the consumers why. */
export type BookingCancelled = {
  type: 'BookingCancelled';
  bookingId: string;
  classId: string;
  memberId: string;
  previousStatus: 'confirmed' | 'pending_payment';
  cancelledAt: Date;
  cause: 'member_cancelled' | 'class_cancelled';
};

/** Later stories extend this union (e.g. AttendanceRecorded, US-129). */
export type DomainEvent = BookingCancelled;

export type DomainEventHandler<T extends DomainEvent['type']> = (
  trx: Transaction<Database>,
  event: Extract<DomainEvent, { type: T }>,
) => Promise<void>;

export interface DomainEventBus {
  subscribe<T extends DomainEvent['type']>(type: T, handler: DomainEventHandler<T>): void;
  /**
   * Runs the handlers of the event type one after the other, in subscription order, inside the
   * caller's transaction. A handler error propagates, so the caller's transaction rolls back.
   */
  publish(trx: Transaction<Database>, event: DomainEvent): Promise<void>;
}

export function createEventBus(): DomainEventBus {
  const handlers = new Map<DomainEvent['type'], DomainEventHandler<DomainEvent['type']>[]>();

  return {
    subscribe(type, handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler as DomainEventHandler<DomainEvent['type']>);
      handlers.set(type, list);
    },
    async publish(trx, event) {
      for (const handler of handlers.get(event.type) ?? []) {
        await handler(trx, event);
      }
    },
  };
}
