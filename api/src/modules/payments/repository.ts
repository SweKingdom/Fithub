import { sql, type Kysely, type Selectable } from 'kysely';
import type { BookingTable, Database } from '../../db/schema.js';
import type { GatewayError } from './gateway.js';
import type { PaymentTable } from './tables.js';

const MAX_LAST_ERROR_LENGTH = 200;

/** A payment with what its booking and class contribute: member, class, booking state, hold start and class start. */
function paymentRows(db: Kysely<Database>) {
  return db
    .selectFrom('payment')
    .innerJoin('booking', 'booking.id', 'payment.booking_id')
    .innerJoin('gym_class', 'gym_class.id', 'booking.class_id')
    .select([
      'payment.id as id',
      'payment.booking_id as booking_id',
      'payment.idempotency_key as idempotency_key',
      'payment.stripe_payment_intent_id as stripe_payment_intent_id',
      'payment.amount as amount',
      'payment.currency as currency',
      'payment.status as status',
      'payment.next_retry_at as next_retry_at',
      'booking.member_id as member_id',
      'booking.class_id as class_id',
      'booking.status as booking_status',
      'booking.booked_at as booked_at',
      'gym_class.start_at as class_start_at',
    ]);
}

export type PaymentView = Awaited<ReturnType<ReturnType<typeof paymentRows>['executeTakeFirstOrThrow']>>;

export async function findPaymentById(db: Kysely<Database>, id: string): Promise<PaymentView | undefined> {
  return paymentRows(db).where('payment.id', '=', id).executeTakeFirst();
}

export async function loadPayment(db: Kysely<Database>, id: string): Promise<PaymentView> {
  return paymentRows(db).where('payment.id', '=', id).executeTakeFirstOrThrow();
}

export async function findPaymentByBookingId(
  db: Kysely<Database>,
  bookingId: string,
): Promise<PaymentView | undefined> {
  return paymentRows(db).where('payment.booking_id', '=', bookingId).executeTakeFirst();
}

export async function findPaymentByIntentId(
  db: Kysely<Database>,
  intentId: string,
): Promise<PaymentView | undefined> {
  return paymentRows(db).where('payment.stripe_payment_intent_id', '=', intentId).executeTakeFirst();
}

/** Lock order (ADR-010 extended): `gym_class` → `booking` → `payment` → `app_user`. */
export async function lockBookingForUpdate(
  trx: Kysely<Database>,
  id: string,
): Promise<{ id: string; class_id: string; status: BookingTable['status'] } | undefined> {
  return trx
    .selectFrom('booking')
    .select(['id', 'class_id', 'status'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
}

export async function lockPaymentForUpdate(
  trx: Kysely<Database>,
  id: string,
): Promise<Selectable<PaymentTable> | undefined> {
  return trx.selectFrom('payment').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
}

/** A payment in `pending_retry`, due now: the first create attempt follows the booking transaction. */
export async function insertPayment(
  trx: Kysely<Database>,
  row: { bookingId: string; amount: number; currency: string; now: Date },
): Promise<{ id: string }> {
  return trx
    .insertInto('payment')
    .values({
      booking_id: row.bookingId,
      idempotency_key: `booking-${row.bookingId}`,
      amount: row.amount,
      currency: row.currency,
      status: 'pending_retry',
      attempt_count: 0,
      next_retry_at: row.now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
}

/** Stripe accepted the create call. */
export async function markRequiresPayment(
  trx: Kysely<Database>,
  id: string,
  intentId: string,
  now: Date,
): Promise<void> {
  await trx
    .updateTable('payment')
    .set({
      status: 'requires_payment',
      stripe_payment_intent_id: intentId,
      attempt_count: sql`attempt_count + 1`,
      next_retry_at: null,
      last_error: null,
      updated_at: now,
    })
    .where('id', '=', id)
    .execute();
}

/** The booking was cancelled while the create call was running: keep the intent id so US-133 can cancel it. */
export async function markExpiredWithIntent(
  trx: Kysely<Database>,
  id: string,
  intentId: string,
  now: Date,
): Promise<void> {
  await trx
    .updateTable('payment')
    .set({
      status: 'expired',
      stripe_payment_intent_id: intentId,
      attempt_count: sql`attempt_count + 1`,
      next_retry_at: null,
      updated_at: now,
    })
    .where('id', '=', id)
    .execute();
}

/** A create attempt failed (unavailable or rejected): count it and keep the payment due. Kind and code only. */
export async function recordCreateFailure(
  db: Kysely<Database>,
  id: string,
  error: GatewayError,
  now: Date,
): Promise<void> {
  await db
    .updateTable('payment')
    .set({
      attempt_count: sql`attempt_count + 1`,
      next_retry_at: now,
      last_error: `${error.kind}:${error.code}`.slice(0, MAX_LAST_ERROR_LENGTH),
      updated_at: now,
    })
    .where('id', '=', id)
    .where('status', '=', 'pending_retry')
    .execute();
}

/**
 * Stripe reports the charge. With `lateRefund` the booking was already cancelled, so the money goes back
 * (US-134 sends the refund). The intent id is only filled when it is still empty.
 */
export async function markSucceeded(
  trx: Kysely<Database>,
  id: string,
  intentId: string,
  now: Date,
  lateRefund: boolean,
): Promise<void> {
  await trx
    .updateTable('payment')
    .set({
      status: 'succeeded',
      stripe_payment_intent_id: sql`coalesce(stripe_payment_intent_id, ${intentId})`,
      succeeded_at: now,
      next_retry_at: null,
      updated_at: now,
      ...(lateRefund
        ? { refund_status: 'pending' as const, refund_reason: 'late_payment' as const, refund_next_retry_at: now }
        : {}),
    })
    .where('id', '=', id)
    .execute();
}

export async function markFailed(trx: Kysely<Database>, id: string, now: Date): Promise<void> {
  await trx
    .updateTable('payment')
    .set({ status: 'failed', next_retry_at: null, updated_at: now })
    .where('id', '=', id)
    .execute();
}

export async function confirmBooking(trx: Kysely<Database>, id: string, now: Date): Promise<void> {
  await trx.updateTable('booking').set({ status: 'confirmed', updated_at: now }).where('id', '=', id).execute();
}

/** Records a webhook event once. `false` means the event id was already stored: a duplicate delivery. */
export async function insertStripeEvent(trx: Kysely<Database>, id: string, type: string): Promise<boolean> {
  const row = await trx
    .insertInto('stripe_event')
    .values({ event_id: id, type })
    .onConflict((oc) => oc.column('event_id').doNothing())
    .returning('event_id')
    .executeTakeFirst();
  return row !== undefined;
}
