import type { Transaction } from 'kysely';
import type { Attendance, Database } from '../db/schema.js';

/**
 * Attendance of a booking changed (US-129). `recordedBy` is null when the auto no-show sweep set it.
 * Consumed by the no-show block rule (US-130).
 */
export interface AttendanceRecorded {
  type: 'AttendanceRecorded';
  bookingId: string;
  memberId: string;
  classId: string;
  classStartAt: Date;
  previousAttendance: Attendance;
  attendance: 'attended' | 'no_show';
  recordedBy: string | null;
  recordedAt: Date;
}

/** Every event the in-process bus carries; later stories add their events here. */
export type DomainEvent = AttendanceRecorded;

export type EventOfType<T extends DomainEvent['type']> = Extract<DomainEvent, { type: T }>;

/** Handlers run inside the publisher's transaction: a handler that throws rolls the whole change back (ADR-009). */
export type EventHandler<E extends DomainEvent> = (trx: Transaction<Database>, event: E) => Promise<void>;

/** What services need to publish; lets tests and the sweep inject a stand-in. */
export interface EventPublisher {
  publish(trx: Transaction<Database>, event: DomainEvent): Promise<void>;
}

/** In-process, synchronous event bus. Handlers of one event run one after the other, in subscription order. */
export class DomainEventBus implements EventPublisher {
  private readonly handlers = new Map<DomainEvent['type'], EventHandler<never>[]>();

  subscribe<T extends DomainEvent['type']>(type: T, handler: EventHandler<EventOfType<T>>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as EventHandler<never>);
    this.handlers.set(type, list);
  }

  async publish(trx: Transaction<Database>, event: DomainEvent): Promise<void> {
    for (const handler of this.handlers.get(event.type) ?? []) {
      await (handler as EventHandler<DomainEvent>)(trx, event);
    }
  }
}
