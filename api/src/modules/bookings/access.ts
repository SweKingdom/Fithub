import { forbidden } from '../../shared/errors.js';
import type { AuthUser } from '../auth/types.js';

export const STAFF_ONLY_MESSAGE = 'Only instructors and club managers can manage classes.';
export const OWN_CLUB_ONLY_MESSAGE = 'You can only manage classes for your own club.';

/**
 * Club scope for class management (ADR-011): only an instructor or club manager whose club is the
 * class's club passes. Any instructor of the club, not only the assigned one, so substitutes can act.
 */
export function assertStaffOfClass(user: AuthUser, gymClass: { club_id: string }): void {
  if (user.role === 'member') throw forbidden(STAFF_ONLY_MESSAGE);
  if (user.clubId !== gymClass.club_id) throw forbidden(OWN_CLUB_ONLY_MESSAGE);
}
