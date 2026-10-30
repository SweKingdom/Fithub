import { describe, expect, it } from 'vitest';
import { holdExpiresAt, paymentMessage, toPaymentDto, type PaymentDtoSource } from '../../src/modules/payments/dto.js';

const credentials = { clientSecret: 'pi_1_secret_fake', publishableKey: 'pk_test_fake' };
const hold = new Date('2026-11-01T10:30:00.000Z');

function row(overrides: Partial<PaymentDtoSource> = {}): PaymentDtoSource {
  return { status: 'requires_payment', amount: 1500, currency: 'eur', next_retry_at: null, ...overrides };
}

describe('payment DTO', () => {
  describe('AC 1: payment started', () => {
    it('exposes the client secret and publishable key for requires_payment', () => {
      expect(toPaymentDto(row(), hold, credentials)).toEqual({
        status: 'requires_payment',
        amount: 1500,
        currency: 'eur',
        clientSecret: 'pi_1_secret_fake',
        publishableKey: 'pk_test_fake',
        holdExpiresAt: '2026-11-01T10:30:00.000Z',
        nextRetryAt: null,
        message: null,
      });
    });
  });

  describe('AC 8: GET returns the DTO without clientSecret', () => {
    it('leaves both credentials null when none are passed', () => {
      const dto = toPaymentDto(row(), hold);
      expect(dto.clientSecret).toBeNull();
      expect(dto.publishableKey).toBeNull();
    });

    it.each(['pending_retry', 'succeeded', 'failed', 'expired', 'refunded'] as const)(
      'never exposes credentials for %s, even when passed',
      (status) => {
        const dto = toPaymentDto(row({ status, next_retry_at: new Date() }), hold, credentials);
        expect(dto.clientSecret).toBeNull();
        expect(dto.publishableKey).toBeNull();
      },
    );
  });

  describe('messages', () => {
    it('maps pending_retry, failed and expired to their member-facing text', () => {
      expect(paymentMessage('pending_retry')).toBe(
        "We couldn't reach our payment provider. Your booking is on hold and we'll retry automatically – you don't need to book again.",
      );
      expect(paymentMessage('failed')).toBe('Your payment was declined. Your booking was not confirmed.');
      expect(paymentMessage('expired')).toBe(
        'Your booking was cancelled because the payment was not completed in time.',
      );
    });

    it.each(['requires_payment', 'succeeded', 'refunded'] as const)('has no message for %s', (status) => {
      expect(paymentMessage(status)).toBeNull();
    });
  });

  describe('nextRetryAt', () => {
    it('is the retry time for pending_retry and null otherwise', () => {
      const retryAt = new Date('2026-11-01T10:05:00.000Z');
      expect(toPaymentDto(row({ status: 'pending_retry', next_retry_at: retryAt }), hold).nextRetryAt).toBe(
        '2026-11-01T10:05:00.000Z',
      );
      expect(toPaymentDto(row({ status: 'succeeded', next_retry_at: retryAt }), hold).nextRetryAt).toBeNull();
    });
  });

  describe('holdExpiresAt', () => {
    const bookedAt = new Date('2026-11-01T10:00:00.000Z');

    it('is booked_at plus the hold when the class starts later', () => {
      const start = new Date('2026-11-02T10:00:00.000Z');
      expect(holdExpiresAt(bookedAt, start, 30).toISOString()).toBe('2026-11-01T10:30:00.000Z');
    });

    it('never passes the class start', () => {
      const start = new Date('2026-11-01T10:10:00.000Z');
      expect(holdExpiresAt(bookedAt, start, 30).toISOString()).toBe('2026-11-01T10:10:00.000Z');
    });

    it('equals the class start when both coincide', () => {
      const start = new Date('2026-11-01T10:30:00.000Z');
      expect(holdExpiresAt(bookedAt, start, 30).toISOString()).toBe('2026-11-01T10:30:00.000Z');
    });
  });
});
