import { describe, expect, it } from 'vitest';
import { toBookingDto, type BookingRow } from '../../src/modules/bookings/dto.js';

const MEMBER = '11111111-1111-4111-8111-111111111111';
const START = new Date('2026-11-02T17:00:00.000Z');
const CUTOFF = 120;

function row(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    class_id: '33333333-3333-4333-8333-333333333333',
    member_id: MEMBER,
    status: 'confirmed',
    attendance: 'unknown',
    source: 'direct',
    booked_at: new Date('2026-10-30T09:00:00.000Z'),
    cancelled_at: null,
    class_name: 'Spinning 45',
    club_id: '44444444-4444-4444-8444-444444444444',
    club_name: 'FitHub City',
    start_at: START,
    duration_minutes: 45,
    class_status: 'scheduled',
    ...overrides,
  };
}

const minutesBeforeStart = (minutes: number): Date => new Date(START.getTime() - minutes * 60_000);

describe('toBookingDto', () => {
  it('maps the row and computes the cancel deadline', () => {
    const dto = toBookingDto(row(), minutesBeforeStart(24 * 60), CUTOFF, { id: MEMBER });
    expect(dto).toMatchObject({
      type: 'booking',
      className: 'Spinning 45',
      clubName: 'FitHub City',
      startAt: '2026-11-02T17:00:00.000Z',
      classStatus: 'scheduled',
      cancelledAt: null,
      cancelDeadline: '2026-11-02T15:00:00.000Z',
      canCancel: true,
    });
  });

  it('canCancel is true exactly at the deadline and false one millisecond later', () => {
    const atDeadline = minutesBeforeStart(CUTOFF);
    expect(toBookingDto(row(), atDeadline, CUTOFF, { id: MEMBER }).canCancel).toBe(true);
    expect(toBookingDto(row(), new Date(atDeadline.getTime() + 1), CUTOFF, { id: MEMBER }).canCancel).toBe(false);
  });

  it('canCancel is false for another viewer, a cancelled booking and a cancelled class', () => {
    const now = minutesBeforeStart(24 * 60);
    expect(toBookingDto(row(), now, CUTOFF, { id: 'someone-else' }).canCancel).toBe(false);
    const cancelled = row({ status: 'cancelled', cancelled_at: now });
    expect(toBookingDto(cancelled, now, CUTOFF, { id: MEMBER }).canCancel).toBe(false);
    expect(toBookingDto(row({ class_status: 'cancelled' }), now, CUTOFF, { id: MEMBER }).canCancel).toBe(false);
  });

  it('canCancel is true for a pending_payment booking', () => {
    const now = minutesBeforeStart(24 * 60);
    expect(toBookingDto(row({ status: 'pending_payment' }), now, CUTOFF, { id: MEMBER }).canCancel).toBe(true);
  });
});
