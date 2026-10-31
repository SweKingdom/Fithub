import { z } from 'zod';

const INVALID_DATE_TIME = 'Enter a valid date and time.';

export const scheduleQuerySchema = z
  .object({
    clubId: z.string().uuid('Choose a valid club.').optional(),
    from: z.string().datetime({ offset: true, message: INVALID_DATE_TIME }).optional(),
    to: z.string().datetime({ offset: true, message: INVALID_DATE_TIME }).optional(),
  })
  .superRefine((query, ctx) => {
    if (query.from !== undefined && query.to !== undefined && Date.parse(query.from) >= Date.parse(query.to)) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'The end of the period must be after its start.',
      });
    }
  });

export const scheduleItemSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  clubName: z.string(),
  clubTimezone: z.string(),
  name: z.string(),
  startAt: z.string(),
  durationMinutes: z.number().int(),
  capacity: z.number().int(),
  freePlaces: z.number().int().min(0),
  status: z.enum(['scheduled', 'cancelled']),
  instructorName: z.string().nullable(),
  myBookingStatus: z.enum(['none', 'confirmed', 'pending_payment', 'waiting']),
  myBooking: z
    .object({ id: z.string().uuid(), status: z.enum(['confirmed', 'pending_payment']) })
    .nullable(),
  myWaitlist: z.object({ entryId: z.string().uuid(), position: z.number().int() }).nullable(),
});

export const scheduleResponseSchema = z.object({
  from: z.string(),
  to: z.string(),
  items: z.array(scheduleItemSchema),
});

export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>;

/** One row of `findSchedule`. Only the viewer's own booking is ever joined in. */
export interface ScheduleRow {
  id: string;
  club_id: string;
  club_name: string;
  club_timezone: string;
  name: string;
  start_at: Date;
  duration_minutes: number;
  capacity: number;
  status: 'scheduled' | 'cancelled';
  instructor_name: string | null;
  active_count: number;
  my_booking_id: string | null;
  my_booking_status: 'confirmed' | 'pending_payment' | null;
}

/** Maps a row to the public item. Ids of instructors, creators and other members are never included. */
export function toScheduleItem(row: ScheduleRow): ScheduleItem {
  const myBooking: ScheduleItem['myBooking'] =
    row.my_booking_id !== null && row.my_booking_status !== null
      ? { id: row.my_booking_id, status: row.my_booking_status }
      : null;
  // Always null until US-127 fills it (lateral join on the viewer's `waiting` entry).
  const myWaitlist: ScheduleItem['myWaitlist'] = null as ScheduleItem['myWaitlist'];
  // An active booking has priority over a waiting-list entry.
  const myBookingStatus: ScheduleItem['myBookingStatus'] = myBooking
    ? myBooking.status
    : myWaitlist
      ? 'waiting'
      : 'none';
  return {
    id: row.id,
    clubId: row.club_id,
    clubName: row.club_name,
    clubTimezone: row.club_timezone,
    name: row.name,
    startAt: row.start_at.toISOString(),
    durationMinutes: row.duration_minutes,
    capacity: row.capacity,
    freePlaces: Math.max(row.capacity - row.active_count, 0),
    status: row.status,
    instructorName: row.instructor_name,
    myBookingStatus,
    myBooking,
    myWaitlist,
  };
}
