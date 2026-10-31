import { describe, expect, it, vi } from 'vitest';
import { notifyClassCancelled, type ClassCancellationResult } from '../../../src/modules/classes/notify.js';

const result: ClassCancellationResult = {
  classId: 'class-1',
  cancelledBy: 'manager-1',
  bookings: [
    { bookingId: 'booking-1', memberId: 'member-1' },
    { bookingId: 'booking-2', memberId: 'member-2' },
  ],
  waitlistEntries: [{ waitlistEntryId: 'entry-1', memberId: 'member-3' }],
};

describe('notifyClassCancelled (AC 4)', () => {
  it('notifies once per booking and once per removed waiting-list entry', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const error = vi.fn();
    await notifyClassCancelled(result, { notify }, { error });

    expect(notify.mock.calls.map(([event]) => event)).toEqual([
      { type: 'class_cancelled', memberId: 'member-1', classId: 'class-1', bookingId: 'booking-1', waitlistEntryId: null },
      { type: 'class_cancelled', memberId: 'member-2', classId: 'class-1', bookingId: 'booking-2', waitlistEntryId: null },
      { type: 'class_cancelled', memberId: 'member-3', classId: 'class-1', bookingId: null, waitlistEntryId: 'entry-1' },
    ]);
    expect(error).not.toHaveBeenCalled();
  });

  it('logs a failing notification with ids only and still notifies the others', async () => {
    const notify = vi
      .fn()
      .mockRejectedValueOnce(new Error('channel down'))
      .mockResolvedValue(undefined);
    const error = vi.fn();
    await expect(notifyClassCancelled(result, { notify }, { error })).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledTimes(1);
    const [fields] = error.mock.calls[0] as [Record<string, unknown>];
    expect(fields).toMatchObject({ classId: 'class-1', bookingId: 'booking-1', waitlistEntryId: null });
    expect(fields).not.toHaveProperty('memberId');
  });

  it('does nothing when nobody is affected', async () => {
    const notify = vi.fn();
    await notifyClassCancelled({ ...result, bookings: [], waitlistEntries: [] }, { notify }, { error: vi.fn() });
    expect(notify).not.toHaveBeenCalled();
  });
});
