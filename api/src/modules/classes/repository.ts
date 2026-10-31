import { sql, type Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { ScheduleRow } from './schedule.dto.js';

/** Started classes of one club whose attendance can still be recorded by instructors (US-129). */
export interface RecentlyStartedFilter {
  clubId: string;
  now: Date;
  editWindowHours: number;
}

export interface FindScheduleParams {
  clubId?: string;
  /** Exclusive lower bound of `start_at`. */
  from: Date;
  /** Inclusive upper bound of `start_at`. */
  to: Date;
  /** The viewing member; null for staff, so no booking is joined. */
  memberId: string | null;
  /** Staff only: also return started classes of their club until the attendance window closes. */
  recentlyStarted?: RecentlyStartedFilter;
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
    .where('gc.start_at', '<=', params.to);

  const recent = params.recentlyStarted;
  query =
    recent === undefined
      ? query.where('gc.start_at', '>', params.from)
      : query.where((eb) =>
          eb.or([
            eb('gc.start_at', '>', params.from),
            eb.and([
              eb('gc.club_id', '=', recent.clubId),
              eb('gc.start_at', '<=', recent.now),
              // Attendance window not closed yet: start + duration + edit window > now.
              sql<boolean>`gc.start_at + make_interval(mins => gc.duration_minutes) + make_interval(hours => ${recent.editWindowHours}::int) > ${recent.now}`,
            ]),
          ]),
        );

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
