import { apiFetch } from './client';

export interface Booking {
  id: string;
  type: 'booking';
  memberId: string;
  classId: string;
  className: string;
  clubId: string;
  clubName: string;
  startAt: string;
  durationMinutes: number;
  classStatus: 'scheduled' | 'cancelled';
  status: 'pending_payment' | 'confirmed' | 'cancelled';
  attendance: 'unknown' | 'attended' | 'no_show';
  source: 'direct' | 'waitlist';
  bookedAt: string;
  cancelledAt: string | null;
  cancelDeadline: string;
  canCancel: boolean;
}

/** Books a place for the signed-in member. A `pending_payment` booking (HTTP 202) is a drop-in place held until payment. */
export function bookClass(classId: string): Promise<Booking> {
  return apiFetch<Booking>(`/api/classes/${encodeURIComponent(classId)}/bookings`, { method: 'POST' });
}
