import type { ColumnType, Generated } from 'kysely';

/**
 * Kysely table types for `payment` and `stripe_event` (US-132, ADR-008).
 * Kept next to the payments module until `api/src/db/schema.ts` exists (TK-119); then add
 * `payment: PaymentTable` and `stripe_event: StripeEventTable` to its `Database` interface and re-export.
 */

export type PaymentStatus = 'pending_retry' | 'requires_payment' | 'succeeded' | 'failed' | 'expired' | 'refunded';
export type RefundStatus = 'none' | 'pending' | 'succeeded' | 'failed';
export type RefundReason = 'member_cancelled' | 'class_cancelled' | 'late_payment' | 'manual';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;

export interface PaymentTable {
  id: Generated<string>;
  booking_id: string;
  idempotency_key: string;
  stripe_payment_intent_id: ColumnType<string | null, string | null | undefined, string | null>;
  /** Minor units. */
  amount: number;
  /** Lower-case ISO 4217 code. */
  currency: string;
  status: ColumnType<PaymentStatus, PaymentStatus | undefined, PaymentStatus>;
  attempt_count: ColumnType<number, number | undefined, number>;
  next_retry_at: NullableTimestamp;
  last_error: ColumnType<string | null, string | null | undefined, string | null>;
  succeeded_at: NullableTimestamp;
  intent_cancelled_at: NullableTimestamp;
  refund_status: ColumnType<RefundStatus, RefundStatus | undefined, RefundStatus>;
  refund_reason: ColumnType<RefundReason | null, RefundReason | null | undefined, RefundReason | null>;
  stripe_refund_id: ColumnType<string | null, string | null | undefined, string | null>;
  refund_attempt_count: ColumnType<number, number | undefined, number>;
  refund_next_retry_at: NullableTimestamp;
  refunded_at: NullableTimestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface StripeEventTable {
  event_id: string;
  type: string;
  received_at: Timestamp;
}
