import type { CreditReason } from './db-types.js';
import type { BookingCancelled } from './events.js';

/** Only regular members use credits; drop-in members pay per booking and staff do not book. */
export function usesCredits(user: { role: string; memberType: string | null }): boolean {
  return user.role === 'member' && user.memberType === 'regular';
}

/** Ledger reason of the credit that a cancellation returns. Every cancellation cause must be mapped explicitly. */
export function refundReasonFor(cause: BookingCancelled['cause']): CreditReason | null {
  switch (cause) {
    case 'member_cancelled':
      return 'cancellation_refund';
    case 'class_cancelled':
      return 'class_cancelled_refund';
    default: {
      const unmapped: never = cause;
      throw new Error(`Unmapped cancellation cause: ${String(unmapped)}`);
    }
  }
}
