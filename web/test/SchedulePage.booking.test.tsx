import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleItem } from '../src/api/classes';
import { SchedulePage } from '../src/pages/SchedulePage';

const mocks = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    listClubs: vi.fn(),
    getSchedule: vi.fn(),
    bookClass: vi.fn(),
    FakeApiError,
    me: { clubId: null as string | null, role: 'member' },
    onUnauthenticated: vi.fn(),
  };
});

vi.mock('../src/api/clubs', () => ({ listClubs: mocks.listClubs }));
vi.mock('../src/api/classes', () => ({ getSchedule: mocks.getSchedule }));
vi.mock('../src/api/bookings', () => ({ bookClass: mocks.bookClass }));
vi.mock('../src/api/client', () => ({ ApiError: mocks.FakeApiError }));
vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ me: mocks.me, onUnauthenticated: mocks.onUnauthenticated }),
}));

const CLUB = { id: 'a0000000-0000-4000-8000-000000000001', name: 'Alpha', timezone: 'Europe/Stockholm' };

function item(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    clubId: CLUB.id,
    clubName: 'Alpha',
    clubTimezone: 'Europe/Stockholm',
    name: 'Spinning 45',
    startAt: '2099-11-02T17:00:00.000Z',
    durationMinutes: 45,
    capacity: 20,
    freePlaces: 5,
    status: 'scheduled',
    instructorName: null,
    myBookingStatus: 'none',
    myBooking: null,
    myWaitlist: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/schedule']}>
      <SchedulePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.me.clubId = null;
  mocks.me.role = 'member';
  mocks.listClubs.mockResolvedValue([CLUB]);
});

describe('SchedulePage booking (US-122)', () => {
  it('AC 9: a member sees "Book"; staff see no booking button', async () => {
    mocks.getSchedule.mockResolvedValue({ from: '', to: '', items: [item()] });
    const { unmount } = renderPage();
    expect(await screen.findByRole('button', { name: 'Book' })).toBeTruthy();
    unmount();

    mocks.me.role = 'instructor';
    renderPage();
    await screen.findByText('Spinning 45');
    expect(screen.queryByRole('button', { name: 'Book' })).toBeNull();
  });

  it('AC 9: after a booking the toast is shown and the card shows "Booked"', async () => {
    mocks.getSchedule
      .mockResolvedValueOnce({ from: '', to: '', items: [item()] })
      .mockResolvedValue({
        from: '',
        to: '',
        items: [item({ freePlaces: 4, myBookingStatus: 'confirmed', myBooking: { id: 'b', status: 'confirmed' } })],
      });
    mocks.bookClass.mockResolvedValue({ status: 'confirmed' });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Book' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));

    expect((await screen.findByRole('status')).textContent).toBe(
      "You're booked for Spinning 45 on Tuesday 3 November.",
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Booked' })).toBeTruthy());
    expect(mocks.getSchedule).toHaveBeenCalledTimes(2);
  });

  it('AC 9: on an error the API message is shown and the schedule is refreshed', async () => {
    mocks.getSchedule
      .mockResolvedValueOnce({ from: '', to: '', items: [item()] })
      .mockResolvedValue({ from: '', to: '', items: [item({ freePlaces: 0 })] });
    mocks.bookClass.mockRejectedValue(
      new mocks.FakeApiError(409, 'This class is full. You can join the waiting list.'),
    );
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Book' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));

    expect((await screen.findByRole('alert')).textContent).toBe('This class is full. You can join the waiting list.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Full' })).toBeTruthy());
    expect(mocks.getSchedule).toHaveBeenCalledTimes(2);
  });
});
