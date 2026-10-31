import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { AuthDatabase } from './db-types.js';
import { hashPassword } from './password.js';
import { findClubByCode, findUserByEmail, insertUser, updatePasswordHash } from './repository.js';
import { deleteSessionsOfUser } from './session.js';
import type { MemberType, Role } from './types.js';

type Db = Kysely<AuthDatabase>;

export const MIN_PASSWORD_LENGTH = 12;
const PASSWORD_TOO_SHORT = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
const POSTGRES_UNIQUE_VIOLATION = '23505';

/** An operator mistake. The message is one plain line for the command line. */
export class UserAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserAdminError';
  }
}

export interface CreateUserInput {
  email: string;
  fullName: string;
  role: string;
  clubCode?: string;
  memberType?: string;
  password: string;
}

const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH, PASSWORD_TOO_SHORT).max(200, 'Password is too long.');

const createUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Email is not a valid address.').max(254, 'Email is too long.'),
    fullName: z.string().trim().min(1, 'Name is required.').max(200, 'Name is too long.'),
    role: z.enum(['member', 'instructor', 'club_manager']),
    clubCode: z.string().trim().min(1).max(64).optional(),
    memberType: z.enum(['regular', 'drop_in']).optional(),
    password: passwordSchema,
  })
  .superRefine((input, ctx) => {
    const staff = input.role !== 'member';
    if (staff && input.clubCode === undefined) {
      ctx.addIssue({ code: 'custom', path: ['clubCode'], message: 'Instructors and club managers need --club.' });
    }
    if (staff && input.memberType !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['memberType'], message: 'Staff accounts have no member type.' });
    }
    if (!staff && input.memberType === undefined) {
      ctx.addIssue({ code: 'custom', path: ['memberType'], message: 'Members need --member-type (regular or drop_in).' });
    }
  });

function firstProblem(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'The input is not valid.';
}

/** Creates an account. Throws `UserAdminError` and writes nothing for any invalid input. */
export async function createUser(
  db: Db,
  input: CreateUserInput,
  cost: number,
  now: Date = new Date(),
): Promise<{ id: string; email: string; role: Role; memberType: MemberType | null }> {
  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) throw new UserAdminError(firstProblem(parsed.error));
  const data = parsed.data;

  if (await findUserByEmail(db, data.email)) {
    throw new UserAdminError(`A user with email ${data.email} already exists.`);
  }

  let clubId: string | null = null;
  if (data.clubCode !== undefined) {
    const code = data.clubCode.toUpperCase();
    const club = await findClubByCode(db, code);
    if (!club) throw new UserAdminError(`Club ${code} does not exist.`);
    clubId = club.id;
  }

  const passwordHash = await hashPassword(data.password, cost);
  try {
    const id = await insertUser(db, {
      email: data.email,
      full_name: data.fullName,
      role: data.role,
      member_type: data.memberType ?? null,
      club_id: clubId,
      password_hash: passwordHash,
      legacy_member_id: null,
      updated_at: now,
    });
    return { id, email: data.email, role: data.role, memberType: data.memberType ?? null };
  } catch (error) {
    // Two operators creating the same account at once: the unique index on lower(email) wins.
    if ((error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) {
      throw new UserAdminError(`A user with email ${data.email} already exists.`);
    }
    throw error;
  }
}

/** Sets a new password and ends every session of the user. */
export async function setPassword(
  db: Db,
  email: string,
  password: string,
  cost: number,
  now: Date = new Date(),
): Promise<{ email: string; sessionsEnded: number }> {
  const parsedPassword = passwordSchema.safeParse(password);
  if (!parsedPassword.success) throw new UserAdminError(firstProblem(parsedPassword.error));

  const normalizedEmail = email.trim().toLowerCase();
  const user = await findUserByEmail(db, normalizedEmail);
  if (!user) throw new UserAdminError(`No user with email ${normalizedEmail} exists.`);

  const passwordHash = await hashPassword(parsedPassword.data, cost);
  const sessionsEnded = await db.transaction().execute(async (trx) => {
    await updatePasswordHash(trx, user.id, passwordHash, now);
    return deleteSessionsOfUser(trx, user.id);
  });
  return { email: user.email, sessionsEnded };
}
