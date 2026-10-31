import type { Role } from '../auth/types.js';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export type AttendanceWindowState = 'not_open' | 'open' | 'closed';

export interface AttendanceWindow {
  /** The class start. */
  opensAt: Date;
  /** The class end plus the edit window; from this instant on the window is closed. */
  closesAt: Date;
  state: AttendanceWindowState;
}

/** Pure. `closesAt` itself already counts as closed. */
export function attendanceWindow(
  gymClass: { start_at: Date; duration_minutes: number },
  now: Date,
  editWindowHours: number,
): AttendanceWindow {
  const opensAt = gymClass.start_at.getTime();
  const closesAt = opensAt + gymClass.duration_minutes * MINUTE_MS + editWindowHours * HOUR_MS;
  const current = now.getTime();
  const state: AttendanceWindowState = current < opensAt ? 'not_open' : current < closesAt ? 'open' : 'closed';
  return { opensAt: new Date(opensAt), closesAt: new Date(closesAt), state };
}

/**
 * Whether the user may change attendance in this window (club scope is checked separately).
 * Inside the window staff may; after it only the club manager may correct.
 */
export function canEditAttendance(user: { role: Role }, window: Pick<AttendanceWindow, 'state'>): boolean {
  if (window.state === 'open') return user.role === 'instructor' || user.role === 'club_manager';
  if (window.state === 'closed') return user.role === 'club_manager';
  return false;
}
