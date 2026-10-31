import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Booking } from '../src/api/bookings';
import { ApiError } from '../src/api/client';
import { AppHeader } from '../src/components/AppHeader';
import { MyBookingsPage } from '../src/pages/MyBookingsPage';

const mocks = vi.hoisted(() => ({
  getMyBookings: vi.fn(),
  onUnauthenticated: vi.fn(),
  user: { fullName: 'Mia Member', role: 'member' } as { fullName: string; role: string },
}));

vi.mock('../src/api/bookings', () => ({ getMyBookings: mocks.getMyBookings }));
vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: mocks.user, signOut: vi.fn(), onUnauthenticated: mocks.onUnauthenticated }),
}));

function booking(id: string, fields: Partial<Booking> = {}): Booking {
  return {
    id,
    classId: 'c0000000-0000-4000-8000-000000000001',
    className: 'Spinning',
    clubName: 'Alpha',
    clubTimezone: 'Europe/Stockholm',
    startAt: '2026-11-03T17:30:00.000Z',
    durationMinutes: 45,
    status: 'confirmed',
    attendance: 'unknown',
    canCancel: true,
    ...fields,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="url">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(url = '/my-bookings') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MyBookingsPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.role = 'member';
  mocks.getMyBookings.mockResolvedValue({ items: [], total: 0 });
});

describe('MyBookingsPage (US-123 AC 7)', () => {
  it('shows a loading state, then rows with class, club, club-local date and time, and status', async () => {
    mocks.getMyBookings.mockResolvedValue({
      items: [
        booking('1'),
        booking('2', { className: 'Yoga', status: 'pending_payment' }),
        booking('3', { className: 'Pilates', status: 'cancelled' }),
      ],
      total: 3,
    });
    renderPage();
    expect(screen.getByText('Loading your bookings…')).toBeTruthy();

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Spinning')).toBeTruthy();
    expect(rows[0].textContent).toContain('Alpha');
    // 17:30 UTC is 18:30 in Stockholm in November.
    expect(rows[0].textContent).toContain('Tue 3 Nov 2026, 18:30');
    expect(rows[0].textContent).toContain('Booked');
    expect(rows[1].textContent).toContain('Awaiting payment');
    expect(rows[2].textContent).toContain('Cancelled');
    expect(mocks.getMyBookings).toHaveBeenCalledWith('upcoming');
  });

  it('shows the empty text of each tab and keeps the tab in the URL', async () => {
    renderPage();
    expect(await screen.findByText('You have no upcoming bookings.')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Upcoming' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Past' }));
    expect(await screen.findByText('You have no past bookings.')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Past' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('url').textContent).toBe('/my-bookings?period=past');
    expect(mocks.getMyBookings).toHaveBeenLastCalledWith('past');
  });

  it('opens the past tab from the URL and shows the attendance of past bookings', async () => {
    mocks.getMyBookings.mockResolvedValue({
      items: [booking('1', { attendance: 'attended' }), booking('2', { attendance: 'no_show' })],
      total: 2,
    });
    renderPage('/my-bookings?period=past');
    const rows = await screen.findAllByRole('listitem');
    expect(rows[0].textContent).toContain('Attended');
    expect(rows[1].textContent).toContain('No-show');
    expect(mocks.getMyBookings).toHaveBeenCalledWith('past');
  });

  it('shows an error banner and loads again on Retry', async () => {
    mocks.getMyBookings.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'boom'));
    renderPage();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("We couldn't load your bookings. Please try again.");

    mocks.getMyBookings.mockResolvedValue({ items: [booking('1')], total: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('signs the user out locally when the API answers 401', async () => {
    mocks.getMyBookings.mockRejectedValue(new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.'));
    renderPage();
    await waitFor(() => expect(mocks.onUnauthenticated).toHaveBeenCalled());
  });

  it('"Show more" loads the next page while fewer items than the total are shown', async () => {
    mocks.getMyBookings
      .mockResolvedValueOnce({ items: [booking('1')], total: 2 })
      .mockResolvedValueOnce({ items: [booking('2', { className: 'Yoga' })], total: 2 });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(mocks.getMyBookings).toHaveBeenLastCalledWith('upcoming', 1);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});

describe('AppHeader menu (US-123 AC 7)', () => {
  it('shows "My bookings" to members and not to staff', () => {
    const { unmount } = render(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'My bookings' })).toBeTruthy();
    unmount();

    mocks.user.role = 'instructor';
    render(
      <MemoryRouter>
        <AppHeader />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: 'My bookings' })).toBeNull();
  });
});
