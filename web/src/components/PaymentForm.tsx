import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { useMemo, useState, type FormEvent } from 'react';

interface PaymentFormProps {
  clientSecret: string;
  /** From the API; `loadStripe` is only called once a key is known. */
  publishableKey: string;
  amountLabel: string;
  /** The payment was handed to Stripe and the page is waiting for the answer: the form stays, but locked. */
  busy: boolean;
  /** The card step finished. `cardError` is Stripe's message when the card was refused, otherwise null. */
  onConfirmed: (cardError: string | null) => void;
}

const FALLBACK_ERROR = 'Something went wrong. Please try again.';

function CardStep({ amountLabel, busy, onConfirmed }: Pick<PaymentFormProps, 'amountLabel' | 'busy' | 'onConfirmed'>) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setProblem(null);
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required',
      });
      // Incomplete or invalid card details: the Payment Element already says what to fix, nothing was charged.
      if (error?.type === 'validation_error') {
        setSubmitting(false);
        return;
      }
      onConfirmed(error ? (error.message ?? FALLBACK_ERROR) : null);
    } catch {
      setSubmitting(false);
      setProblem(FALLBACK_ERROR);
    }
  }

  const locked = busy || submitting;
  return (
    <form onSubmit={(event) => void submit(event)}>
      <PaymentElement />
      {problem && <p role="alert">{problem}</p>}
      <button type="submit" disabled={!stripe || !elements || locked}>
        {locked ? 'Processing payment…' : `Pay ${amountLabel}`}
      </button>
    </form>
  );
}

/** Stripe's Payment Element: card data goes from the browser to Stripe only and never reaches FitHub (SAQ A). */
export function PaymentForm({ clientSecret, publishableKey, amountLabel, busy, onConfirmed }: PaymentFormProps) {
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CardStep amountLabel={amountLabel} busy={busy} onConfirmed={onConfirmed} />
    </Elements>
  );
}
