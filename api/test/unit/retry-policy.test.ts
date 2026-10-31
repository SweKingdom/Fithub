import { describe, expect, it } from 'vitest';
import { computeNextRetryAt, holdDeadline, isExhausted } from '../../src/modules/payments/retry-policy.js';

const now = new Date('2026-03-02T10:00:00.000Z');

describe('retry policy', () => {
  describe('AC 1/AC 4: backoff', () => {
    it('waits base seconds after the first failure', () => {
      expect(computeNextRetryAt(now, 1, 60).toISOString()).toBe('2026-03-02T10:01:00.000Z');
    });

    it.each([
      [1, 1],
      [2, 2],
      [3, 4],
      [4, 8],
    ])('waits %i → %i minutes with base 60 s', (attemptCount, minutes) => {
      expect(computeNextRetryAt(now, attemptCount, 60).getTime() - now.getTime()).toBe(minutes * 60000);
    });

    it('produces the attempts at 0, 1, 3, 7 and 15 minutes', () => {
      let at = now;
      const minutesFromStart = [0];
      for (let failure = 1; failure <= 4; failure += 1) {
        at = computeNextRetryAt(at, failure, 60);
        minutesFromStart.push((at.getTime() - now.getTime()) / 60000);
      }
      expect(minutesFromStart).toEqual([0, 1, 3, 7, 15]);
    });

    it('uses the configured base', () => {
      expect(computeNextRetryAt(now, 3, 10).getTime() - now.getTime()).toBe(40000);
    });

    it.each([0, -1, 1.5])('rejects attemptCount %s', (attemptCount) => {
      expect(() => computeNextRetryAt(now, attemptCount, 60)).toThrow(RangeError);
    });
  });

  describe('AC 4: give up', () => {
    it('is not exhausted before the last attempt', () => {
      expect(isExhausted(4, 5)).toBe(false);
    });

    it('is exhausted on the 5th failure and beyond', () => {
      expect(isExhausted(5, 5)).toBe(true);
      expect(isExhausted(6, 5)).toBe(true);
    });

    it('is exhausted after a single attempt when the maximum is 1', () => {
      expect(isExhausted(1, 1)).toBe(true);
    });
  });

  describe('AC 5: hold deadline', () => {
    const bookedAt = new Date('2026-03-02T10:00:00.000Z');

    it('is booked_at plus the hold when the class starts later', () => {
      const classStart = new Date('2026-03-02T18:00:00.000Z');
      expect(holdDeadline(bookedAt, classStart, 30).toISOString()).toBe('2026-03-02T10:30:00.000Z');
    });

    it('never goes beyond the class start', () => {
      const classStart = new Date('2026-03-02T10:10:00.000Z');
      expect(holdDeadline(bookedAt, classStart, 30).toISOString()).toBe('2026-03-02T10:10:00.000Z');
    });

    it('equals the class start when both coincide', () => {
      const classStart = new Date('2026-03-02T10:30:00.000Z');
      expect(holdDeadline(bookedAt, classStart, 30).toISOString()).toBe('2026-03-02T10:30:00.000Z');
    });
  });
});
