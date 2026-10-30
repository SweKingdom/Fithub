import type { Selectable } from 'kysely';
import type { PaymentStatus, PaymentTable } from './tables.js';

export type { PaymentStatus };

export interface PaymentDto {
  status: PaymentStatus;
  /** Minor units. */
  amount: number;
  currency: string;
  /** Only when `status` = `requires_payment`, and only in the booking `202` and `POST …/payment`. */
  clientSecret: string | null;
  publishableKey: string | null;
  holdExpiresAt: string;
  nextRetryAt: string | null;
  message: string | null;
}

export type PaymentDtoSource = Pick<Selectable<PaymentTable>, 'status' | 'amount' | 'currency' | 'next_retry_at'>;

export interface ClientCredentials {
  clientSecret: string;
  publishableKey: string;
}

const MESSAGES: Partial<Record<PaymentStatus, string>> = {
  pending_retry:
    "We couldn't reach our payment provider. Your booking is on hold and we'll retry automatically – you don't need to book again.",
  failed: 'Your payment was declined. Your booking was not confirmed.',
  expired: 'Your booking was cancelled because the payment was not completed in time.',
};

/** The member-facing text for a payment state, or `null` when the state needs none. */
export function paymentMessage(status: PaymentStatus): string | null {
  return MESSAGES[status] ?? null;
}

/** `min(booked_at + PAYMENT_HOLD_MINUTES, class start_at)`. */
export function holdExpiresAt(bookedAt: Date, classStartAt: Date, holdMinutes: number): Date {
  const heldUntil = new Date(bookedAt.getTime() + holdMinutes * 60_000);
  return heldUntil.getTime() < classStartAt.getTime() ? heldUntil : classStartAt;
}

/**
 * Builds the `PaymentDto`. `credentials` are exposed only for a `requires_payment` payment; the client
 * secret is never stored, so callers pass it from a fresh Stripe response.
 */
export function toPaymentDto(
  row: PaymentDtoSource,
  holdExpires: Date,
  credentials?: ClientCredentials,
): PaymentDto {
  const exposed = row.status === 'requires_payment' ? credentials : undefined;
  return {
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    clientSecret: exposed?.clientSecret ?? null,
    publishableKey: exposed?.publishableKey ?? null,
    holdExpiresAt: holdExpires.toISOString(),
    nextRetryAt: row.status === 'pending_retry' && row.next_retry_at ? row.next_retry_at.toISOString() : null,
    message: paymentMessage(row.status),
  };
}
