import { describe, expect, it } from 'vitest';
import { refundReasonFor, usesCredits } from '../../../src/modules/credits/policy.js';
import type { BookingCancelled } from '../../../src/modules/credits/events.js';

describe('usesCredits', () => {
  it('is true for a regular member', () => {
    expect(usesCredits({ role: 'member', memberType: 'regular' })).toBe(true);
  });

  it('is false for a drop-in member', () => {
    expect(usesCredits({ role: 'member', memberType: 'drop_in' })).toBe(false);
  });

  it('is false for staff, whatever the member type', () => {
    expect(usesCredits({ role: 'staff', memberType: null })).toBe(false);
    expect(usesCredits({ role: 'staff', memberType: 'regular' })).toBe(false);
  });
});

describe('refundReasonFor', () => {
  it('maps a member cancellation to cancellation_refund', () => {
    expect(refundReasonFor('member_cancelled')).toBe('cancellation_refund');
  });

  it('maps a class cancellation to class_cancelled_refund', () => {
    expect(refundReasonFor('class_cancelled')).toBe('class_cancelled_refund');
  });

  it('refuses a cause that is not mapped', () => {
    expect(() => refundReasonFor('payment_failed' as BookingCancelled['cause'])).toThrow(/Unmapped cancellation cause/);
  });
});
