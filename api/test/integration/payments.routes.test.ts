import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig, type AppConfig } from '../../src/config.js';
import { GatewayError } from '../../src/modules/payments/gateway.js';
import type { BookingTable } from '../../src/db/schema.js';
import { signInAs } from '../helpers/auth.js';
import { testDb } from '../helpers/db.js';
import {
  createBooking,
  createClass,
  createClub,
  createPayment,
  createUser,
} from '../helpers/factories.js';
import { FakeGateway } from '../helpers/fakes.js';
import { DROP_IN_PRICE, PUBLISHABLE_KEY, paymentsConfig } from '../helpers/stripe-events.js';

const T = new Date('2026-10-30T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const RANDOM_ID = '00000000-0000-4000-8000-000000000000';

type App = Awaited<ReturnType<typeof buildApp>>;

describe('payment routes (US-132)', () => {
  const db = testDb();
  let app: App;
  let gateway: FakeGateway;

  async function cleanUp(): Promise<void> {
    await db.deleteFrom('payment').execute();
    await db.deleteFrom('booking').execute();
    await db.deleteFrom('gym_class').execute();
  }

  async function start(config: AppConfig = paymentsConfig()): Promise<void> {
    app = await buildApp({ db, config, clock: { now: () => T }, paymentGateway: gateway });
  }

  beforeEach(async () => {
    await cleanUp();
    gateway = new FakeGateway();
    await start();
  });
  afterEach(async () => {
    await app.close();
  });

  async function world(bookingStatus: BookingTable['status'] = 'pending_payment') {
    const club = await createClub(db, { name: 'Club A', timezone: 'Europe/Stockholm' });
    const cls = await createClass(db, { clubId: club.id, startAt: new Date(T.getTime() + 5 * HOUR) });
    const member = await createUser(db, { role: 'member', memberType: 'drop_in', clubId: club.id });
    const other = await createUser(db, { role: 'member', memberType: 'drop_in', clubId: club.id });
    const staff = await createUser(db, { role: 'instructor', clubId: club.id });
    const booking = await createBooking(db, {
      classId: cls.id,
      memberId: member.id,
      status: bookingStatus,
      bookedAt: T,
    });
    return { club, cls, member, other, staff, booking, cookie: await signInAs(app, member) };
  }

  function call(method: 'GET' | 'POST', bookingId: string, cookie?: string) {
    return app.inject({
      method,
      url: `/api/bookings/${bookingId}/payment`,
      headers: cookie ? { cookie } : {},
    });
  }

  const paymentCount = async () => (await db.selectFrom('payment').select('id').execute()).length;

  describe('AC 8: resume payment', () => {
    it('a booking without a payment row (promoted from the waiting list) gets one and the first attempt', async () => {
      const { booking, cookie } = await world();
      const res = await call('POST', booking.id, cookie);

      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.json()).toMatchObject({
        status: 'requires_payment',
        clientSecret: 'pi_fake_1_secret_x',
        publishableKey: PUBLISHABLE_KEY,
        amount: DROP_IN_PRICE,
        currency: 'eur',
        holdExpiresAt: new Date(T.getTime() + 30 * 60 * 1000).toISOString(),
      });
      const row = await db.selectFrom('payment').selectAll().where('booking_id', '=', booking.id).executeTakeFirstOrThrow();
      expect(row).toMatchObject({ status: 'requires_payment', attempt_count: 1, stripe_payment_intent_id: 'pi_fake_1' });
      expect(gateway.createCalls).toHaveLength(1);
    });

    it('a second resume retrieves the existing PaymentIntent and creates no second one', async () => {
      const { booking, cookie } = await world();
      const first = await call('POST', booking.id, cookie);
      const second = await call('POST', booking.id, cookie);

      expect(second.statusCode).toBe(200);
      expect(second.json().clientSecret).toBe(first.json().clientSecret);
      expect(gateway.retrieveCalls).toEqual(['pi_fake_1']);
      expect(gateway.createCalls).toHaveLength(1);
      expect(await paymentCount()).toBe(1);
    });

    it('GET returns the same payment without the client secret and never calls Stripe', async () => {
      const { booking, cookie } = await world();
      await call('POST', booking.id, cookie);
      const creates = gateway.createCalls.length;
      const retrieves = gateway.retrieveCalls.length;

      const res = await call('GET', booking.id, cookie);

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        status: 'requires_payment',
        clientSecret: null,
        publishableKey: null,
        amount: DROP_IN_PRICE,
        currency: 'eur',
        message: null,
      });
      expect(gateway.createCalls).toHaveLength(creates);
      expect(gateway.retrieveCalls).toHaveLength(retrieves);
    });

    it('GET for a booking without a payment row is 404 PAYMENT_NOT_FOUND', async () => {
      const { booking, cookie } = await world();
      const res = await call('GET', booking.id, cookie);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ code: 'PAYMENT_NOT_FOUND', message: 'There is no payment for this booking.' });
    });

    it('a payment that is due is attempted again; while Stripe is down it answers pending_retry with the hold message', async () => {
      const { booking, cookie } = await world();
      await createPayment(db, { bookingId: booking.id, status: 'pending_retry' });
      gateway.createFailures = [new GatewayError('unavailable', 'api_connection_error')];

      const down = await call('POST', booking.id, cookie);
      expect(down.statusCode).toBe(200);
      expect(down.json()).toMatchObject({ status: 'pending_retry', clientSecret: null });
      expect(down.json().message).toContain("we'll retry automatically");

      const up = await call('POST', booking.id, cookie);
      expect(up.json()).toMatchObject({ status: 'requires_payment', clientSecret: 'pi_fake_1_secret_x' });
      expect(gateway.createCalls).toHaveLength(2);
    });

    it('answers 503 PAYMENT_PROVIDER_UNAVAILABLE when Stripe cannot be reached to retrieve the intent', async () => {
      const { booking, cookie } = await world();
      await createPayment(db, { bookingId: booking.id, status: 'requires_payment', intentId: 'pi_known' });
      gateway.retrieveFailure = new GatewayError('unavailable', 'api_connection_error');

      const res = await call('POST', booking.id, cookie);

      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    });
  });

  it('AC 7: with payments switched off, paying is 409 PAYMENTS_UNAVAILABLE and no payment row is stored', async () => {
    await app.close();
    await start(loadConfig({}));
    const { booking, cookie } = await world();

    const res = await call('POST', booking.id, cookie);

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      code: 'PAYMENTS_UNAVAILABLE',
      message: 'Online payment is not available yet. Please contact your club.',
    });
    expect(await paymentCount()).toBe(0);
    expect(gateway.createCalls).toHaveLength(0);
  });

  describe('AC 10: access', () => {
    it.each(['GET', 'POST'] as const)('%s without a session is 401 UNAUTHENTICATED', async (method) => {
      const { booking } = await world();
      const res = await call(method, booking.id);
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHENTICATED');
    });

    it.each(['GET', 'POST'] as const)('%s as an instructor is 403 FORBIDDEN', async (method) => {
      const { booking, staff } = await world();
      const res = await call(method, booking.id, await signInAs(app, staff));
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: 'FORBIDDEN', message: 'Only members can pay for bookings.' });
    });

    it.each(['GET', 'POST'] as const)(
      '%s for another member’s booking and for an unknown id give the identical 404',
      async (method) => {
        const { booking, other } = await world();
        const cookie = await signInAs(app, other);
        const foreign = await call(method, booking.id, cookie);
        const unknown = await call(method, RANDOM_ID, cookie);
        expect(foreign.statusCode).toBe(404);
        expect(foreign.body).toBe(unknown.body);
        expect(foreign.json()).toEqual({ code: 'BOOKING_NOT_FOUND', message: 'This booking does not exist.' });
        expect(gateway.createCalls).toHaveLength(0);
      },
    );

    it('POST for a confirmed booking is 409 BOOKING_NOT_PAYABLE "already paid"', async () => {
      const { booking, cookie } = await world('confirmed');
      const res = await call('POST', booking.id, cookie);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ code: 'BOOKING_NOT_PAYABLE', message: 'This booking is already paid.' });
    });

    it('POST for a cancelled booking is 409 BOOKING_NOT_PAYABLE "book the class again"', async () => {
      const { booking, cookie } = await world('cancelled');
      const res = await call('POST', booking.id, cookie);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({
        code: 'BOOKING_NOT_PAYABLE',
        message: "This booking has been cancelled, so it can't be paid. Please book the class again.",
      });
      expect(await paymentCount()).toBe(0);
    });

    it('a malformed booking id is 400 VALIDATION_ERROR', async () => {
      const { cookie } = await world();
      const res = await call('GET', 'abc', cookie);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_ERROR');
    });
  });
});
