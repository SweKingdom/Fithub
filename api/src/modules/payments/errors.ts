import { DomainError } from '../../shared/errors.js';

/** Booking states that can reach the payment routes with a "not payable" answer. */
export type NonPayableBookingStatus = 'confirmed' | 'cancelled';

/** Payments are switched off (`PAYMENTS_ENABLED=false`). */
export function paymentsUnavailable(): DomainError {
  return new DomainError(
    'PAYMENTS_UNAVAILABLE',
    'Online payment is not available yet. Please contact your club.',
    409,
  );
}

/** The booking is already paid (`confirmed`) or no longer exists as a place (`cancelled`). */
export function bookingNotPayable(status: NonPayableBookingStatus): DomainError {
  const message =
    status === 'confirmed'
      ? 'This booking is already paid.'
      : "This booking has been cancelled, so it can't be paid. Please book the class again.";
  return new DomainError('BOOKING_NOT_PAYABLE', message, 409);
}

/** The booking exists and belongs to the member but has no payment row (e.g. a regular member's booking). */
export function paymentNotFound(): DomainError {
  return new DomainError('PAYMENT_NOT_FOUND', 'There is no payment for this booking.', 404);
}

/** Webhook with a missing or invalid `Stripe-Signature`. Never echoes the body or the secret. */
export function invalidSignature(): DomainError {
  return new DomainError('INVALID_SIGNATURE', 'The webhook signature is missing or invalid.', 400);
}
