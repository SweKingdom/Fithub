import { randomUUID } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { BookingTable, Database } from '../../src/db/schema.js';
import type { AppUserTable } from '../../src/modules/auth/db-types.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import type { MemberType, Role } from '../../src/modules/auth/types.js';

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
  fields: { classId: string; memberId: string; status: BookingTable['status'] },
) {
  return db
    .insertInto('booking')
    .values({ class_id: fields.classId, member_id: fields.memberId, status: fields.status })
    .returningAll()
    .executeTakeFirstOrThrow();
}
