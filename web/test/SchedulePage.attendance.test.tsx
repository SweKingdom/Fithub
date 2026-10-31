import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleItem } from '../src/api/classes';
import { SchedulePage } from '../src/pages/SchedulePage';

const CLUB = { id: 'a0000000-0000-4000-8000-000000000001', name: 'Alpha', timezone: 'Europe/Stockholm' };
const OTHER_CLUB_ID = 'b0000000-0000-4000-8000-000000000002';

const mocks = vi.hoisted(() => ({
  listClubs: vi.fn(),
  getSchedule: vi.fn(),
  me: { clubId: null as string | null, role: 'instructor' as string },
  onUnauthenticated: vi.fn(),
}));

vi.mock('../src/api/clubs', () => ({ listClubs: mocks.listClubs }));
vi.mock('../src/api/classes', () => ({ getSchedule: mocks.getSchedule }));
vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ me: mocks.me, onUnauthenticated: mocks.onUnauthenticated }),
}));

const HOUR = 60 * 60 * 1000;

function item(id: string, name: string, offsetMs: number, clubId = CLUB.id): ScheduleItem {
  return {
    id,
    clubId,
    clubName: 'Alpha',
    clubTimezone: 'Europe/Stockholm',
    name,
    startAt: new Date(Date.now() + offsetMs).toISOString(),
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/schedule']}>
      <SchedulePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.me.clubId = CLUB.id;
  mocks.me.role = 'instructor';
  mocks.listClubs.mockResolvedValue([CLUB]);
  mocks.getSchedule.mockResolvedValue({
    from: '',
    to: '',
    items: [
      item('c1', 'Started class', -HOUR),
      item('c2', 'Future class', 2 * HOUR),
      item('c3', 'Other club class', -HOUR, OTHER_CLUB_ID),
    ],
  });
});

describe('SchedulePage attendance link (US-129 AC 9)', () => {
  it('staff of the club see "Attendance" only on classes that have started', async () => {
    renderPage();
    await screen.findByText('Started class');
    const links = screen.getAllByRole('link', { name: 'Attendance' });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/classes/c1/attendance');
  });

  it('a club manager sees the link too', async () => {
    mocks.me.role = 'club_manager';
    renderPage();
    await screen.findByText('Started class');
    expect(screen.getAllByRole('link', { name: 'Attendance' })).toHaveLength(1);
  });

  it('members never see the link', async () => {
    mocks.me.role = 'member';
    renderPage();
    await screen.findByText('Started class');
    expect(screen.queryByRole('link', { name: 'Attendance' })).toBeNull();
  });
});
