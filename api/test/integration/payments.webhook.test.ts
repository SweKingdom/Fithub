import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import type { BookingTable } from '../../src/db/schema.js';
import type { PaymentStatus } from '../../src/modules/payments/tables.js';
import { testDb } from '../helpers/db.js';
import {
  createBooking,
  createClass,
  createClub,
  createPayment,
  createUser,
  createWaitlistEntry,
} from '../helpers/factories.js';
import {
  DROP_IN_PRICE,
  WEBHOOK_SECRET,
  paymentIntentEvent,
  paymentsConfig,
  signedWebhook,
} from '../helpers/stripe-events.js';

const T = new Date('2026-10-30T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const INTENT = 'pi_test_1';

type App = Awaited<ReturnType<typeof buildApp>>;

interface SeedOptions {
  capacity?: number;
  paymentStatus?: PaymentStatus;
  bookingStatus?: BookingTable['status'];
  intentId?: string | null;
}

describe('Stripe webhook (US-132)', () => {
  const db = testDb();
  let app: App;

  async function cleanUp(): Promise<void> {
    await db.deleteFrom('stripe_event').execute();
    await db.deleteFrom('payment').execute();
    await db.deleteFrom('waitlist_entry').execute();
    await db.deleteFrom('booking').execute();
    await db.deleteFrom('gym_class').execute();
  }

  beforeAll(async () => {
    app = await buildApp({ config: paymentsConfig(), clock: { now: () => T } });
  });
  afterAll(async () => {
    await cleanUp();
    await app.close();
  });
  beforeEach(cleanUp);

  /** A drop-in member's booking with its payment, by default held (`pending_payment`) and waiting for the card. */
  async function seed(options: SeedOptions = {}) {
    const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const cls = await createClass(db, {
      clubId: club.id,
      startAt: new Date(T.getTime() + 5 * HOUR),
      capacity: options.capacity ?? 20,
    });
    const member = await createUser(db, { role: 'member', memberType: 'drop_in', clubId: club.id });
    const booking = await createBooking(db, {
      classId: cls.id,
      memberId: member.id,
      status: options.bookingStatus ?? 'pending_payment',
    });
    const payment = await createPayment(db, {
      bookingId: booking.id,
      status: options.paymentStatus ?? 'requires_payment',
      intentId: options.intentId === undefined ? INTENT : options.intentId,
      amount: DROP_IN_PRICE,
    });
    return { club, cls, member, booking, payment };
  }

  const succeeded = (eventId: string, intentId = INTENT) =>
    paymentIntentEvent('payment_intent.succeeded', { eventId, intentId, amountReceived: DROP_IN_PRICE });
  const failed = (eventId: string, intentId = INTENT) =>
    paymentIntentEvent('payment_intent.payment_failed', { eventId, intentId });

  function deliver(event: Record<string, unknown>, secret = WEBHOOK_SECRET) {
    const signed = signedWebhook(secret, event);
    return app.inject({ method: 'POST', url: '/webhooks/stripe', headers: signed.headers, payload: signed.payload });
  }

  const paymentRow = (id: string) =>
    db.selectFrom('payment').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const bookingRow = (id: string) =>
    db.selectFrom('booking').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const eventCount = async () => (await db.selectFrom('stripe_event').select('event_id').execute()).length;

  it('AC 2: payment_intent.succeeded confirms the booking and marks the payment succeeded', async () => {
    const { booking, payment } = await seed();
    const res = await deliver(succeeded('evt_1'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });

    const paid = await paymentRow(payment.id);
    expect(paid.status).toBe('succeeded');
    expect(paid.succeeded_at?.getTime()).toBe(T.getTime());
    expect(paid.refund_status).toBe('none');
    expect((await bookingRow(booking.id)).status).toBe('confirmed');
  });

  it('AC 3: payment_intent.payment_failed cancels the booking, fails the payment and promotes the waiting list', async () => {
    const { club, cls, booking, payment } = await seed({ capacity: 1 });
    const waiter = await createUser(db, { role: 'member', clubId: club.id });
    const entry = await createWaitlistEntry(db, { classId: cls.id, memberId: waiter.id, joinedAt: T });

    const res = await deliver(failed('evt_f'));
    expect(res.statusCode).toBe(200);

    expect((await paymentRow(payment.id)).status).toBe('failed');
    const cancelled = await bookingRow(booking.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelled_at?.getTime()).toBe(T.getTime());
    const promoted = await db
      .selectFrom('booking')
      .selectAll()
      .where('class_id', '=', cls.id)
      .where('member_id', '=', waiter.id)
      .executeTakeFirstOrThrow();
    expect(promoted.status).toBe('confirmed');
    const waiting = await db.selectFrom('waitlist_entry').select('status').where('id', '=', entry.id).executeTakeFirstOrThrow();
    expect(waiting.status).toBe('promoted');
  });

  it('AC 3: a decline for a payment that is not waiting for the card changes nothing', async () => {
    const { booking, payment } = await seed({ paymentStatus: 'succeeded', bookingStatus: 'confirmed' });
    const res = await deliver(failed('evt_f'));
    expect(res.statusCode).toBe(200);
    expect((await paymentRow(payment.id)).status).toBe('succeeded');
    expect((await bookingRow(booking.id)).status).toBe('confirmed');
  });

  describe('AC 4: webhook security', () => {
    const cases: [string, (event: Record<string, unknown>) => { payload: string; headers: Record<string, string> }][] = [
      ['a missing Stripe-Signature header', (event) => ({ payload: JSON.stringify(event), headers: { 'content-type': 'application/json' } })],
      ['a signature made with another secret', (event) => signedWebhook('whsec_othersecret', event)],
      [
        'a body that was altered after signing',
        (event) => {
          const signed = signedWebhook(WEBHOOK_SECRET, event);
          return { ...signed, payload: signed.payload.replace(INTENT, 'pi_test_2') };
        },
      ],
      [
        'a malformed signature header',
        (event) => ({
          payload: JSON.stringify(event),
          headers: { 'content-type': 'application/json', 'stripe-signature': 'not-a-signature' },
        }),
      ],
    ];

    it.each(cases)('%s → 400 INVALID_SIGNATURE and no row changes', async (_name, build) => {
      const { booking, payment } = await seed();
      const snapshot = async () =>
        JSON.stringify([await bookingRow(booking.id), await paymentRow(payment.id), await eventCount()]);
      const before = await snapshot();

      const request = build(succeeded('evt_1'));
      const res = await app.inject({ method: 'POST', url: '/webhooks/stripe', headers: request.headers, payload: request.payload });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ code: 'INVALID_SIGNATURE', message: 'The webhook signature is missing or invalid.' });
      expect(res.body).not.toContain(WEBHOOK_SECRET);
      expect(res.body).not.toContain('pi_test');
      expect(await snapshot()).toBe(before);
    });

    it('is refused as unsigned while payments are off', async () => {
      const off = await buildApp({ config: loadConfig({}), clock: { now: () => T } });
      try {
        const signed = signedWebhook(WEBHOOK_SECRET, succeeded('evt_1'));
        const res = await off.inject({ method: 'POST', url: '/webhooks/stripe', headers: signed.headers, payload: signed.payload });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('INVALID_SIGNATURE');
      } finally {
        await off.close();
      }
    });

    it('is the only public route outside /api (besides /health)', () => {
      const publicOutsideApi = (app.routeTable as { method: string | string[]; url: string; public: boolean }[])
        .filter((route) => route.public && !route.url.startsWith('/api/'))
        .map((route) => `${String(route.method)} ${route.url}`);
      expect(publicOutsideApi).toEqual(['POST /webhooks/stripe']);
    });
  });

  describe('AC 5: idempotent webhook', () => {
    it('the same event delivered twice confirms once, stores one event and leaves updated_at alone', async () => {
      const { booking, payment } = await seed();
      expect((await deliver(succeeded('evt_1'))).statusCode).toBe(200);
      const paymentAfterFirst = await paymentRow(payment.id);
      const bookingAfterFirst = await bookingRow(booking.id);

      const second = await deliver(succeeded('evt_1'));
      expect(second.statusCode).toBe(200);
      expect(await eventCount()).toBe(1);
      expect(await paymentRow(payment.id)).toEqual(paymentAfterFirst);
      expect(await bookingRow(booking.id)).toEqual(bookingAfterFirst);
      expect(bookingAfterFirst.status).toBe('confirmed');
    });

    it('two different events for the same payment change nothing the second time', async () => {
      const { payment } = await seed();
      await deliver(succeeded('evt_1'));
      const afterFirst = await paymentRow(payment.id);

      const res = await deliver(succeeded('evt_2'));
      expect(res.statusCode).toBe(200);
      expect(await paymentRow(payment.id)).toEqual(afterFirst);
      expect(await eventCount()).toBe(2);
    });

    it('two parallel deliveries of the same event store one event and confirm once', async () => {
      const { booking, payment } = await seed();
      const results = await Promise.all([deliver(succeeded('evt_1')), deliver(succeeded('evt_1'))]);
      expect(results.map((res) => res.statusCode)).toEqual([200, 200]);
      expect(await eventCount()).toBe(1);
      expect((await bookingRow(booking.id)).status).toBe('confirmed');
      expect((await paymentRow(payment.id)).status).toBe('succeeded');
    });
  });

  it('AC 9: a payment that succeeds after the booking was cancelled is queued for a refund', async () => {
    const { cls, booking, payment } = await seed({ bookingStatus: 'cancelled' });
    const res = await deliver(succeeded('evt_1'));
    expect(res.statusCode).toBe(200);

    const late = await paymentRow(payment.id);
    expect(late).toMatchObject({ status: 'succeeded', refund_status: 'pending', refund_reason: 'late_payment' });
    expect(late.refund_next_retry_at?.getTime()).toBe(T.getTime());
    expect((await bookingRow(booking.id)).status).toBe('cancelled');
    const active = await db
      .selectFrom('booking')
      .select('id')
      .where('class_id', '=', cls.id)
      .where('status', '!=', 'cancelled')
      .execute();
    expect(active).toHaveLength(0);
  });

  it('an event that arrives before the intent id was stored is matched through metadata.paymentId', async () => {
    const { booking, payment } = await seed({ paymentStatus: 'pending_retry', intentId: null });
    const event = paymentIntentEvent('payment_intent.succeeded', {
      eventId: 'evt_early',
      intentId: 'pi_early',
      amountReceived: DROP_IN_PRICE,
      metadata: { paymentId: payment.id },
    });
    expect((await deliver(event)).statusCode).toBe(200);
    expect(await paymentRow(payment.id)).toMatchObject({ status: 'succeeded', stripe_payment_intent_id: 'pi_early' });
    expect((await bookingRow(booking.id)).status).toBe('confirmed');
  });

  it('an unknown payment or a malformed metadata id is acknowledged without changing anything', async () => {
    const { booking, payment } = await seed();
    const unknown = paymentIntentEvent('payment_intent.succeeded', {
      eventId: 'evt_other_env',
      intentId: 'pi_other_environment',
      metadata: { paymentId: 'not-a-uuid' },
    });
    expect((await deliver(unknown)).statusCode).toBe(200);
    expect((await paymentRow(payment.id)).status).toBe('requires_payment');
    expect((await bookingRow(booking.id)).status).toBe('pending_payment');
  });

  it('an event type FitHub does not handle here is acknowledged and not stored', async () => {
    await seed();
    const res = await deliver({ id: 'evt_refund', object: 'event', type: 'charge.refunded', data: { object: { id: 'ch_1' } } });
    expect(res.statusCode).toBe(200);
    expect(await eventCount()).toBe(0);
  });
});
