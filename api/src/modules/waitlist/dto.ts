import type { WaitlistStatus } from './table.js';

/** Entry joined with its class and club (see `findEntryDtoRow`). */
export interface WaitlistEntryDtoRow {
  id: string;
  class_id: string;
  class_name: string;
  club_id: string;
  club_name: string;
  start_at: Date;
  duration_minutes: number;
  class_status: 'scheduled' | 'cancelled';
  status: WaitlistStatus;
  joined_at: Date;
  promoted_booking_id: string | null;
}

/** Shared with US-123. No `memberId`, no queue length. */
export interface WaitlistEntryDto {
  id: string;
  type: 'waitlist';
  classId: string;
  className: string;
  clubId: string;
  clubName: string;
  startAt: string;
  durationMinutes: number;
  classStatus: 'scheduled' | 'cancelled';
  status: WaitlistStatus;
  /** 1-based; `null` unless `status` is `waiting`. */
  position: number | null;
  joinedAt: string;
  promotedBookingId: string | null;
}

export function toWaitlistEntryDto(row: WaitlistEntryDtoRow, position: number | null): WaitlistEntryDto {
  return {
    id: row.id,
    type: 'waitlist',
    classId: row.class_id,
    className: row.class_name,
    clubId: row.club_id,
    clubName: row.club_name,
    startAt: row.start_at.toISOString(),
    durationMinutes: row.duration_minutes,
    classStatus: row.class_status,
    status: row.status,
    position: row.status === 'waiting' ? position : null,
    joinedAt: row.joined_at.toISOString(),
    promotedBookingId: row.promoted_booking_id,
  };
}
