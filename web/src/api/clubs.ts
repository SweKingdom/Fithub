import { apiFetch } from './client';

export interface Club {
  id: string;
  name: string;
  timezone: string;
}

/** Clubs sorted by name (the API already sorts them). */
export function listClubs(): Promise<Club[]> {
  return apiFetch<Club[]>('/api/clubs');
}

export interface Instructor {
  id: string;
  fullName: string;
}

/** `GET /api/clubs/:clubId/instructors` (staff of that club only). */
export function getInstructors(clubId: string): Promise<Instructor[]> {
  return apiFetch<Instructor[]>(`/api/clubs/${encodeURIComponent(clubId)}/instructors`);
}
