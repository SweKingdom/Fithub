import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { ScheduleRow } from './schedule.dto.js';

export interface FindScheduleParams {
  clubId?: string;
  /** Exclusive lower bound of `start_at`. */
  from: Date;
  /** Inclusive upper bound of `start_at`. */
  to: Date;
  /** The viewing member; null for staff, so no booking is joined. */
  memberId: string | null;
}

/**
 * Classes in the window with their active booking count and the viewer's own active booking,
 * in one read-only statement (no N+1, no locks). All values are bound parameters.
 */
export async function findSchedule(db: Kysely<Database>, params: FindScheduleParams): Promise<ScheduleRow[]> {
  const activeCounts = db
    .selectFrom('booking')
    .select(['class_id', sql<number>`count(*)::int`.as('active_count')])
    .where('status', 'in', ['confirmed', 'pending_payment'])
    .groupBy('class_id')
    .as('bc');

  let query = db
    .selectFrom('gym_class as gc')
    .innerJoin('club as c', 'c.id', 'gc.club_id')
    .leftJoin('app_user as i', 'i.id', 'gc.instructor_id')
    .leftJoin(activeCounts, 'bc.class_id', 'gc.id')
    .leftJoin('booking as mb', (join) =>
      join
        .onRef('mb.class_id', '=', 'gc.id')
        // `= NULL` matches nothing, so staff (memberId null) never get a booking joined in.
        .on(sql<boolean>`mb.member_id = ${params.memberId}::uuid`)
        .on('mb.status', 'in', ['confirmed', 'pending_payment']),
    )
    .select([
      'gc.id',
      'gc.club_id',
      'c.name as club_name',
      'c.timezone as club_timezone',
      'gc.name',
      'gc.start_at',
      'gc.duration_minutes',
      'gc.capacity',
      'gc.status',
      'i.full_name as instructor_name',
      sql<number>`COALESCE(bc.active_count, 0)`.as('active_count'),
      'mb.id as my_booking_id',
      'mb.status as my_booking_status',
    ])
    .where('gc.start_at', '>', params.from)
    .where('gc.start_at', '<=', params.to);

  if (params.clubId !== undefined) {
    query = query.where('gc.club_id', '=', params.clubId);
  }

  const rows = await query
    .orderBy('gc.start_at', 'asc')
    .orderBy('gc.name', 'asc')
    .orderBy('gc.id', 'asc')
    .execute();
  return rows as ScheduleRow[];
}
