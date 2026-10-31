import { sql, type Kysely } from 'kysely';

/**
 * US-132: `payment` and `stripe_event` (ADR-008: singular names, text + CHECK enums).
 * Columns owned by US-133 (retry, intent cancel) and US-134 (refund) are created here so FT-114 has one migration.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE payment (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      booking_id uuid NOT NULL REFERENCES booking (id) ON DELETE RESTRICT,
      idempotency_key text NOT NULL,
      stripe_payment_intent_id text,
      amount integer NOT NULL,
      currency char(3) NOT NULL,
      status text NOT NULL DEFAULT 'pending_retry',
      attempt_count integer NOT NULL DEFAULT 0,
      next_retry_at timestamptz,
      last_error text,
      succeeded_at timestamptz,
      intent_cancelled_at timestamptz,
      refund_status text NOT NULL DEFAULT 'none',
      refund_reason text,
      stripe_refund_id text,
      refund_attempt_count integer NOT NULL DEFAULT 0,
      refund_next_retry_at timestamptz,
      refunded_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT payment_booking_uq UNIQUE (booking_id),
      CONSTRAINT payment_idempotency_key_uq UNIQUE (idempotency_key),
      CONSTRAINT payment_intent_uq UNIQUE (stripe_payment_intent_id),
      CONSTRAINT payment_refund_uq UNIQUE (stripe_refund_id),
      CONSTRAINT payment_amount_ck CHECK (amount > 0),
      CONSTRAINT payment_currency_ck CHECK (currency = lower(currency)),
      CONSTRAINT payment_status_ck CHECK (
        status IN ('pending_retry', 'requires_payment', 'succeeded', 'failed', 'expired', 'refunded')
      ),
      CONSTRAINT payment_attempt_count_ck CHECK (attempt_count >= 0),
      CONSTRAINT payment_last_error_ck CHECK (last_error IS NULL OR char_length(last_error) <= 200),
      CONSTRAINT payment_refund_status_ck CHECK (refund_status IN ('none', 'pending', 'succeeded', 'failed')),
      CONSTRAINT payment_refund_reason_ck CHECK (
        refund_reason IS NULL
        OR refund_reason IN ('member_cancelled', 'class_cancelled', 'late_payment', 'manual')
      ),
      CONSTRAINT payment_refund_attempt_count_ck CHECK (refund_attempt_count >= 0),
      CONSTRAINT payment_intent_ck CHECK (
        status NOT IN ('requires_payment', 'succeeded', 'refunded') OR stripe_payment_intent_id IS NOT NULL
      ),
      CONSTRAINT payment_retry_ck CHECK (status <> 'pending_retry' OR next_retry_at IS NOT NULL),
      CONSTRAINT payment_refund_ck CHECK (refund_status = 'none' OR status IN ('succeeded', 'refunded'))
    )
  `.execute(db);

  await sql`
    CREATE INDEX payment_retry_due_idx ON payment (next_retry_at) WHERE status = 'pending_retry'
  `.execute(db);
  await sql`
    CREATE INDEX payment_refund_due_idx ON payment (refund_next_retry_at)
      WHERE refund_status = 'pending' AND refund_next_retry_at IS NOT NULL
  `.execute(db);
  await sql`
    CREATE INDEX payment_intent_cancel_idx ON payment (id)
      WHERE status IN ('expired', 'failed')
        AND stripe_payment_intent_id IS NOT NULL
        AND intent_cancelled_at IS NULL
  `.execute(db);

  await sql`
    CREATE TABLE stripe_event (
      event_id text PRIMARY KEY,
      type text NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
}

/**
 * Drops both tables. No data exists before FT-114; with data, reconcile refunds manually in Stripe first.
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE stripe_event`.execute(db);
  await sql`DROP TABLE payment`.execute(db);
}
