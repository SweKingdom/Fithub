import { apiFetch } from './client';

export interface ScheduleItem {
  id: string;
  clubId: string;
  clubName: string;
  clubTimezone: string;
  name: string;
  startAt: string;
  durationMinutes: number;
  capacity: number;
  freePlaces: number;
  status: 'scheduled' | 'cancelled';
  instructorName: string | null;
  myBookingStatus: 'none' | 'confirmed' | 'pending_payment' | 'waiting';
  myBooking: { id: string; status: 'confirmed' | 'pending_payment' } | null;
  myWaitlist: { entryId: string; position: number } | null;
}

export interface ScheduleResponse {
  from: string;
  to: string;
  items: ScheduleItem[];
}

export interface ScheduleParams {
  clubId: string;
  from?: string;
  to?: string;
}

export function getSchedule({ clubId, from, to }: ScheduleParams): Promise<ScheduleResponse> {
  const query = new URLSearchParams({ clubId });
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  return apiFetch<ScheduleResponse>(`/api/classes?${query.toString()}`);
}
