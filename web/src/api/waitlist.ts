import { apiFetch } from './client';

/** Mirrors the API's `WaitlistEntryDto` (also used by US-123). */
export interface WaitlistEntry {
  id: string;
  type: 'waitlist';
  classId: string;
  className: string;
  clubId: string;
  clubName: string;
  startAt: string;
  durationMinutes: number;
  classStatus: 'scheduled' | 'cancelled';
  status: 'waiting' | 'promoted' | 'removed' | 'expired';
  position: number | null;
  joinedAt: string;
  promotedBookingId: string | null;
}

/** `POST /api/classes/:classId/waitlist` */
export function joinWaitlist(classId: string): Promise<WaitlistEntry> {
  return apiFetch<WaitlistEntry>(`/api/classes/${encodeURIComponent(classId)}/waitlist`, { method: 'POST' });
}

/** `DELETE /api/waitlist/:entryId` (204, no body) */
export async function leaveWaitlist(entryId: string): Promise<void> {
  await apiFetch<void>(`/api/waitlist/${encodeURIComponent(entryId)}`, { method: 'DELETE' });
}
