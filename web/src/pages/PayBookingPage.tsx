import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { getPayment, resumePayment, type Payment } from '../api/payments';
import { PaymentForm } from '../components/PaymentForm';
import { useAuth } from '../lib/auth';

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_MS = 30000;

const GENERIC_ERROR = 'Something went wrong. Please try again.';
const SUCCEEDED_MESSAGE = "Payment received – you're booked.";
const DECLINED_MESSAGE = 'Your payment was declined. Your booking was not confirmed.';
const ON_HOLD_MESSAGE =
  "We couldn't reach our payment provider. Your booking is on hold and we'll retry automatically – you don't need to book again.";
const EXPIRED_MESSAGE = 'Your booking was cancelled because the payment was not completed in time.';

interface CardPayment {
  amount: number;
  currency: string;
  clientSecret: string;
  publishableKey: string;
}

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; payment: CardPayment }
  | { status: 'processing'; payment: CardPayment; cardError: string | null }
  | { status: 'succeeded' }
  | { status: 'declined' }
  | { status: 'hold'; message: string }
  | { status: 'expired'; message: string }
  | { status: 'error'; message: string };

/** The final states the API can report; `null` while the payment is still open. */
function finalState(payment: Payment): PageState | null {
  switch (payment.status) {
    case 'succeeded':
      return { status: 'succeeded' };
    case 'failed':
      return { status: 'declined' };
    case 'expired':
      return { status: 'expired', message: payment.message ?? EXPIRED_MESSAGE };
    default:
      return null;
  }
}

function stateAfterResume(payment: Payment): PageState {
  const final = finalState(payment);
  if (final) return final;
  if (payment.status === 'pending_retry') return { status: 'hold', message: payment.message ?? ON_HOLD_MESSAGE };
  if (payment.status === 'requires_payment' && payment.clientSecret && payment.publishableKey) {
    const { amount, currency, clientSecret, publishableKey } = payment;
    return { status: 'ready', payment: { amount, currency, clientSecret, publishableKey } };
  }
  return { status: 'error', message: GENERIC_ERROR };
}

/** `amount` is in minor units; the number of decimals comes from the currency (zero for JPY, three for KWD). */
function formatAmount(amount: number, currency: string): string {
  const format = new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amount / 10 ** digits);
}

/**
 * `/bookings/:bookingId/pay` (members only): shows the card form for a held drop-in booking, then waits for the
 * webhook to confirm or cancel the booking by polling the payment every 2 seconds, for at most 30 seconds.
 */
export function PayBookingPage() {
  const { bookingId = '' } = useParams();
  const { onUnauthenticated } = useAuth();
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  const handleFailure = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        onUnauthenticated();
        return;
      }
      // A 409 carries a message for the member (already paid, cancelled, payments off); anything else does not.
      const message = error instanceof ApiError && error.status === 409 ? error.message : GENERIC_ERROR;
      setState({ status: 'error', message });
    },
    [onUnauthenticated],
  );

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    resumePayment(bookingId)
      .then((payment) => {
        if (active) setState(stateAfterResume(payment));
      })
      .catch((error: unknown) => {
        if (active) handleFailure(error);
      });
    return () => {
      active = false;
    };
  }, [bookingId, reloadToken, handleFailure]);

  const processing = state.status === 'processing';
  useEffect(() => {
    if (!processing) return;
    let active = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async (): Promise<void> => {
      attempts += 1;
      try {
        const final = finalState(await getPayment(bookingId));
        if (!active) return;
        if (final) {
          setState(final);
          return;
        }
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          onUnauthenticated();
          return;
        }
        // A failed poll is not the end of the payment: keep asking until the time is up.
      }
      if (attempts * POLL_INTERVAL_MS >= POLL_MAX_MS) {
        setState({ status: 'error', message: GENERIC_ERROR });
        return;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [processing, bookingId, onUnauthenticated]);

  const card = state.status === 'ready' || state.status === 'processing' ? state.payment : null;

  return (
    <main>
      <h1>Pay for your booking</h1>

      {state.status === 'loading' && <p role="status">Loading payment…</p>}

      {card && (
        <>
          <p>
            Amount to pay: <strong>{formatAmount(card.amount, card.currency)}</strong>
          </p>
          <PaymentForm
            clientSecret={card.clientSecret}
            publishableKey={card.publishableKey}
            amountLabel={formatAmount(card.amount, card.currency)}
            busy={state.status === 'processing'}
            onConfirmed={(cardError) => setState({ status: 'processing', payment: card, cardError })}
          />
          {state.status === 'processing' && (
            <p role="status">We're confirming your payment. This can take a few seconds.</p>
          )}
          {state.status === 'processing' && state.cardError && <p role="alert">{state.cardError}</p>}
        </>
      )}

      {state.status === 'succeeded' && (
        <>
          <p role="status">{SUCCEEDED_MESSAGE}</p>
          <Link to="/my-bookings">View my bookings</Link>
        </>
      )}

      {state.status === 'declined' && (
        <>
          <p role="alert">{DECLINED_MESSAGE}</p>
          <Link to="/schedule">Back to the schedule</Link>
        </>
      )}

      {state.status === 'hold' && <p role="status">{state.message}</p>}

      {state.status === 'expired' && (
        <>
          <p role="alert">{state.message}</p>
          <Link to="/schedule">Back to the schedule</Link>
        </>
      )}

      {state.status === 'error' && (
        <>
          <p role="alert">{state.message}</p>
          <button type="button" onClick={() => setReloadToken((token) => token + 1)}>
            Try again
          </button>
        </>
      )}
    </main>
  );
}
