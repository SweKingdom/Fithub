import type { ColumnType, Generated } from 'kysely';

export type BookingStatus = 'pending_payment' | 'confirmed' | 'cancelled';
export type BookingAttendance = 'unknown' | 'attended' | 'no_show';
export type BookingSource = 'direct' | 'waitlist';

/** `booking` (US-122). */
export interface BookingTable {
  id: Generated<string>;
  class_id: string;
  member_id: string;
  status: BookingStatus;
  attendance: Generated<BookingAttendance>;
  source: Generated<BookingSource>;
  booked_at: Date;
  cancelled_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

/** The columns of `gym_class` that booking reads. */
export interface BookingGymClassTable {
  id: string;
  club_id: string;
  name: string;
  start_at: Date;
  duration_minutes: number;
  capacity: number;
  status: 'scheduled' | 'cancelled';
}

export interface BookingClubTable {
  id: string;
  name: string;
}

/** The tables the bookings module touches. Merge `BookingTable` into `db/schema.ts` (`booking: BookingTable`). */
export interface BookingDatabase {
  booking: BookingTable;
  gym_class: BookingGymClassTable;
  club: BookingClubTable;
}
