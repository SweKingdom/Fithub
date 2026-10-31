import type { Kysely, Selectable } from 'kysely';
import { z } from 'zod';
import type { PaymentsConfig, WaitlistConfig } from '../../config.js';
import type { BookingTable, Database } from '../../db/schema.js';
import type { Notifier } from '../../notifications/notifier.js';
import type { Clock } from '../../shared/clock.js';
import type { Logger } from '../../shared/logger.js';
import type { AuthUser } from '../auth/types.js';
import { bookingNotFound } from '../bookings/access.js';
import { findOwnBooking, lockClassForUpdate, markBookingCancelled } from '../bookings/repository.js';
import { notifyPromotions, promoteNext, type Promotion, type PromotionContext } from '../waitlist/promotion.js';
import { holdExpiresAt, toPaymentDto, type PaymentDto } from './dto.js';
import { bookingNotPayable, paymentNotFound, paymentProviderUnavailable, paymentsUnavailable } from './errors.js';
import { GatewayError, type PaymentGateway, type WebhookEvent } from './gateway.js';
import {
  confirmBooking,
  findPaymentByBookingId,
  findPaymentById,
  findPaymentByIntentId,
  insertPayment,
  insertStripeEvent,
  loadPayment,
  lockBookingForUpdate,
  lockPaymentForUpdate,
  markExpiredWithIntent,
  markFailed,
  markRequiresPayment,
  markSucceeded,
  recordCreateFailure,
  type PaymentView,
} from './repository.js';
import type { PaymentTable } from './tables.js';

/** Same default as `PAYMENT_HOLD_MINUTES`; only used to show a hold after payments were switched off. */
const FALLBACK_HOLD_MINUTES = 30;

const HANDLED_EVENTS = new Set(['payment_intent.succeeded', 'payment_intent.payment_failed']);
const uuid = z.string().uuid();

export interface PaymentDeps {
  db: Kysely<Database>;
  clock: Clock;
  payments: PaymentsConfig;
  gateway: PaymentGateway;
  waitlist: WaitlistConfig;
  notifier: Notifier;
  logger: Logger;
}

/** The three rows of one payment, locked in the order `gym_class` → `booking` → `payment`. */
interface Locked {
  booking: { id: string; class_id: string; status: BookingTable['status'] };
  payment: Selectable<PaymentTable>;
}

function requireEnabled(config: PaymentsConfig): Extract<PaymentsConfig, { enabled: true }> {
  if (!config.enabled) throw paymentsUnavailable();
  return config;
}

function promotionContext(deps: PaymentDeps): PromotionContext {
  return {
    clock: deps.clock,
    config: deps.waitlist,
    logger: deps.logger,
    paymentsEnabled: deps.payments.enabled,
  };
}

/** `clientSecret` is exposed only for a `requires_payment` payment, and comes from a fresh Stripe response. */
function toDto(deps: PaymentDeps, payment: PaymentView, clientSecret: string | null): PaymentDto {
  const { payments } = deps;
  const hold = holdExpiresAt(payment.booked_at, payment.class_start_at, payments.holdMinutes ?? FALLBACK_HOLD_MINUTES);
  const credentials =
    clientSecret !== null && payments.enabled
      ? { clientSecret, publishableKey: payments.stripePublishableKey }
      : undefined;
  return toPaymentDto(payment, hold, credentials);
}

async function lockChain(
  trx: Kysely<Database>,
  payment: Pick<PaymentView, 'id' | 'booking_id' | 'class_id'>,
): Promise<Locked | undefined> {
  await lockClassForUpdate(trx, payment.class_id);
  const booking = await lockBookingForUpdate(trx, payment.booking_id);
  const row = await lockPaymentForUpdate(trx, payment.id);
  return booking && row ? { booking, payment: row } : undefined;
}

/** Payment failed for good: the booking is cancelled and the freed place goes to the waiting list. */
async function declineLocked(trx: Kysely<Database>, locked: Locked, ctx: PromotionContext): Promise<Promotion[]> {
  const now = ctx.clock.now();
  await markFailed(trx, locked.payment.id, now);
  await markBookingCancelled(trx, locked.booking.id, now);
  return promoteNext(trx, locked.booking.class_id, ctx);
}

/**
 * Called by `bookClass` (US-122) inside the booking transaction, right after it inserted a `pending_payment`
 * booking for a drop-in member. Throws `409 PAYMENTS_UNAVAILABLE` while payments are off, which rolls the
 * booking back. Amount and currency always come from the configuration.
 */
