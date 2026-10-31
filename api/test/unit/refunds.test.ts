import { describe, expect, it } from 'vitest';
import {
  classifyStripeRefundStatus,
  isRefundFailureLoggedAsError,
  refundRetryDelaySeconds,
} from '../../src/modules/payments/refunds.js';

describe('refund rules', () => {
  describe('AC 4: capped exponential backoff', () => {
    it('doubles from the base up to the cap', () => {
      const delays = [1, 2, 3, 4, 5, 6].map((n) => refundRetryDelaySeconds(n, 30, 100));
      expect(delays).toEqual([30, 60, 100, 100, 100, 100]);
    });

    it('never exceeds the cap, even for a very high attempt count', () => {
      expect(refundRetryDelaySeconds(5000, 30, 3600)).toBe(3600);
    });

    it.each([0, -1, 1.5])('rejects attempt count %s', (n) => {
      expect(() => refundRetryDelaySeconds(n, 30, 3600)).toThrow(RangeError);
    });
  });

  describe('AC 4: error level after 10 failed attempts', () => {
    it.each([
      [1, false],
      [10, false],
      [11, true],
      [50, true],
    ])('attempt %s → error level %s', (attempt, expected) => {
      expect(isRefundFailureLoggedAsError(attempt)).toBe(expected);
    });
  });

  describe('AC 1 and 5: Stripe refund status', () => {
    it.each([
      ['succeeded', 'succeeded'],
      ['pending', 'waiting'],
      ['requires_action', 'waiting'],
      ['failed', 'failed'],
      ['canceled', 'failed'],
      ['something_new', 'waiting'],
    ])('%s → %s', (status, expected) => {
      expect(classifyStripeRefundStatus(status)).toBe(expected);
    });
  });
});
