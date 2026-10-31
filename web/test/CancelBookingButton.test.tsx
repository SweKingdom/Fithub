import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Booking } from '../src/api/bookings';
import { ApiError } from '../src/api/client';
import { CancelBookingButton } from '../src/components/CancelBookingButton';

const mocks = vi.hoisted(() => ({ cancelBooking: vi.fn() }));
vi.mock('../src/api/bookings', () => ({ cancelBooking: mocks.cancelBooking }));

function booking(fields: Partial<Booking> = {}): Booking {
  return {
    id: 'b1',
    classId: 'c1',
    className: 'Spinning',
    clubName: 'Alpha',
    clubTimezone: 'Europe/Stockholm',
    startAt: '2026-11-03T17:30:00.000Z',
    durationMinutes: 45,
    status: 'confirmed',
    attendance: 'unknown',
    cancelDeadline: '2026-11-03T15:30:00.000Z',
    canCancel: true,
    ...fields,
  };
}

const onCancelled = vi.fn();
const onFailed = vi.fn();

function renderButton(fields: Partial<Booking> = {}) {
  return render(<CancelBookingButton booking={booking(fields)} onCancelled={onCancelled} onFailed={onFailed} />);
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('CancelBookingButton (US-124 AC 9)', () => {
  it('shows an enabled "Cancel booking" button when canCancel is true', () => {
    renderButton();
    const button = screen.getByRole('button', { name: 'Cancel booking' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a disabled button with the hint, linked by aria-describedby, when canCancel is false', () => {
    renderButton({ canCancel: false });
    const button = screen.getByRole('button', { name: 'Cancel booking' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const hint = screen.getByText('Cancellation closed (less than 2 hours to start)');
    expect(button.getAttribute('aria-describedby')).toBe(hint.id);
  });

  it('words the hint from the cut-off of the booking (90 minutes)', () => {
    renderButton({ canCancel: false, cancelDeadline: '2026-11-03T16:00:00.000Z' });
    expect(screen.getByText('Cancellation closed (less than 90 minutes to start)')).toBeTruthy();
  });

  it('renders nothing for a cancelled booking', () => {
    const { container } = renderButton({ status: 'cancelled', canCancel: false });
    expect(container.textContent).toBe('');
  });

  it('asks for confirmation with the class, club-local date and time, and "Keep booking" closes it', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    const dialog = screen.getByRole('dialog');
    // 17:30 UTC is 18:30 in Stockholm in November.
    expect(dialog.textContent).toContain('Cancel your booking for Spinning on Tuesday 3 November at 18:30?');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep booking' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.cancelBooking).not.toHaveBeenCalled();
  });

  it('disables the dialog buttons while cancelling, then reports success', async () => {
    let resolve: (value: Booking) => void = () => undefined;
    mocks.cancelBooking.mockReturnValue(new Promise<Booking>((r) => (resolve = r)));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' }));

    const pending = within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelling…' }) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Keep booking' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.cancelBooking).toHaveBeenCalledWith('b1');

    resolve(booking({ status: 'cancelled', canCancel: false }));
    await waitFor(() => expect(onCancelled).toHaveBeenCalledTimes(1));
    expect(onFailed).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('passes the API message to onFailed when the server refuses', async () => {
    mocks.cancelBooking.mockRejectedValue(new ApiError(409, 'CLASS_CANCELLED', 'This class has been cancelled.'));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' }));

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith('This class has been cancelled.'));
    expect(onCancelled).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses a generic message for an unexpected error', async () => {
    mocks.cancelBooking.mockRejectedValue(new Error('boom'));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel booking' }));

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith('Something went wrong. Please try again.'));
  });
});
