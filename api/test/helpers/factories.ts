import { randomUUID } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { BookingTable, Database } from '../../src/db/schema.js';
import type { AppUserTable } from '../../src/modules/auth/db-types.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import type { MemberType, Role } from '../../src/modules/auth/types.js';
import type { PaymentStatus } from '../../src/modules/payments/tables.js';
import type { WaitlistEntryStatus } from '../../src/modules/waitlist/table.js';

const TEST_SCRYPT_COST = 16384;

export async function createClub(
  db: Kysely<Database>,
  fields: { name: string; timezone: string; code?: string },
) {
  return db
    .insertInto('club')
    .values({
      code: fields.code ?? `T-${randomUUID().slice(0, 8).toUpperCase()}`,
      name: fields.name,
      timezone: fields.timezone,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface CreateUserFields {
  role: Role;
  /** Defaults to `regular` for a member; staff never get one. */
  memberType?: MemberType;
  clubId?: string;
  email?: string;
  fullName?: string;
  /** Hashed (cost 16384) only when given; without it the user cannot sign in. */
  password?: string;
}

export async function createUser(db: Kysely<Database>, fields: CreateUserFields): Promise<Selectable<AppUserTable>> {
  return db
    .insertInto('app_user')
    .values({
      email: fields.email ?? `user-${randomUUID()}@example.com`,
      full_name: fields.fullName ?? 'Test User',
      role: fields.role,
      member_type: fields.role === 'member' ? (fields.memberType ?? 'regular') : null,
      club_id: fields.clubId ?? null,
      password_hash: fields.password === undefined ? null : await hashPassword(fields.password, TEST_SCRYPT_COST),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface CreateClassFields {
  clubId: string;
  startAt: Date;
  name?: string;
  capacity?: number;
  durationMinutes?: number;
  status?: 'scheduled' | 'cancelled';
  instructorId?: string;
}

export async function createClass(db: Kysely<Database>, fields: CreateClassFields) {
  return db
    .insertInto('gym_class')
    .values({
      club_id: fields.clubId,
      start_at: fields.startAt,
      name: fields.name ?? 'Spinning',
      capacity: fields.capacity ?? 20,
      duration_minutes: fields.durationMinutes ?? 45,
      status: fields.status ?? 'scheduled',
      instructor_id: fields.instructorId ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function createBooking(
  db: Kysely<Database>,
  fields: { classId: string; memberId: string; status: BookingTable['status']; bookedAt?: Date },
) {
  return db
    .insertInto('booking')
    .values({
      class_id: fields.classId,
      member_id: fields.memberId,
      status: fields.status,
      booked_at: fields.bookedAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface CreatePaymentFields {
  bookingId: string;
  /** Defaults to `requires_payment`. */
  status?: PaymentStatus;
  /** Defaults to a made-up id for the states that need one, `null` otherwise. */
  intentId?: string | null;
  amount?: number;
}

/** A `payment` row as the booking transaction and `startPayment` would leave it in the given state. */
export async function createPayment(db: Kysely<Database>, fields: CreatePaymentFields) {
  const status = fields.status ?? 'requires_payment';
  const needsIntent = status === 'requires_payment' || status === 'succeeded' || status === 'refunded';
  return db
    .insertInto('payment')
    .values({
      booking_id: fields.bookingId,
      idempotency_key: `booking-${fields.bookingId}`,
      stripe_payment_intent_id: fields.intentId === undefined ? (needsIntent ? `pi_${randomUUID()}` : null) : fields.intentId,
      amount: fields.amount ?? 1500,
      currency: 'eur',
      status,
      next_retry_at: status === 'pending_retry' ? new Date() : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Entries are queued in the order they are created (`queue_seq`). A non-`waiting` entry gets `ended_at` = `joinedAt`. */
export async function createWaitlistEntry(
  db: Kysely<Database>,
  fields: { classId: string; memberId: string; status?: WaitlistEntryStatus; joinedAt?: Date },
) {
  const status = fields.status ?? 'waiting';
  const joinedAt = fields.joinedAt ?? new Date();
  return db
    .insertInto('waitlist_entry')
    .values({
      class_id: fields.classId,
      member_id: fields.memberId,
      status,
      joined_at: joinedAt,
      ended_at: status === 'waiting' ? null : joinedAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
