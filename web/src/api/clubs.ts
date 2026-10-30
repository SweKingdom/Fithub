import { apiFetch } from './client';

export interface Instructor {
  id: string;
  fullName: string;
}

/** `GET /api/clubs/:clubId/instructors` (staff of that club only). Added by US-120. */
export function getInstructors(clubId: string): Promise<Instructor[]> {
  return apiFetch<Instructor[]>(`/api/clubs/${encodeURIComponent(clubId)}/instructors`);
}
