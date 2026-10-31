import { useState } from 'react';
import { cancelBooking, type Booking } from '../api/bookings';
import { ApiError } from '../api/client';
import { formatClubDay, formatClubTime } from '../lib/time';

const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

/** "2 hours", "1 hour", "90 minutes": the same wording as the API's cut-off messages. */
function formatCutoff(minutes: number): string {
  if (minutes > 0 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

interface CancelBookingButtonProps {
  booking: Booking;
  /** The booking was cancelled; the parent refreshes its list and tells the member. */
  onCancelled: () => void;
  /** The API refused; `message` is its plain-language text. The parent refreshes its list and shows it. */
  onFailed: (message: string) => void;
}

/**
 * "Cancel booking" for one active booking. The server decides whether it is allowed (`canCancel`); the browser clock
 * is never used for that. Active but not cancellable: a disabled button with the reason.
 */
export function CancelBookingButton({ booking, onCancelled, onFailed }: CancelBookingButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (booking.status === 'cancelled') return null;

  if (!booking.canCancel) {
    const hintId = `cancel-hint-${booking.id}`;
    const cutoffMinutes = Math.round((Date.parse(booking.startAt) - Date.parse(booking.cancelDeadline)) / 60_000);
    return (
      <>
        <button type="button" disabled aria-describedby={hintId}>
          Cancel booking
        </button>
        <span id={hintId}> Cancellation closed (less than {formatCutoff(cutoffMinutes)} to start)</span>
      </>
    );
  }

  async function confirm(): Promise<void> {
    setSubmitting(true);
    try {
      await cancelBooking(booking.id);
      setSubmitting(false);
      setConfirming(false);
      onCancelled();
    } catch (error) {
      setSubmitting(false);
      setConfirming(false);
      onFailed(error instanceof ApiError ? error.message : FALLBACK_MESSAGE);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setConfirming(true)}>
        Cancel booking
      </button>
      {confirming && (
        <div role="dialog" aria-modal="true" aria-labelledby={`cancel-title-${booking.id}`}>
          <p id={`cancel-title-${booking.id}`}>
            Cancel your booking for {booking.className} on {formatClubDay(booking.startAt, booking.clubTimezone)} at{' '}
            {formatClubTime(booking.startAt, booking.clubTimezone)}?
          </p>
          <button type="button" disabled={submitting} onClick={() => void confirm()}>
            {submitting ? 'Cancelling…' : 'Cancel booking'}
          </button>
          <button type="button" disabled={submitting} onClick={() => setConfirming(false)}>
            Keep booking
          </button>
        </div>
      )}
    </>
  );
}
