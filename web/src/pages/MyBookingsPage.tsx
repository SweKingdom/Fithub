import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getMyBookings, type Booking, type BookingPeriod } from '../api/bookings';
import { ApiError } from '../api/client';
import { CancelBookingButton } from '../components/CancelBookingButton';
import { useAuth } from '../lib/auth';
import { formatClubDateTime } from '../lib/time';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: Booking[]; total: number };

/** Result of the last cancel attempt: a success toast or an error banner. */
type Notice = { kind: 'success' | 'error'; text: string };

const TABS: { period: BookingPeriod; label: string; empty: string }[] = [
  { period: 'upcoming', label: 'Upcoming', empty: 'You have no upcoming bookings.' },
  { period: 'past', label: 'Past', empty: 'You have no past bookings.' },
];

const STATUS_LABEL: Record<Booking['status'], string> = {
  confirmed: 'Booked',
  pending_payment: 'Awaiting payment',
  cancelled: 'Cancelled',
};

const ATTENDANCE_LABEL: Partial<Record<Booking['attendance'], string>> = {
  attended: 'Attended',
  no_show: 'No-show',
};

/** "My bookings" (members only): the member's own bookings, "Upcoming" or "Past", kept in the URL as `?period=`. */
export function MyBookingsPage() {
  const { onUnauthenticated } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const period: BookingPeriod = searchParams.get('period') === 'past' ? 'past' : 'upcoming';
  const tab = TABS.find((candidate) => candidate.period === period) ?? TABS[0];

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const handleFailure = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthenticated();
        return;
      }
      setState({ status: 'error' });
    },
    [onUnauthenticated],
  );

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    getMyBookings(period)
      .then((response) => {
        if (active) setState({ status: 'ready', items: response.items, total: response.total });
      })
      .catch((error: unknown) => {
        if (active) handleFailure(error);
      });
    return () => {
      active = false;
    };
  }, [period, reloadToken, handleFailure]);

  function retry(): void {
    setReloadToken((token) => token + 1);
  }

  /** Shows the outcome of a cancel attempt and reloads the list: the server is the source of truth. */
  function afterCancel(result: Notice): void {
    setNotice(result);
    retry();
  }

  function showMore(current: { items: Booking[] }): void {
    setLoadingMore(true);
    getMyBookings(period, current.items.length)
      .then((response) =>
        setState({ status: 'ready', items: [...current.items, ...response.items], total: response.total }),
      )
      .catch(handleFailure)
      .finally(() => setLoadingMore(false));
  }

  return (
    <main>
      <h1>My bookings</h1>

      {notice?.kind === 'success' && <p role="status">{notice.text}</p>}
      {notice?.kind === 'error' && <p role="alert">{notice.text}</p>}

      <div role="tablist" aria-label="Bookings">
        {TABS.map((candidate) => (
          <button
            key={candidate.period}
            type="button"
            role="tab"
            aria-selected={candidate.period === period}
            onClick={() => setSearchParams({ period: candidate.period }, { replace: true })}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && <p>Loading your bookings…</p>}

        {state.status === 'error' && (
          <div role="alert">
            <p>We couldn't load your bookings. Please try again.</p>
            <button type="button" onClick={retry}>
              Retry
            </button>
          </div>
        )}

        {state.status === 'ready' && state.items.length === 0 && <p>{tab.empty}</p>}

        {state.status === 'ready' && state.items.length > 0 && (
          <>
            <ul>
              {state.items.map((booking) => (
                <li key={booking.id}>
                  <strong>{booking.className}</strong>
                  <span> · {booking.clubName}</span>
                  <span> · {formatClubDateTime(booking.startAt, booking.clubTimezone)}</span>
                  <span> · {STATUS_LABEL[booking.status]}</span>
                  {period === 'past' && ATTENDANCE_LABEL[booking.attendance] && (
                    <span> · {ATTENDANCE_LABEL[booking.attendance]}</span>
                  )}
                  {period === 'upcoming' && (
                    <CancelBookingButton
                      booking={booking}
                      onCancelled={() => afterCancel({ kind: 'success', text: 'Your booking has been cancelled.' })}
                      onFailed={(text) => afterCancel({ kind: 'error', text })}
                    />
                  )}
                </li>
              ))}
            </ul>
            {state.items.length < state.total && (
              <button type="button" disabled={loadingMore} onClick={() => showMore(state)}>
                Show more
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
