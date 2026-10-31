import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import { WaitlistButton, type WaitlistButtonProps } from '../src/components/WaitlistButton';

const api = vi.hoisted(() => ({ joinWaitlist: vi.fn(), leaveWaitlist: vi.fn() }));
vi.mock('../src/api/waitlist', () => api);

// Test-only stand-in for the shared dialog (US-122): same props, no focus trap.
vi.mock('../src/components/ConfirmDialog', () => ({
  ConfirmDialog: (p: { message: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void; onCancel: () => void }) => (
    <div role="dialog">
      <p>{p.message}</p>
      <button onClick={p.onConfirm}>{p.confirmLabel}</button>
      <button onClick={p.onCancel}>{p.cancelLabel}</button>
    </div>
  ),
}));

const handlers = { onNotify: vi.fn(), onError: vi.fn(), onChanged: vi.fn() };

function renderButton(overrides: Partial<WaitlistButtonProps> = {}) {
  return render(
    <WaitlistButton
      classId="class-1"
      className="Spinning 45"
      dateLabel="2 Nov 2026"
      timeLabel="18:00"
      myWaitlist={null}
      {...handlers}
      {...overrides}
    />,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('WaitlistButton (AC 8)', () => {
  it('shows "Join waiting list" for a member without an entry', () => {
    renderButton();
    expect(screen.getByRole('button', { name: 'Join waiting list' })).toBeTruthy();
    expect(screen.queryByText(/Waiting list – position/)).toBeNull();
  });

  it('shows the position as text and a Leave button once on the list', () => {
    renderButton({ myWaitlist: { entryId: 'e1', position: 3 } });
    expect(screen.getByText('Waiting list – position 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leave waiting list' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join waiting list' })).toBeNull();
  });

  it('asks for confirmation with the class, date and time, and does nothing on "Not now"', () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }));
    expect(
      screen.getByText(
        'Join the waiting list for Spinning 45 on 2 Nov 2026 at 18:00? If a place frees up, it is booked for you automatically.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(api.joinWaitlist).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('joins: disables the button with "Joining…", then toasts the position and refetches', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    api.joinWaitlist.mockReturnValue(new Promise((r) => (resolve = r)));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    const busy = (await screen.findByRole('button', { name: 'Joining…' })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(api.joinWaitlist).toHaveBeenCalledWith('class-1');

    resolve({ position: 2 });
    await waitFor(() => expect(handlers.onChanged).toHaveBeenCalledTimes(1));
    expect(handlers.onNotify).toHaveBeenCalledWith("You're on the waiting list – position 2.");
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('leaves: confirms, calls the API with the entry id, toasts and refetches', async () => {
    api.leaveWaitlist.mockResolvedValue(undefined);
    renderButton({ myWaitlist: { entryId: 'e1', position: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'Leave waiting list' }));
    expect(screen.getByText('Leave the waiting list for Spinning 45?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));

    await waitFor(() => expect(handlers.onChanged).toHaveBeenCalledTimes(1));
    expect(api.leaveWaitlist).toHaveBeenCalledWith('e1');
    expect(handlers.onNotify).toHaveBeenCalledWith("You've left the waiting list.");
  });

  it('keeps the entry when the member answers "Stay"', () => {
    renderButton({ myWaitlist: { entryId: 'e1', position: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'Leave waiting list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(api.leaveWaitlist).not.toHaveBeenCalled();
  });

  it('shows the API message for a business error and still refetches', async () => {
    api.joinWaitlist.mockRejectedValue(
      new ApiError(409, 'CLASS_NOT_FULL', 'This class has free places – book directly.'),
    );
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Join waiting list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    await waitFor(() => expect(handlers.onChanged).toHaveBeenCalledTimes(1));
    expect(handlers.onError).toHaveBeenCalledWith('This class has free places – book directly.');
    expect(handlers.onNotify).not.toHaveBeenCalled();
  });

  it.each([
    ['a server error', new ApiError(500, 'INTERNAL', 'stack trace details')],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('shows the generic message for %s', async (_label, error) => {
    api.leaveWaitlist.mockRejectedValue(error);
    renderButton({ myWaitlist: { entryId: 'e1', position: 1 } });
    fireEvent.click(screen.getByRole('button', { name: 'Leave waiting list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));

    await waitFor(() => expect(handlers.onError).toHaveBeenCalledWith('Something went wrong. Please try again.'));
  });

  it('disables Join and links it to the block banner while blocked (US-130)', () => {
    renderButton({ blockedDescribedBy: 'block-banner' });
    const button = screen.getByRole('button', { name: 'Join waiting list' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-describedby')).toBe('block-banner');
  });
});
