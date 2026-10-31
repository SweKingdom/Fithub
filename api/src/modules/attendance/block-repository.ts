import type { Insertable, Kysely } from 'kysely';
import type { BookingBlockReason, BookingBlockTable, Database } from '../../db/schema.js';
import type { NoShowWindow } from './no-show-window.js';

export interface BlockRow {
  id: string;
  reason: BookingBlockReason;
  starts_at: Date;
  ends_at: Date;
  no_show_count: number | null;
}

const BLOCK_COLUMNS = ['id', 'reason', 'starts_at', 'ends_at', 'no_show_count'] as const;

/**
 * Takes the member's `app_user` row lock (`SELECT … FOR UPDATE`). Block decisions for one member run one
 * transaction at a time. Lock order: `gym_class` → `booking` → `app_user` (ADR-010).
 */
export async function lockMember(trx: Kysely<Database>, memberId: string): Promise<void> {
  await trx.selectFrom('app_user').select('id').where('id', '=', memberId).forUpdate().executeTakeFirst();
}

/** The member's block that is active at `now` (`starts_at <= now < ends_at`); the one that ends last if several. */
export async function findActiveBlock(
  db: Kysely<Database>,
  memberId: string,
  now: Date,
): Promise<BlockRow | undefined> {
  return db
    .selectFrom('booking_block')
    .select(BLOCK_COLUMNS)
    .where('member_id', '=', memberId)
    .where('starts_at', '<=', now)
    .where('ends_at', '>', now)
    .orderBy('ends_at', 'desc')
    .limit(1)
    .executeTakeFirst();
}

export async function findBlockById(trx: Kysely<Database>, blockId: string): Promise<BlockRow | undefined> {
  return trx.selectFrom('booking_block').select(BLOCK_COLUMNS).where('id', '=', blockId).executeTakeFirst();
}

/** Ids of the member's confirmed no-shows inside the window that no block has counted yet. */
export async function listUncountedNoShows(
  trx: Kysely<Database>,
  memberId: string,
  window: NoShowWindow,
): Promise<string[]> {
  const rows = await trx
    .selectFrom('booking as b')
    .innerJoin('gym_class as c', 'c.id', 'b.class_id')
    .select('b.id')
    .where('b.member_id', '=', memberId)
    .where('b.status', '=', 'confirmed')
    .where('b.attendance', '=', 'no_show')
    .where('b.no_show_block_id', 'is', null)
    .where('c.start_at', window.inclusive ? '>=' : '>', window.from)
    .execute();
  return rows.map((row) => row.id);
}

export async function insertBlock(
  trx: Kysely<Database>,
  row: Insertable<BookingBlockTable>,
): Promise<{ id: string }> {
  return trx.insertInto('booking_block').values(row).returning('id').executeTakeFirstOrThrow();
}

export async function linkBookings(trx: Kysely<Database>, blockId: string, bookingIds: string[]): Promise<void> {
  if (bookingIds.length === 0) return;
  await trx.updateTable('booking').set({ no_show_block_id: blockId }).where('id', 'in', bookingIds).execute();
}

/** Clears the booking's block link. Returns the block it was linked to, or null when it was not linked. */
export async function unlinkBooking(trx: Kysely<Database>, bookingId: string): Promise<string | null> {
  const row = await trx
    .selectFrom('booking')
    .select('no_show_block_id')
    .where('id', '=', bookingId)
    .executeTakeFirst();
  const blockId = row?.no_show_block_id ?? null;
  if (blockId !== null) {
    await trx.updateTable('booking').set({ no_show_block_id: null }).where('id', '=', bookingId).execute();
  }
  return blockId;
}

/** Number of bookings still linked to the block. */
export async function countLinked(trx: Kysely<Database>, blockId: string): Promise<number> {
  const row = await trx
    .selectFrom('booking')
    .select((eb) => eb.fn.countAll<string>().as('total'))
    .where('no_show_block_id', '=', blockId)
    .executeTakeFirstOrThrow();
  return Number(row.total);
}

/** Ends the block now. */
export async function liftBlock(trx: Kysely<Database>, blockId: string, now: Date): Promise<void> {
  await trx.updateTable('booking_block').set({ ends_at: now, lifted_at: now }).where('id', '=', blockId).execute();
}

/** IANA time zone of the member's home club; null when the member has no club. */
export async function findHomeClubTimezone(db: Kysely<Database>, memberId: string): Promise<string | null> {
  const row = await db
    .selectFrom('app_user as u')
    .innerJoin('club as c', 'c.id', 'u.club_id')
    .select('c.timezone')
    .where('u.id', '=', memberId)
    .executeTakeFirst();
  return row?.timezone ?? null;
}
