/** Joined row read by `findClassDtoRow` (instructor name from `app_user.full_name`). */
export interface ClassDtoRow {
  id: string;
  club_id: string;
  name: string;
  start_at: Date;
  duration_minutes: number;
  capacity: number;
  status: 'scheduled' | 'cancelled';
  instructor_id: string | null;
  instructor_name: string | null;
  created_by: string;
  created_at: Date;
}

/** Staff-facing class representation (reused by US-126). */
export interface ClassDto {
  id: string;
  clubId: string;
  name: string;
  startAt: string;
  durationMinutes: number;
  capacity: number;
  freePlaces: number;
  status: 'scheduled' | 'cancelled';
  instructorId: string | null;
  instructorName: string | null;
  createdBy: string;
  createdAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

/** `freePlaces` = max(capacity − active bookings, 0) (ADR-010). US-126 fills the cancellation fields. */
export function toClassDto(row: ClassDtoRow, activeBookingCount: number): ClassDto {
  return {
    id: row.id,
    clubId: row.club_id,
    name: row.name,
    startAt: row.start_at.toISOString(),
    durationMinutes: row.duration_minutes,
    capacity: row.capacity,
    freePlaces: Math.max(row.capacity - activeBookingCount, 0),
    status: row.status,
    instructorId: row.instructor_id,
    instructorName: row.instructor_name,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    cancelledAt: null,
    cancellationReason: null,
  };
}
