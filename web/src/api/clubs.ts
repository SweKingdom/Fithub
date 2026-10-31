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
