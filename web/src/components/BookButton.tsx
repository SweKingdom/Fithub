import { useState } from 'react';
import { bookClass } from '../api/bookings';
import type { ScheduleItem } from '../api/classes';
import { ApiError } from '../api/client';
import { formatClubDay, formatClubTime } from '../lib/time';
import { ConfirmDialog } from './ConfirmDialog';

export interface BookingNotice {
  kind: 'success' | 'error';
  text: string;
}

interface BookButtonProps {
  item: ScheduleItem;
  /** Called once with the outcome; the page shows it and refreshes the schedule. */
  onResult: (notice: BookingNotice) => void;
}

const GENERIC_ERROR = 'Something went wrong. Please try again.';
const PENDING_PAYMENT_NOTICE = 'Your place is reserved. Complete the payment to confirm it.';

/** The API's own message for a rejected booking (4xx); anything else is a generic error. */
function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.message) {
    return error.message;
  }
  return GENERIC_ERROR;
}

/** Book / Booked / Full for members. Hidden once the class has started or was cancelled. */
export function BookButton({ item, onResult }: BookButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (item.status !== 'scheduled' || Date.parse(item.startAt) <= Date.now()) return null;
  if (item.myBooking !== null) {
    return (
      <button type="button" disabled>
        Booked
      </button>
    );
  }
  if (item.freePlaces === 0) {
    return (
      <button type="button" disabled>
        Full
      </button>
    );
  }

  const day = formatClubDay(item.startAt, item.clubTimezone);
  const time = formatClubTime(item.startAt, item.clubTimezone);

  async function confirm(): Promise<void> {
    setConfirming(false);
    setSubmitting(true);
    try {
      const booking = await bookClass(item.id);
      onResult({
        kind: 'success',
        text:
          booking.status === 'pending_payment'
            ? PENDING_PAYMENT_NOTICE
            : `You're booked for ${item.name} on ${day}.`,
      });
    } catch (error) {
      onResult({ kind: 'error', text: errorText(error) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button type="button" disabled={submitting} onClick={() => setConfirming(true)}>
        {submitting ? 'Booking…' : 'Book'}
      </button>
      {confirming && (
        <ConfirmDialog
          title={`Book ${item.name} on ${day} at ${time}?`}
          confirmLabel="Confirm booking"
          cancelLabel="Not now"
          onConfirm={() => void confirm()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
