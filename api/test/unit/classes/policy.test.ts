import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../../../src/modules/auth/types.js';
import { canCancelClass, canCancelNow } from '../../../src/modules/classes/policy.js';

const CLUB_A = 'a0000000-0000-4000-8000-000000000001';
const CLUB_B = 'b0000000-0000-4000-8000-000000000002';
const INSTRUCTOR = 'c0000000-0000-4000-8000-000000000003';
const OTHER_INSTRUCTOR = 'd0000000-0000-4000-8000-000000000004';

function user(role: string, clubId: string | null, id = 'e0000000-0000-4000-8000-000000000005'): AuthUser {
  return { id, role, clubId } as unknown as AuthUser;
}

const cls = { clubId: CLUB_A, instructorId: INSTRUCTOR };

describe('canCancelClass (AC 5, AC 7)', () => {
  it('lets a club manager cancel any class of their own club', () => {
    expect(canCancelClass(user('club_manager', CLUB_A), cls)).toBe('ok');
    expect(canCancelClass(user('club_manager', CLUB_A), { clubId: CLUB_A, instructorId: null })).toBe('ok');
  });

  it('lets an instructor cancel a class they lead', () => {
    expect(canCancelClass(user('instructor', CLUB_A, INSTRUCTOR), cls)).toBe('ok');
  });

  it('refuses an instructor of the same club who does not lead the class', () => {
    expect(canCancelClass(user('instructor', CLUB_A, OTHER_INSTRUCTOR), cls)).toBe('not_lead');
    expect(canCancelClass(user('instructor', CLUB_A, OTHER_INSTRUCTOR), { clubId: CLUB_A, instructorId: null })).toBe(
      'not_lead',
    );
  });

  it('refuses staff of another club, before looking at the lead', () => {
    expect(canCancelClass(user('club_manager', CLUB_B), cls)).toBe('other_club');
    expect(canCancelClass(user('instructor', CLUB_B, INSTRUCTOR), cls)).toBe('other_club');
    expect(canCancelClass(user('club_manager', null), cls)).toBe('other_club');
  });

  it('never lets a member cancel', () => {
    expect(canCancelClass(user('member', CLUB_A, INSTRUCTOR), cls)).toBe('not_lead');
    expect(canCancelClass(user('member', CLUB_B), cls)).toBe('other_club');
  });
});

describe('canCancelNow (schedule canCancel)', () => {
  const now = new Date('2026-10-30T09:00:00.000Z');
  const upcoming = { ...cls, status: 'scheduled' as const, startAt: new Date('2026-10-31T09:00:00.000Z') };
  const manager = user('club_manager', CLUB_A);

  it('is true for an allowed user and an upcoming scheduled class', () => {
    expect(canCancelNow(manager, upcoming, now)).toBe(true);
  });

  it('is false for members', () => {
    expect(canCancelNow(user('member', CLUB_A), upcoming, now)).toBe(false);
  });

  it('is false for a cancelled class', () => {
    expect(canCancelNow(manager, { ...upcoming, status: 'cancelled' }, now)).toBe(false);
  });

  it('is false when the class starts exactly now or has started', () => {
    expect(canCancelNow(manager, { ...upcoming, startAt: now }, now)).toBe(false);
    expect(canCancelNow(manager, { ...upcoming, startAt: new Date('2026-10-30T08:59:59.999Z') }, now)).toBe(false);
  });

  it('is false for staff outside the policy', () => {
    expect(canCancelNow(user('instructor', CLUB_A, OTHER_INSTRUCTOR), upcoming, now)).toBe(false);
    expect(canCancelNow(user('club_manager', CLUB_B), upcoming, now)).toBe(false);
  });
});
