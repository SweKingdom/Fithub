import { describe, expect, it } from 'vitest';
import { toWaitlistEntryDto, type WaitlistEntryDtoRow } from '../../src/modules/waitlist/dto.js';

const row: WaitlistEntryDtoRow = {
  id: '11111111-1111-4111-8111-111111111111',
  class_id: '22222222-2222-4222-8222-222222222222',
  class_name: 'Spinning 45',
  club_id: '33333333-3333-4333-8333-333333333333',
  club_name: 'FitHub Central',
  start_at: new Date('2026-11-02T17:00:00Z'),
  duration_minutes: 45,
  class_status: 'scheduled',
  status: 'waiting',
  joined_at: new Date('2026-11-01T09:30:00Z'),
  promoted_booking_id: null,
};

describe('toWaitlistEntryDto (AC 1, AC 8)', () => {
  it('maps a waiting entry with its position and ISO UTC times', () => {
    expect(toWaitlistEntryDto(row, 3)).toEqual({
      id: row.id,
      type: 'waitlist',
      classId: row.class_id,
      className: 'Spinning 45',
      clubId: row.club_id,
      clubName: 'FitHub Central',
      startAt: '2026-11-02T17:00:00.000Z',
      durationMinutes: 45,
      classStatus: 'scheduled',
      status: 'waiting',
      position: 3,
      joinedAt: '2026-11-01T09:30:00.000Z',
      promotedBookingId: null,
    });
  });

  it.each(['promoted', 'removed', 'expired'] as const)('has no position when the entry is %s', (status) => {
    expect(toWaitlistEntryDto({ ...row, status }, 2).position).toBeNull();
  });

  it('never exposes the member or the queue length', () => {
    const keys = Object.keys(toWaitlistEntryDto(row, 1));
    expect(keys).not.toContain('memberId');
    expect(keys).not.toContain('queueLength');
    expect(keys).not.toContain('queueSeq');
  });
});
