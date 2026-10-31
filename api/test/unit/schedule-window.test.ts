import { describe, expect, it } from 'vitest';
import { computeWindow, SCHEDULE_WINDOW_DAYS } from '../../src/modules/classes/schedule-window.js';

const NOW = new Date('2026-10-30T09:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

describe('computeWindow', () => {
  it('defaults to now … now + 14 days', () => {
    const w = computeWindow(NOW);
    expect(SCHEDULE_WINDOW_DAYS).toBe(14);
    expect(w.from).toEqual(NOW);
    expect(w.to).toEqual(at(14 * DAY_MS));
    expect(w.empty).toBe(false);
  });

  it('narrows to from/to inside the window', () => {
    const w = computeWindow(NOW, at(DAY_MS), at(3 * DAY_MS));
    expect(w.from).toEqual(at(DAY_MS));
    expect(w.to).toEqual(at(3 * DAY_MS));
    expect(w.empty).toBe(false);
  });

  it('clamps from to now and to to now + 14 days', () => {
    const w = computeWindow(NOW, at(-5 * DAY_MS), at(30 * DAY_MS));
    expect(w.from).toEqual(NOW);
    expect(w.to).toEqual(at(14 * DAY_MS));
    expect(w.empty).toBe(false);
  });

  it('is empty when both from and to are in the past', () => {
    const w = computeWindow(NOW, at(-5 * DAY_MS), at(-DAY_MS));
    expect(w.from).toEqual(NOW);
    expect(w.empty).toBe(true);
  });

  it('is empty when from is after the window end', () => {
    expect(computeWindow(NOW, at(20 * DAY_MS), at(30 * DAY_MS)).empty).toBe(true);
  });

  it('is empty when to equals now', () => {
    expect(computeWindow(NOW, undefined, NOW).empty).toBe(true);
  });

  it('uses 24-hour days, not calendar days, across a DST change', () => {
    const now = new Date('2026-10-20T12:00:00.000Z');
    expect(computeWindow(now).to).toEqual(new Date(now.getTime() + 14 * DAY_MS));
  });
});
