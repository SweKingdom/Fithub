import { apiFetch } from './client';

export interface CreateClassPayload {
  clubId: string;
  name: string;
  startAt: string;
  durationMinutes: number;
  capacity: number;
  instructorId?: string | null;
}

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

/** `POST /api/classes`. Rejects with `ApiError` (carries `fieldErrors` on 400). */
export function createClass(payload: CreateClassPayload): Promise<ClassDto> {
  return apiFetch<ClassDto>('/api/classes', { method: 'POST', body: JSON.stringify(payload) });
}
