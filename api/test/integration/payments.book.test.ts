import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { GatewayError } from '../../src/modules/payments/gateway.js';
import { createDropInPayment, startPayment, type PaymentDeps } from '../../src/modules/payments/service.js';
import { promoteNext } from '../../src/modules/waitlist/promotion.js';
import { testDb } from '../helpers/db.js';
import {
  createBooking,
  createClass,
  createClub,
  createUser,
  createWaitlistEntry,
} from '../helpers/factories.js';
import { FakeGateway, FakeNotifier, createRecordingLogger } from '../helpers/fakes.js';
import { DROP_IN_PRICE, PUBLISHABLE_KEY, paymentsConfig } from '../helpers/stripe-events.js';

const T = new Date('2026-10-30T09:00:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/**
 * The payment side of booking a drop-in place (US-132 AC 1, 3 and 7), driven through the service functions that
 * `bookClass` (US-122) calls. The route-level assertions are pending until US-122 delivers the booking route.
 */
describe('drop-in payment start (US-132)', () => {
  const db = testDb();
  const config = paymentsConfig();
  let gateway: FakeGateway;
  let notifier: FakeNotifier;
  let logs: ReturnType<typeof createRecordingLogger>;
  let deps: PaymentDeps;

  async function cleanUp(): Promise<void> {
    await db.deleteFrom('payment').execute();
    await db.deleteFrom('waitlist_entry').execute();
    await db.deleteFrom('booking').execute();
    await db.deleteFrom('gym_class').execute();
  }

  afterAll(cleanUp);
  beforeEach(async () => {
    await cleanUp();
    gateway = new FakeGateway();
    notifier = new FakeNotifier();
    logs = createRecordingLogger();
    deps = {
      db,
      clock: { now: () => T },
      payments: config.payments,
      gateway,
      waitlist: config.waitlist,
      notifier,
      logger: logs.logger,
    };
  });

  /** A drop-in member's `pending_payment` booking and the `payment` row that the booking transaction adds. */
  async function dropInBooking(capacity = 20) {
    const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const cls = await createClass(db, { clubId: club.id, startAt: new Date(T.getTime() + 5 * HOUR), capacity });
    const member = await createUser(db, { role: 'member', memberType: 'drop_in', clubId: club.id });
    const booking = await createBooking(db, {
      classId: cls.id,
      memberId: member.id,
      status: 'pending_payment',
      bookedAt: T,
    });
    const paymentId = await db.transaction().execute((trx) => createDropInPayment(trx, booking, deps.payments, T));
    return { club, cls, member, booking, paymentId };
  }

  const paymentRow = (id: string) =>
    db.selectFrom('payment').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const bookingRow = (id: string) =>
    db.selectFrom('booking').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

  it('AC 1: the booking transaction stores a payment due now, priced from the configuration', async () => {
    const { booking, paymentId } = await dropInBooking();
    const row = await paymentRow(paymentId);
    expect(row).toMatchObject({
      booking_id: booking.id,
      idempotency_key: `booking-${booking.id}`,
      status: 'pending_retry',
      attempt_count: 0,
      amount: DROP_IN_PRICE,
      currency: 'eur',
      stripe_payment_intent_id: null,
    });
    expect(row.next_retry_at?.getTime()).toBe(T.getTime());
  });

  it('AC 1: startPayment creates one intent and returns the client secret, without storing it', async () => {
    const { booking, member, paymentId } = await dropInBooking();
    const dto = await startPayment(deps, paymentId);

    expect(dto).toMatchObject({
      status: 'requires_payment',
      clientSecret: 'pi_fake_1_secret_x',
      publishableKey: PUBLISHABLE_KEY,
      amount: DROP_IN_PRICE,
      currency: 'eur',
      holdExpiresAt: new Date(T.getTime() + 30 * MIN).toISOString(),
      nextRetryAt: null,
      message: null,
    });
    const row = await paymentRow(paymentId);
    expect(row).toMatchObject({
      status: 'requires_payment',
      attempt_count: 1,
      stripe_payment_intent_id: 'pi_fake_1',
      next_retry_at: null,
      last_error: null,
    });
    expect(JSON.stringify(row)).not.toContain('secret');
    expect(gateway.createCalls).toEqual([
      {
        amount: DROP_IN_PRICE,
        currency: 'eur',
        idempotencyKey: `booking-${booking.id}`,
        metadata: { bookingId: booking.id, memberId: member.id, paymentId },
      },
    ]);
    expect((await bookingRow(booking.id)).status).toBe('pending_payment');
  });

  it('AC 1: the hold never lasts past the class start', async () => {
    const { cls, paymentId } = await dropInBooking();
    await db
      .updateTable('gym_class')
      .set({ start_at: new Date(T.getTime() + 10 * MIN) })
      .where('id', '=', cls.id)
      .execute();
    const dto = await startPayment(deps, paymentId);
    expect(dto.holdExpiresAt).toBe(new Date(T.getTime() + 10 * MIN).toISOString());
  });

  it('AC 1: no Stripe call happens while the class lock is held', async () => {
    const { cls, paymentId } = await dropInBooking();
    // Fails (and so fails the test) when another connection still holds the class row lock.
    gateway.beforeCreate = async () => {
      await db.selectFrom('gym_class').select('id').where('id', '=', cls.id).forUpdate().noWait().execute();
    };
    const dto = await startPayment(deps, paymentId);
    expect(dto.status).toBe('requires_payment');
    expect(gateway.createCalls).toHaveLength(1);
  });

  it('a Stripe outage keeps the booking on hold and the payment due; the retry reuses the idempotency key', async () => {
    const { booking, paymentId } = await dropInBooking();
    gateway.createFailures = [new GatewayError('unavailable', 'api_connection_error')];

    const first = await startPayment(deps, paymentId);
    expect(first.status).toBe('pending_retry');
    expect(first.clientSecret).toBeNull();
    expect(first.message).toContain("we'll retry automatically");
    expect(await paymentRow(paymentId)).toMatchObject({
      status: 'pending_retry',
      attempt_count: 1,
      last_error: 'unavailable:api_connection_error',
    });
    expect((await bookingRow(booking.id)).status).toBe('pending_payment');

    const second = await startPayment(deps, paymentId);
    expect(second.status).toBe('requires_payment');
    expect(gateway.createCalls.map((call) => call.idempotencyKey)).toEqual([
      `booking-${booking.id}`,
      `booking-${booking.id}`,
    ]);
    expect(await paymentRow(paymentId)).toMatchObject({ status: 'requires_payment', attempt_count: 2, last_error: null });
  });

  it('a rejected Stripe request is logged at error level without secrets and keeps the payment due', async () => {
    const { paymentId } = await dropInBooking();
    gateway.createFailures = [new GatewayError('rejected', 'api_key_expired', 401)];
    await startPayment(deps, paymentId);
    expect(logs.entries).toContainEqual({
      level: 'error',
      fields: { paymentId, kind: 'rejected', code: 'api_key_expired' },
      message: 'payment.create_rejected',
    });
    expect((await paymentRow(paymentId)).status).toBe('pending_retry');
  });

  it('AC 3: a declined create cancels the booking, frees the place and promotes the waiting list', async () => {
    const { club, cls, booking, paymentId } = await dropInBooking(1);
    const waiter = await createUser(db, { role: 'member', clubId: club.id });
    const entry = await createWaitlistEntry(db, { classId: cls.id, memberId: waiter.id, joinedAt: T });
    gateway.createFailures = [new GatewayError('declined', 'card_declined', 402)];

    const dto = await startPayment(deps, paymentId);

    expect(dto.status).toBe('failed');
    expect(dto.message).toBe('Your payment was declined. Your booking was not confirmed.');
    const cancelled = await bookingRow(booking.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelled_at).not.toBeNull();
    const promoted = await db
      .selectFrom('booking')
      .selectAll()
      .where('class_id', '=', cls.id)
      .where('member_id', '=', waiter.id)
      .executeTakeFirstOrThrow();
    expect(promoted).toMatchObject({ status: 'confirmed', source: 'waitlist' });
    expect(
      (await db.selectFrom('waitlist_entry').select('status').where('id', '=', entry.id).executeTakeFirstOrThrow()).status,
    ).toBe('promoted');
    expect(notifier.calls).toHaveLength(1);
  });

  it('a booking cancelled during the create call leaves an expired payment that keeps the intent id', async () => {
    const { booking, paymentId } = await dropInBooking();
    gateway.beforeCreate = async () => {
      await db.updateTable('booking').set({ status: 'cancelled' }).where('id', '=', booking.id).execute();
    };
    const dto = await startPayment(deps, paymentId);
    expect(dto.status).toBe('expired');
    expect(dto.clientSecret).toBeNull();
    expect(await paymentRow(paymentId)).toMatchObject({ status: 'expired', stripe_payment_intent_id: 'pi_fake_1' });
  });

  it('AC 7: with payments off no payment is created and the booking transaction rolls back', async () => {
    const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const cls = await createClass(db, { clubId: club.id, startAt: new Date(T.getTime() + 5 * HOUR) });
    const member = await createUser(db, { role: 'member', memberType: 'drop_in', clubId: club.id });
    const off = loadConfig({}).payments;

    await expect(
      db.transaction().execute(async (trx) => {
        const booking = await createBooking(trx, { classId: cls.id, memberId: member.id, status: 'pending_payment' });
        await createDropInPayment(trx, booking, off, T);
      }),
    ).rejects.toMatchObject({
      code: 'PAYMENTS_UNAVAILABLE',
      httpStatus: 409,
      message: 'Online payment is not available yet. Please contact your club.',
    });
    expect(await db.selectFrom('booking').select('id').execute()).toHaveLength(0);
    expect(await db.selectFrom('payment').select('id').execute()).toHaveLength(0);
  });

  describe('waiting-list promotion of drop-in members', () => {
    async function fullClassWithQueue(paymentsEnabled: boolean) {
      const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
      const cls = await createClass(db, { clubId: club.id, startAt: new Date(T.getTime() + 5 * HOUR), capacity: 1 });
      const holder = await createUser(db, { role: 'member', clubId: club.id });
      const held = await createBooking(db, { classId: cls.id, memberId: holder.id, status: 'confirmed' });
      const dropIn = await createUser(db, { role: 'member', memberType: 'drop_in', clubId: club.id });
      const regular = await createUser(db, { role: 'member', clubId: club.id });
      const dropInEntry = await createWaitlistEntry(db, { classId: cls.id, memberId: dropIn.id, joinedAt: T });
      await createWaitlistEntry(db, { classId: cls.id, memberId: regular.id, joinedAt: new Date(T.getTime() + MIN) });
      const promotions = await db.transaction().execute(async (trx) => {
        await trx.updateTable('booking').set({ status: 'cancelled' }).where('id', '=', held.id).execute();
        return promoteNext(trx, cls.id, {
          clock: deps.clock,
          config: deps.waitlist,
          logger: logs.logger,
          paymentsEnabled,
        });
      });
      return { promotions, dropIn, regular, dropInEntry };
    }

    it('skips a drop-in member while payments are off and promotes the next regular member', async () => {
      const { promotions, regular, dropInEntry } = await fullClassWithQueue(false);
      expect(promotions.map((p) => p.memberId)).toEqual([regular.id]);
      const entry = await db
        .selectFrom('waitlist_entry')
        .select('status')
        .where('id', '=', dropInEntry.id)
        .executeTakeFirstOrThrow();
      expect(entry.status).toBe('waiting');
    });

    it('promotes a drop-in member to pending_payment while payments are on', async () => {
      const { promotions, dropIn } = await fullClassWithQueue(true);
      expect(promotions).toEqual([expect.objectContaining({ memberId: dropIn.id, bookingStatus: 'pending_payment' })]);
    });
  });

  // Pending US-122 (`POST /api/classes/:classId/bookings` does not exist on this branch yet):
  it.todo('AC 1: a drop-in member booking answers 202 with Location, BookingDto and payment, and holds the place');
  it.todo('AC 6: a regular member booking answers 201, makes no Stripe call and stores no payment row');
  it.todo('AC 7: PAYMENTS_ENABLED=false and a drop-in booking answers 409 PAYMENTS_UNAVAILABLE and stores nothing');
});
