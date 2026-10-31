import type { AuthUser } from '../auth/types.js';

export type CancelDecision = 'ok' | 'other_club' | 'not_lead';

export interface CancellableClass {
  clubId: string;
  instructorId: string | null;
}

/**
 * Who may cancel a class (US-126, assumption pending PO confirmation): a club manager of the class's own
 * club, or the instructor who leads it. One pure function so the rule can be widened in one place.
 * The route's role guard runs first; any other role is denied here as well (`not_lead`).
 */
export function canCancelClass(user: AuthUser, cls: CancellableClass): CancelDecision {
  if (user.clubId !== cls.clubId) return 'other_club';
  if (user.role === 'club_manager') return 'ok';
  if (user.role === 'instructor' && cls.instructorId === user.id) return 'ok';
  return 'not_lead';
}

export interface ScheduledClassView extends CancellableClass {
  status: 'scheduled' | 'cancelled';
  startAt: Date;
}

/** Whether the schedule offers "Cancel class" to this user: still scheduled, not started, and allowed. */
export function canCancelNow(user: AuthUser, cls: ScheduledClassView, now: Date): boolean {
  return cls.status === 'scheduled' && cls.startAt.getTime() > now.getTime() && canCancelClass(user, cls) === 'ok';
}
