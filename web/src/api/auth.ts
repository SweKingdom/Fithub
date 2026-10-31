import { apiFetch } from './client';

export type Role = 'member' | 'instructor' | 'club_manager';

/** The signed-in user, same shape as the API's `MeDto`. */
export interface Me {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  memberType: 'regular' | 'drop_in' | null;
  clubId: string | null;
  clubName: string | null;
}

export function login(email: string, password: string): Promise<Me> {
  return apiFetch<Me>('/api/auth/login', { method: 'POST', body: { email, password } });
}

export function logout(): Promise<void> {
  return apiFetch<void>('/api/auth/logout', { method: 'POST' });
}

export function getMe(): Promise<Me> {
  return apiFetch<Me>('/api/me');
}