export async function createDropInPayment(
  trx: Kysely<Database>,
  booking: { id: string },
  config: PaymentsConfig,
  now: Date,
): Promise<string> {
  const enabled = requireEnabled(config);
  const { id } = await insertPayment(trx, {
    bookingId: booking.id,
    amount: enabled.dropInPriceAmount,
    currency: enabled.dropInCurrency,
    now,
  });
  return id;
}

async function handleCreateFailure(deps: PaymentDeps, payment: PaymentView, error: GatewayError): Promise<void> {
  const now = deps.clock.now();
  if (error.kind === 'declined') {
    const promotions = await deps.db.transaction().execute(async (trx) => {
      const locked = await lockChain(trx, payment);
      if (!locked || locked.payment.status !== 'pending_retry' || locked.booking.status !== 'pending_payment') {
        return [];
      }
      return declineLocked(trx, locked, promotionContext(deps));
    });
    await notifyPromotions(promotions, deps.notifier, deps.logger);
    return;
  }
  await recordCreateFailure(deps.db, payment.id, error, now);
  const fields = { paymentId: payment.id, kind: error.kind, code: error.code };
  // A rejected request points to misconfiguration (keys, permissions); an unavailable Stripe is expected now and then.
  if (error.kind === 'rejected') deps.logger.error(fields, 'payment.create_rejected');
  else deps.logger.warn(fields, 'payment.create_unavailable');
}

/**
 * One create attempt at Stripe for a `pending_retry` payment. Runs outside any transaction: the class lock is
 * never held during the Stripe call. Returns the payment as the member sees it, with the client secret when the
 * intent was created.
 */
export async function startPayment(deps: PaymentDeps, paymentId: string): Promise<PaymentDto> {
  const payment = await loadPayment(deps.db, paymentId);
  if (payment.status !== 'pending_retry') return toDto(deps, payment, null);

  const result = await deps.gateway
    .createIntent({
      amount: payment.amount,
      currency: payment.currency,
      idempotencyKey: payment.idempotency_key,
      metadata: { bookingId: payment.booking_id, memberId: payment.member_id, paymentId: payment.id },
    })
    .then(
      (intent) => ({ intent }),
      (error: unknown) => ({ error }),
    );

  if ('error' in result) {
    if (!(result.error instanceof GatewayError)) throw result.error;
    await handleCreateFailure(deps, payment, result.error);
    return toDto(deps, await loadPayment(deps.db, paymentId), null);
  }

  const { intent } = result;
  const now = deps.clock.now();
  await deps.db.transaction().execute(async (trx) => {
    const locked = await lockChain(trx, payment);
    if (!locked || locked.payment.status !== 'pending_retry') return;
    if (locked.booking.status === 'pending_payment') await markRequiresPayment(trx, payment.id, intent.id, now);
    else await markExpiredWithIntent(trx, payment.id, intent.id, now);
  });
  const stored = await loadPayment(deps.db, paymentId);
  return toDto(deps, stored, stored.status === 'requires_payment' ? intent.clientSecret : null);
}

/** The member's own booking, or the same 404 for someone else's and for an unknown id (ADR-011). */
async function findOwnPayableBooking(deps: PaymentDeps, user: AuthUser, bookingId: string) {
  const booking = user.role === 'member' ? await findOwnBooking(deps.db, bookingId, user.id, false) : undefined;
  if (!booking) throw bookingNotFound();
  return booking;
}

/** A booking promoted from the waiting list has no payment row yet: create it under the locks. */
async function createMissingPayment(deps: PaymentDeps, booking: { id: string; class_id: string }): Promise<string> {
  const config = requireEnabled(deps.payments);
  const now = deps.clock.now();
  return deps.db.transaction().execute(async (trx) => {
    await lockClassForUpdate(trx, booking.class_id);
    const locked = await lockBookingForUpdate(trx, booking.id);
    if (!locked) throw bookingNotFound();
    if (locked.status !== 'pending_payment') throw bookingNotPayable(locked.status);
    const existing = await findPaymentByBookingId(trx, booking.id);
    if (existing) return existing.id;
    return createDropInPayment(trx, booking, config, now);
  });
}

/**
 * `POST /bookings/:id/payment`: the pay page loads this once. A `requires_payment` payment gets its existing
 * PaymentIntent back (no second one is created); a payment that is due, or missing, gets a create attempt.
 */
