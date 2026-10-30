import type { Transaction } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { Database } from '../../src/db/schema.js';
import { createEventBus, type BookingCancelled } from '../../src/shared/domain-events.js';

const trx = { fake: 'trx' } as unknown as Transaction<Database>;

const event: BookingCancelled = {
  type: 'BookingCancelled',
  bookingId: 'b1',
  classId: 'c1',
  memberId: 'm1',
  previousStatus: 'confirmed',
  cancelledAt: new Date('2026-11-02T10:00:00.000Z'),
  cause: 'member_cancelled',
};

describe('domain event bus', () => {
  it('calls the handlers in subscription order with the transaction and the event', async () => {
    const bus = createEventBus();
    const calls: string[] = [];
    bus.subscribe('BookingCancelled', async (receivedTrx, received) => {
      expect(receivedTrx).toBe(trx);
      expect(received).toEqual(event);
      await new Promise((resolve) => setTimeout(resolve, 5));
      calls.push('first');
    });
    bus.subscribe('BookingCancelled', async () => {
      calls.push('second');
    });

    await bus.publish(trx, event);

    expect(calls).toEqual(['first', 'second']);
  });

  it('publishes without handlers', async () => {
    await expect(createEventBus().publish(trx, event)).resolves.toBeUndefined();
  });

  it('propagates a handler error and stops the later handlers', async () => {
    const bus = createEventBus();
    let secondCalled = false;
    bus.subscribe('BookingCancelled', async () => {
      throw new Error('handler failed');
    });
    bus.subscribe('BookingCancelled', async () => {
      secondCalled = true;
    });

    await expect(bus.publish(trx, event)).rejects.toThrow('handler failed');
    expect(secondCalled).toBe(false);
  });
});
