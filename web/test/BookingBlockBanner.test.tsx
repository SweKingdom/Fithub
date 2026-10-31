import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingBlock } from '../src/api/auth';
import { BOOKING_BLOCK_BANNER_ID, BookingBlockBanner } from '../src/components/BookingBlockBanner';
import { SchedulePage } from '../src/pages/SchedulePage';

const mocks = vi.hoisted(() => ({
  listClubs: vi.fn(),
  getSchedule: vi.fn(),
  me: { clubId: null as string | null, role: 'member', bookingBlock: null as unknown },
  onUnauthenticated: vi.fn(),
}));

vi.mock('../src/api/clubs', () => ({ listClubs: mocks.listClubs }));
vi.mock('../src/api/classes', () => ({ getSchedule: mocks.getSchedule }));
vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ me: mocks.me, onUnauthenticated: mocks.onUnauthenticated }),
}));

const BLOCK: BookingBlock = {
  endsAt: '2026-11-06T09:00:00.000Z',
  reason: 'no_show',
  noShowCount: 3,
  message: "You can't book classes until 6 Nov 2026, 10:00 because of 3 missed classes.",
};

describe('BookingBlockBanner (US-130 AC 10)', () => {
  it('shows the message from the API as a status banner', () => {
    render(<BookingBlockBanner block={BLOCK} />);
    const banner = screen.getByRole('status');
    expect(banner.textContent).toBe(BLOCK.message);
    expect(banner.id).toBe(BOOKING_BLOCK_BANNER_ID);
  });

  it('shows the shorter text of a manual block as the API sends it', () => {
    render(<BookingBlockBanner block={{ ...BLOCK, reason: 'manual', noShowCount: null, message: "You can't book classes until 6 Nov 2026, 10:00." }} />);
    expect(screen.getByRole('status').textContent).toBe("You can't book classes until 6 Nov 2026, 10:00.");
  });

  it('renders nothing when the member is not blocked', () => {
    const { container } = render(<BookingBlockBanner block={null} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('SchedulePage with a booking block (US-130 AC 10)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.listClubs.mockResolvedValue([
      { id: 'a0000000-0000-4000-8000-000000000001', name: 'Alpha', timezone: 'Europe/Stockholm' },
    ]);
    mocks.getSchedule.mockResolvedValue({ from: '', to: '', items: [] });
    mocks.me.bookingBlock = null;
  });

  it('shows the banner for a blocked member', async () => {
    mocks.me.bookingBlock = BLOCK;
    render(
      <MemoryRouter initialEntries={['/schedule']}>
        <SchedulePage />
      </MemoryRouter>,
    );
    expect((await screen.findByRole('status')).textContent).toBe(BLOCK.message);
    expect(await screen.findByText('No classes scheduled in the next two weeks.')).toBeTruthy();
  });

  it('shows no banner when the member is not blocked', async () => {
    render(
      <MemoryRouter initialEntries={['/schedule']}>
        <SchedulePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('No classes scheduled in the next two weeks.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
