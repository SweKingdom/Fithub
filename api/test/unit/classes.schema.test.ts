import { describe, expect, it } from 'vitest';
import { createClassBodySchema } from '../../src/modules/classes/routes.js';
import { CLASS_MESSAGES } from '../../src/modules/classes/errors.js';
import type { Clock } from '../../src/shared/clock.js';

const clock: Clock = { now: () => new Date('2026-11-01T10:00:00Z') };
const schema = createClassBodySchema(clock);

const valid = {
  clubId: '11111111-1111-4111-8111-111111111111',
  name: 'Spinning 45',
  startAt: '2026-11-02T17:00:00Z',
  durationMinutes: 45,
  capacity: 20,
};

/** One message per field, taken from the first issue of that field (as the error handler does). */
function fieldMessages(body: unknown): Record<string, string> {
  const result = schema.safeParse(body);
  if (result.success) return {};
  const messages: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0]);
    messages[field] ??= issue.message;
  }
  return messages;
}

describe('createClassBodySchema', () => {
  it('AC 1: accepts a valid class and trims the name', () => {
    const result = schema.parse({ ...valid, name: '  Spinning 45  ' });
    expect(result.name).toBe('Spinning 45');
    expect(result.capacity).toBe(20);
  });

  it('AC 1: strips server-controlled keys', () => {
    const result = schema.parse({ ...valid, status: 'cancelled', createdBy: 'x', created_by: 'y' });
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('createdBy');
    expect(result).not.toHaveProperty('created_by');
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['missing', undefined],
    ['not a string', 7],
  ])('AC 2: name %s is rejected', (_label, name) => {
    expect(fieldMessages({ ...valid, name })).toEqual({ name: CLASS_MESSAGES.nameRequired });
  });

  it.each([0, -3])('AC 3: capacity %s is rejected', (capacity) => {
    expect(fieldMessages({ ...valid, capacity })).toEqual({ capacity: CLASS_MESSAGES.capacityTooLow });
  });

  it.each([
    ['missing', undefined],
    ['fraction', 2.5],
    ['text', 'ten'],
  ])('AC 4: capacity %s is not a whole number', (_label, capacity) => {
    expect(fieldMessages({ ...valid, capacity })).toEqual({
      capacity: CLASS_MESSAGES.capacityNotInteger,
    });
  });

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['negative', -5],
    ['fraction', 1.5],
    ['text', '45'],
  ])('AC 4: duration %s is rejected', (_label, durationMinutes) => {
    expect(fieldMessages({ ...valid, durationMinutes })).toEqual({
      durationMinutes: CLASS_MESSAGES.durationInvalid,
    });
  });

  it.each([
    ['missing', undefined],
    ['not a date', 'tomorrow'],
    ['no offset', '2026-11-02T17:00:00'],
    ['date only', '2026-11-02'],
    ['number', 12345],
  ])('AC 4: start time %s is invalid', (_label, startAt) => {
    expect(fieldMessages({ ...valid, startAt })).toEqual({ startAt: CLASS_MESSAGES.startInvalid });
  });

  it.each([
    ['in the past', '2026-10-31T17:00:00Z'],
    ['exactly now', '2026-11-01T10:00:00Z'],
  ])('AC 4: start time %s is rejected', (_label, startAt) => {
    expect(fieldMessages({ ...valid, startAt })).toEqual({ startAt: CLASS_MESSAGES.startInPast });
  });

  it('AC 4: accepts an offset start time that is later than now', () => {
    expect(schema.safeParse({ ...valid, startAt: '2026-11-02T18:00:00+01:00' }).success).toBe(true);
  });

  it('AC 4: name of 100 characters is accepted, 101 is rejected', () => {
    expect(schema.safeParse({ ...valid, name: 'a'.repeat(100) }).success).toBe(true);
    expect(fieldMessages({ ...valid, name: 'a'.repeat(101) })).toEqual({
      name: CLASS_MESSAGES.nameTooLong,
    });
  });

  it('AC 4: the length is checked after trimming', () => {
    expect(schema.safeParse({ ...valid, name: ` ${'a'.repeat(100)} ` }).success).toBe(true);
  });

  it('AC 4: returns all errors of one request together', () => {
    expect(
      fieldMessages({ ...valid, name: '', capacity: 0, durationMinutes: 0, startAt: '2026-10-01T10:00:00Z' }),
    ).toEqual({
      name: CLASS_MESSAGES.nameRequired,
      capacity: CLASS_MESSAGES.capacityTooLow,
      durationMinutes: CLASS_MESSAGES.durationInvalid,
      startAt: CLASS_MESSAGES.startInPast,
    });
  });

  it('AC 7: a malformed instructorId is rejected, null and absent are accepted', () => {
    expect(fieldMessages({ ...valid, instructorId: 'not-a-uuid' })).toEqual({
      instructorId: CLASS_MESSAGES.instructorInvalid,
    });
    expect(schema.safeParse({ ...valid, instructorId: null }).success).toBe(true);
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it('rejects a missing or malformed club id', () => {
    expect(fieldMessages({ ...valid, clubId: undefined })).toEqual({ clubId: CLASS_MESSAGES.clubRequired });
    expect(fieldMessages({ ...valid, clubId: 'abc' })).toEqual({ clubId: CLASS_MESSAGES.clubRequired });
  });
});
