import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleItem } from '../src/api/classes';
import { BookButton } from '../src/components/BookButton';

const mocks = vi.hoisted(() => ({ bookClass: vi.fn() }));

vi.mock('../src/api/bookings', () => ({ bookClass: mocks.bookClass }));
vi.mock('../src/api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const NOW = new Date('2026-10-30T09:00:00.000Z');

function item(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    clubId: '22222222-2222-4222-8222-222222222222',
    clubName: 'FitHub City',
    clubTimezone: 'Europe/Stockholm',
    name: 'Spinning 45',
    startAt: '2026-11-02T17:00:00.000Z',
    durationMinutes: 45,
    capacity: 20,
    freePlaces: 2,
    status: 'scheduled',
    instructorName: null,
    myBookingStatus: 'none',
    myBooking: null,
    myWaitlist: null,
    ...overrides,
  };
}

async function apiError(status: number, message: string): Promise<Error> {
  const { ApiError } = (await import('../src/api/client')) as unknown as {
    ApiError: new (status: number, message: string) => Error;
  };
  return new ApiError(status, message);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mocks.bookClass.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BookButton', () => {
  it('AC 9: shows "Book" on a class with free places', () => {
    render(<BookButton item={item()} onResult={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Book' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('AC 9: shows a disabled "Booked" when the member has an active booking', () => {
    render(
      <BookButton item={item({ myBooking: { id: 'b', status: 'confirmed' }, myBookingStatus: 'confirmed' })} onResult={vi.fn()} />,
    );
    expect((screen.getByRole('button', { name: 'Booked' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('AC 9: shows a disabled "Full" when no places are left', () => {
    render(<BookButton item={item({ freePlaces: 0 })} onResult={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Full' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('AC 9: renders nothing for a cancelled class or one that has started', () => {
    const { container, rerender } = render(<BookButton item={item({ status: 'cancelled' })} onResult={vi.fn()} />);
    expect(container.textContent).toBe('');
    rerender(<BookButton item={item({ startAt: '2026-10-30T08:59:00.000Z' })} onResult={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('AC 9: Book opens an accessible confirmation dialog in club time; "Not now" closes it without booking', () => {
    render(<BookButton item={item()} onResult={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Book Spinning 45 on Monday 2 November at 18:00?')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirm booking' }));

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Book' }));
    expect(mocks.bookClass).not.toHaveBeenCalled();
  });

  it('AC 9: Esc closes the dialog and returns focus to the Book button', () => {
    render(<BookButton item={item()} onResult={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Book' }));
  });

  it('AC 9: confirming books once, shows "Booking…" and reports the success toast text on 201', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    mocks.bookClass.mockReturnValue(new Promise((r) => (resolve = r)));
    const onResult = vi.fn();
    render(<BookButton item={item()} onResult={onResult} />);

    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));

    const busy = screen.getByRole('button', { name: 'Booking…' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(mocks.bookClass).toHaveBeenCalledTimes(1);
    expect(mocks.bookClass).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');

    resolve({ status: 'confirmed' });
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({
        kind: 'success',
        text: "You're booked for Spinning 45 on Monday 2 November.",
      }),
    );
    expect((screen.getByRole('button', { name: 'Book' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('AC 9: a pending_payment booking (202) reports the reserved-place text', async () => {
    mocks.bookClass.mockResolvedValue({ status: 'pending_payment' });
    const onResult = vi.fn();
    render(<BookButton item={item()} onResult={onResult} />);
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({
        kind: 'success',
        text: 'Your place is reserved. Complete the payment to confirm it.',
      }),
    );
  });

  it('AC 9: an API error (409) reports the API message', async () => {
    mocks.bookClass.mockRejectedValue(
      await apiError(409, 'This class is full. You can join the waiting list.'),
    );
    const onResult = vi.fn();
    render(<BookButton item={item()} onResult={onResult} />);
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    await waitFor(() =>
      expect(onResult).toHaveBeenCalledWith({
        kind: 'error',
        text: 'This class is full. You can join the waiting list.',
      }),
    );
  });

  it('AC 9: a network error or a 5xx reports a generic message', async () => {
    const onResult = vi.fn();
    mocks.bookClass.mockRejectedValueOnce(new Error('network'));
    mocks.bookClass.mockRejectedValueOnce(await apiError(500, 'Internal detail'));
    render(<BookButton item={item()} onResult={onResult} />);

    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Book' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
      await waitFor(() => expect(onResult).toHaveBeenCalledTimes(i + 1));
    }
    expect(onResult).toHaveBeenNthCalledWith(1, { kind: 'error', text: 'Something went wrong. Please try again.' });
    expect(onResult).toHaveBeenNthCalledWith(2, { kind: 'error', text: 'Something went wrong. Please try again.' });
  });
});