export async function resumePayment(deps: PaymentDeps, user: AuthUser, bookingId: string): Promise<PaymentDto> {
  const booking = await findOwnPayableBooking(deps, user, bookingId);
  if (booking.status !== 'pending_payment') throw bookingNotPayable(booking.status);
  requireEnabled(deps.payments);

  const existing = await findPaymentByBookingId(deps.db, bookingId);
  const payment = existing ?? (await loadPayment(deps.db, await createMissingPayment(deps, booking)));

  if (payment.status === 'pending_retry') return startPayment(deps, payment.id);
  if (payment.status === 'requires_payment' && payment.stripe_payment_intent_id !== null) {
    try {
      const intent = await deps.gateway.retrieveIntent(payment.stripe_payment_intent_id);
      return toDto(deps, payment, intent.clientSecret);
    } catch (error) {
      if (!(error instanceof GatewayError)) throw error;
      deps.logger.warn({ paymentId: payment.id, kind: error.kind, code: error.code }, 'payment.retrieve_failed');
      throw paymentProviderUnavailable();
    }
  }
  return toDto(deps, payment, null);
}

/** `GET /bookings/:id/payment`: the state of the payment, never the client secret, never a Stripe call. */
export async function getPayment(deps: PaymentDeps, user: AuthUser, bookingId: string): Promise<PaymentDto> {
  await findOwnPayableBooking(deps, user, bookingId);
  const payment = await findPaymentByBookingId(deps.db, bookingId);
  if (!payment) throw paymentNotFound();
  return toDto(deps, payment, null);
}

/** `payment_intent.succeeded`: confirm the booking, or, when it was cancelled meanwhile, queue the refund. */
export async function applyIntentSucceeded(
  trx: Kysely<Database>,
  locked: Locked,
  intentId: string,
  now: Date,
): Promise<void> {
  const { booking, payment } = locked;
  if (payment.status === 'succeeded' || payment.status === 'refunded') return;
  await markSucceeded(trx, payment.id, intentId, now, booking.status === 'cancelled');
  if (booking.status === 'pending_payment') await confirmBooking(trx, booking.id, now);
}

/** `payment_intent.payment_failed`: only a payment that is waiting for the card and its held booking are affected. */
export async function applyIntentFailed(
  trx: Kysely<Database>,
  locked: Locked,
  ctx: PromotionContext,
): Promise<Promotion[]> {
  if (locked.payment.status !== 'requires_payment' || locked.booking.status !== 'pending_payment') return [];
  return declineLocked(trx, locked, ctx);
}

async function findPaymentOfEvent(trx: Kysely<Database>, event: WebhookEvent): Promise<PaymentView | undefined> {
  const byIntent = event.objectId === null ? undefined : await findPaymentByIntentId(trx, event.objectId);
  if (byIntent) return byIntent;
  // The event can arrive before the create call's own transaction stored the intent id.
  const paymentId = uuid.safeParse(event.metadata.paymentId);
  return paymentId.success ? findPaymentById(trx, paymentId.data) : undefined;
}

/**
 * Applies a verified webhook event once. Duplicates (same event id) change nothing. Unknown event types and
 * payments (another environment's intent) are logged and acknowledged, so Stripe does not retry them.
 */
export async function handleStripeEvent(deps: PaymentDeps, event: WebhookEvent): Promise<void> {
  const { logger } = deps;
  if (!HANDLED_EVENTS.has(event.type) || event.objectId === null) {
    logger.warn({ eventId: event.id, type: event.type }, 'stripe.event_ignored');
    return;
  }
  const intentId = event.objectId;

  const promotions = await deps.db.transaction().execute(async (trx) => {
    if (!(await insertStripeEvent(trx, event.id, event.type))) return [];
    const found = await findPaymentOfEvent(trx, event);
    if (!found) {
      logger.warn({ eventId: event.id, type: event.type }, 'stripe.payment_not_found');
      return [];
    }
    const locked = await lockChain(trx, found);
    if (!locked) return [];

    if (event.type === 'payment_intent.succeeded') {
      if (event.amountReceived !== null && event.amountReceived !== locked.payment.amount) {
        // Stripe is the source of truth for a charge that happened: log it, still apply it.
        logger.error({ eventId: event.id, paymentId: found.id }, 'stripe.amount_mismatch');
      }
      await applyIntentSucceeded(trx, locked, intentId, deps.clock.now());
      return [];
    }
    return applyIntentFailed(trx, locked, promotionContext(deps));
  });
  await notifyPromotions(promotions, deps.notifier, logger);
}
