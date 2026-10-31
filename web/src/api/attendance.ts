import { apiFetch } from './client';

export type AttendanceValue = 'unknown' | 'attended' | 'no_show';

export interface AttendanceItem {
  bookingId: string;
  memberId: string;
  memberName: string;
  attendance: AttendanceValue;
  recordedAt: string | null;
  recordedByName: string | null;
}

export interface AttendanceRoster {
  classId: string;
  className: string;
  startAt: string;
  endsAt: string;
  clubTimezone: string;
  classStatus: 'scheduled' | 'cancelled';
  window: { opensAt: string; closesAt: string; state: 'not_open' | 'open' | 'closed' };
  canEdit: boolean;
  summary: { booked: number; attended: number; noShows: number; unknown: number };
  items: AttendanceItem[];
}

export interface AttendanceEntry {
  bookingId: string;
  attendance: 'attended' | 'no_show';
}

function attendancePath(classId: string): string {
  return `/api/classes/${encodeURIComponent(classId)}/attendance`;
}

export function getAttendance(classId: string): Promise<AttendanceRoster> {
  return apiFetch<AttendanceRoster>(attendancePath(classId));
}

export function saveAttendance(classId: string, entries: AttendanceEntry[]): Promise<AttendanceRoster> {
  return apiFetch<AttendanceRoster>(attendancePath(classId), { method: 'PUT', body: { entries } });
}
