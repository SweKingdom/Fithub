import { sql, type Kysely } from 'kysely';

/**
 * US-127: waiting list. Provisional number 0005 (after 0004 `booking`, US-122): renumber if the
 * migrations folder differs at merge time. Must run after `gym_class`, `app_user` and `booking`.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE waitlist_entry (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      class_id uuid NOT NULL REFERENCES gym_class (id) ON DELETE RESTRICT,
      member_id uuid NOT NULL REFERENCES app_user (id) ON DELETE RESTRICT,
      queue_seq bigint GENERATED ALWAYS AS IDENTITY,
      status text NOT NULL DEFAULT 'waiting',
      joined_at timestamptz NOT NULL,
      ended_at timestamptz,
      promoted_booking_id uuid REFERENCES booking (id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT waitlist_entry_queue_seq_uq UNIQUE (queue_seq),
      CONSTRAINT waitlist_entry_status_ck CHECK (status IN ('waiting', 'promoted', 'removed', 'expired')),
      CONSTRAINT waitlist_entry_ended_ck CHECK ((status = 'waiting') = (ended_at IS NULL)),
      CONSTRAINT waitlist_entry_promoted_ck CHECK (promoted_booking_id IS NULL OR status = 'promoted')
    )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX waitlist_entry_waiting_class_member_uq
      ON waitlist_entry (class_id, member_id) WHERE status = 'waiting'
  `.execute(db);
  await sql`
    CREATE INDEX waitlist_entry_class_status_seq_idx ON waitlist_entry (class_id, status, queue_seq)
  `.execute(db);
  await sql`
    CREATE INDEX waitlist_entry_member_status_idx ON waitlist_entry (member_id, status)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE waitlist_entry`.execute(db);
}
