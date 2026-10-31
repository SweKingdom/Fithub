/**
 * Refund rules that need no database or Stripe access (US-134).
 * `processDueRefunds` and `applyRefundWebhook` are added here once the payment repository,
 * gateway and `runPaymentMaintenance` (US-132, US-133) are on the branch.
 */

/** What the refund step does next with a refund whose Stripe status is known. */
export type RefundOutcome = 'succeeded' | 'waiting' | 'failed';

/** After this many failed attempts, every further failure is logged at error level (AC 4). */
export const REFUND_ERROR_LOG_THRESHOLD = 10;

/**
 * Seconds to wait after the n-th failed refund attempt (n ≥ 1):
 * `min(baseSeconds × 2^(n-1), capSeconds)` (AC 4).
 */
export function refundRetryDelaySeconds(attemptCount: number, baseSeconds: number, capSeconds: number): number {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new RangeError('attemptCount must be an integer of at least 1');
  }
  return Math.min(baseSeconds * 2 ** (attemptCount - 1), capSeconds);
}

/** True when a failed attempt must be logged at error level instead of warn level (AC 4). */
export function isRefundFailureLoggedAsError(attemptCount: number): boolean {
  return attemptCount > REFUND_ERROR_LOG_THRESHOLD;
}

/**
 * Maps a Stripe refund status to the next step. An unknown status is treated as `waiting`
 * so the webhook can still settle it; nothing is marked failed on a guess.
 */
export function classifyStripeRefundStatus(status: string): RefundOutcome {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'failed':
    case 'canceled':
      return 'failed';
    default:
      return 'waiting';
  }
}
