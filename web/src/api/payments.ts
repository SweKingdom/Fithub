import { apiFetch } from './client';

export type PaymentStatus = 'pending_retry' | 'requires_payment' | 'succeeded' | 'failed' | 'expired' | 'refunded';

export interface Payment {
  status: PaymentStatus;
  /** Minor units. */
  amount: number;
  /** Lower-case ISO 4217 code. */
  currency: string;
  /** Only in the answer of `resumePayment`, and only while `status` is `requires_payment`. */
  clientSecret: string | null;
  publishableKey: string | null;
  holdExpiresAt: string;
  nextRetryAt: string | null;
  message: string | null;
}

/** The state of the booking's payment, without Stripe credentials. The pay page polls this after the card step. */
export function getPayment(bookingId: string): Promise<Payment> {
  return apiFetch<Payment>(`/api/bookings/${bookingId}/payment`);
}

/** Opens or resumes the payment: returns the PaymentIntent's client secret and the publishable key to show the card form. */
export function resumePayment(bookingId: string): Promise<Payment> {
  return apiFetch<Payment>(`/api/bookings/${bookingId}/payment`, { method: 'POST' });
}
