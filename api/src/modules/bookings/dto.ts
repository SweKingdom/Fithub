import { z } from 'zod';
import type { BookingAttendance, BookingSource, BookingStatus } from './db-types.js';

/** Used until US-124 adds `BOOKING_CANCEL_CUTOFF_MINUTES` to the configuration. */
export const DEFAULT_CANCEL_CUTOFF_MINUTES = 120;

export const bookingDtoSchema = z.object({
  id: z.string().uuid(),
  type: z.literal('booking'),
  memberId: z.string().uuid(),
  classId: z.string().uuid(),
  className: z.string(),
  clubId: z.string().uuid(),
  clubName: z.string(),
  startAt: z.string(),
  durationMinutes: z.number().int(),
  classStatus: z.enum(['scheduled', 'cancelled']),
  status: z.enum(['pending_payment', 'confirmed', 'cancelled']),
  attendance: z.enum(['unknown', 'attended', 'no_show']),
  source: z.enum(['direct', 'waitlist']),
  bookedAt: z.string(),
  cancelledAt: z.string().nullable(),
  cancelDeadline: z.string(),
  canCancel: z.boolean(),
});

export type BookingDto = z.infer<typeof bookingDtoSchema>;

/** A booking joined with its class and club (`findBookingRowById`). */
export interface BookingRow {
  id: string;
  class_id: string;
  member_id: string;
  status: BookingStatus;
  attendance: BookingAttendance;
  source: BookingSource;
  booked_at: Date;
  cancelled_at: Date | null;
  class_name: string;
  club_id: string;
  club_name: string;
  start_at: Date;
  duration_minutes: number;
  class_status: 'scheduled' | 'cancelled';
}

/** Maps a row to the public booking. `canCancel` is true only for the owner, before the cancel deadline. */
export function toBookingDto(
  row: BookingRow,
  now: Date,
  cutoffMinutes: number,
  viewer: { id: string },
): BookingDto {
  const deadline = new Date(row.start_at.getTime() - cutoffMinutes * 60_000);
  const active = row.status === 'pending_payment' || row.status === 'confirmed';
  return {
    id: row.id,
    type: 'booking',
    memberId: row.member_id,
    classId: row.class_id,
    className: row.class_name,
    clubId: row.club_id,
    clubName: row.club_name,
    startAt: row.start_at.toISOString(),
    durationMinutes: row.duration_minutes,
    classStatus: row.class_status,
    status: row.status,
    attendance: row.attendance,
    source: row.source,
    bookedAt: row.booked_at.toISOString(),
    cancelledAt: row.cancelled_at === null ? null : row.cancelled_at.toISOString(),
    cancelDeadline: deadline.toISOString(),
    canCancel:
      viewer.id === row.member_id &&
      active &&
      row.class_status === 'scheduled' &&
      now.getTime() <= deadline.getTime(),
  };
}
