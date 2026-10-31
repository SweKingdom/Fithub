import { apiFetch } from './client';

export type BookingPeriod = 'upcoming' | 'past';

export interface Booking {
  id: string;
  classId: string;
  className: string;
  clubName: string;
  clubTimezone: string;
  startAt: string;
  durationMinutes: number;
  status: 'confirmed' | 'pending_payment' | 'cancelled';
  attendance: 'unknown' | 'attended' | 'no_show';
  /** Last moment the booking can be cancelled (`startAt` minus the configured cut-off). */
  cancelDeadline: string;
  canCancel: boolean;
}

export interface MyBookingsResponse {
  items: Booking[];
  total: number;
}

/** One page of the signed-in member's bookings; `offset` is the number of items already loaded. */
export function getMyBookings(period: BookingPeriod, offset = 0): Promise<MyBookingsResponse> {
  const query = new URLSearchParams({ period, offset: String(offset) });
  return apiFetch<MyBookingsResponse>(`/api/me/bookings?${query.toString()}`);
}

/** Cancels the member's own booking. Throws `ApiError` with the server's message when it is refused. */
export function cancelBooking(id: string): Promise<Booking> {
  return apiFetch<Booking>(`/api/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}
