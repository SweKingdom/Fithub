import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleItem } from '../src/api/classes';
import { SchedulePage } from '../src/pages/SchedulePage';

const mocks = vi.hoisted(() => ({
  listClubs: vi.fn(),
  getSchedule: vi.fn(),
  me: { clubId: null as string | null, role: 'member' },
  onUnauthenticated: vi.fn(),
}));

vi.mock('../src/api/clubs', () => ({ listClubs: mocks.listClubs }));
vi.mock('../src/api/classes', () => ({ getSchedule: mocks.getSchedule }));
vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ me: mocks.me, onUnauthenticated: mocks.onUnauthenticated }),
}));

const CLUBS = [
  { id: 'a0000000-0000-4000-8000-000000000001', name: 'Alpha', timezone: 'Europe/Stockholm' },
  { id: 'b0000000-0000-4000-8000-000000000002', name: 'Beta', timezone: 'Europe/Stockholm' },
];

function item(id: string, startAt: string, name: string): ScheduleItem {
  return {
    id,
    clubId: CLUBS[0].id,
    clubName: 'Alpha',
    clubTimezone: 'Europe/Stockholm',
    name,
    startAt,
    durationMinutes: 45,
    capacity: 20,
    freePlaces: 5,
    status: 'scheduled',
    instructorName: null,
    myBookingStatus: 'none',
    myBooking: null,
    myWaitlist: null,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="url">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(url = '/schedule') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <SchedulePage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function selectedClub(): string {
  return (screen.getByLabelText('Club') as HTMLSelectElement).value;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.me.clubId = null;
  mocks.listClubs.mockResolvedValue(CLUBS);
  mocks.getSchedule.mockResolvedValue({ from: '', to: '', items: [] });
});

describe('SchedulePage', () => {
  it('AC 11: shows a loading message while the list loads', async () => {
    mocks.getSchedule.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByText('Loading schedule…')).toBeTruthy();
    await waitFor(() => expect(mocks.getSchedule).toHaveBeenCalled());
  });

  it('AC 11: shows a clear message, not the loading text, when there are no clubs', async () => {
    mocks.listClubs.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('There are no clubs to show a schedule for yet.')).toBeTruthy();
    expect(screen.queryByText('Loading schedule…')).toBeNull();
    expect((screen.getByLabelText('Club') as HTMLSelectElement).disabled).toBe(true);
    expect(mocks.getSchedule).not.toHaveBeenCalled();
  });

  it('AC 11: preselects the club from ?clubId', async () => {
    renderPage(`/schedule?clubId=${CLUBS[1].id}`);
    await waitFor(() => expect(mocks.getSchedule).toHaveBeenCalledWith({ clubId: CLUBS[1].id }));
    expect(selectedClub()).toBe(CLUBS[1].id);
  });

  it('AC 11: ignores an unknown ?clubId and uses the home club', async () => {
    mocks.me.clubId = CLUBS[1].id;
    renderPage('/schedule?clubId=c0000000-0000-4000-8000-000000000003');
    await waitFor(() => expect(mocks.getSchedule).toHaveBeenCalledWith({ clubId: CLUBS[1].id }));
  });

  it('AC 11: falls back to the first club when there is no URL club or home club', async () => {
    renderPage();
    await waitFor(() => expect(mocks.getSchedule).toHaveBeenCalledWith({ clubId: CLUBS[0].id }));
    expect(selectedClub()).toBe(CLUBS[0].id);
  });

  it('AC 11: changing the club updates the URL and reloads the list', async () => {
    renderPage();
    await waitFor(() => expect(mocks.getSchedule).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Club'), { target: { value: CLUBS[1].id } });
    await waitFor(() => expect(mocks.getSchedule).toHaveBeenLastCalledWith({ clubId: CLUBS[1].id }));
    expect(screen.getByTestId('url').textContent).toBe(`/schedule?clubId=${CLUBS[1].id}`);
  });

  it('AC 6: shows the empty state', async () => {
    renderPage();
    expect(await screen.findByText('No classes scheduled in the next two weeks.')).toBeTruthy();
  });

  it('AC 8: groups cards by club-local day with local times', async () => {
    mocks.getSchedule.mockResolvedValue({
      from: '',
      to: '',
      items: [
        item('1', '2026-11-02T17:00:00.000Z', 'Spinning'),
        item('2', '2026-11-02T23:30:00.000Z', 'Night Yoga'),
      ],
    });
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Monday 2 November' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Tuesday 3 November' })).toBeTruthy();
    expect(screen.getByText('00:30–01:15')).toBeTruthy();
  });

  it('AC 11: shows an error with "Try again", which reloads', async () => {
    mocks.getSchedule.mockRejectedValueOnce(new Error('network'));
    renderPage();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText("We couldn't load the schedule. Please try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No classes scheduled in the next two weeks.')).toBeTruthy();
    expect(mocks.getSchedule).toHaveBeenCalledTimes(2);
  });

  it('shows the same error when the clubs cannot be loaded', async () => {
    mocks.listClubs.mockRejectedValueOnce(new Error('network'));
    renderPage();
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.getSchedule).toHaveBeenCalled());
  });
});
