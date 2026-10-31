import type { Kysely } from 'kysely';
import type { AttendanceStatus, Database } from '../db/schema.js';

/**
 * Raised inside the transaction that saved a booking's attendance (US-129, ADR-009). Subscribers run in that
 * same transaction, so a failing subscriber rolls the attendance save back.
 */
export interface AttendanceRecorded {
  type: 'AttendanceRecorded';
  bookingId: string;
  memberId: string;
  classId: string;
  classStartAt: Date;
  previousAttendance: AttendanceStatus;
  attendance: AttendanceStatus;
  /** The staff member who recorded it; null when the system did. */
  recordedBy: string | null;
  recordedAt: Date;
}

/**
 * A booking was cancelled (US-124, ADR-009, ADR-016). Raised inside the cancel transaction; `cause` tells the
 * subscribers why (credit return, waiting-list promotion and refunds react to it in their own stories).
 */
export interface BookingCancelled {
  type: 'BookingCancelled';
  bookingId: string;
  classId: string;
  memberId: string;
  previousStatus: 'confirmed' | 'pending_payment';
  cancelledAt: Date;
  cause: 'member_cancelled' | 'class_cancelled';
}

/** Events other stories add join this union. */
export type DomainEvent = AttendanceRecorded | BookingCancelled;

export type DomainEventType = DomainEvent['type'];

export type DomainEventHandler<T extends DomainEventType> = (
  trx: Kysely<Database>,
  event: Extract<DomainEvent, { type: T }>,
) => Promise<void>;

type AnyHandler = (trx: Kysely<Database>, event: DomainEvent) => Promise<void>;

/** In-process event bus. Handlers of one event run one after the other, in subscription order. */
export class DomainEventBus {
  private readonly handlers = new Map<DomainEventType, AnyHandler[]>();

  subscribe<T extends DomainEventType>(type: T, handler: DomainEventHandler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as AnyHandler);
    this.handlers.set(type, list);
  }

  /** Calls every subscriber with the caller's transaction. The first error stops delivery and is rethrown. */
  async publish(trx: Kysely<Database>, event: DomainEvent): Promise<void> {
    for (const handler of this.handlers.get(event.type) ?? []) {
      await handler(trx, event);
    }
  }
}
