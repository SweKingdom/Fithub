import { describe, expect, it } from 'vitest';
import { parseCreditRow } from '../../../src/modules/imports/credits.parse.js';

const row = (values: Record<string, string>, line = 2) => ({ line, values });

describe('parseCreditRow (US-136)', () => {
  it('accepts a number and credits', () => {
    expect(parseCreditRow(row({ legacy_member_number: ' L1 ', credits: ' 8 ' }))).toEqual({
      line: 2,
      legacyNumber: 'L1',
      email: null,
      credits: 8,
    });
  });

  it('accepts an email and normalises it (trim + lower-case)', () => {
    expect(parseCreditRow(row({ email: ' Anna@X.se ', credits: '3' }))).toEqual({
      line: 2,
      legacyNumber: null,
      email: 'anna@x.se',
      credits: 3,
    });
  });

  it('AC 7: accepts 0 as a valid value', () => {
    expect(parseCreditRow(row({ email: 'a@x.se', credits: '0' }))).toMatchObject({ credits: 0 });
  });

  it.each(['-1', '2.5', '2,5', 'abc', '', '  ', '1e3', '+4', '1000000', '0x10'])(
    'AC 6: rejects credits value %j as INVALID_CREDITS without a value',
    (credits) => {
      expect(parseCreditRow(row({ email: 'a@x.se', credits }))).toMatchObject({
        reason: 'INVALID_CREDITS',
        message: 'Credits must be a whole number of 0 or more.',
        credits: null,
      });
    },
  );

  it('accepts the largest allowed value', () => {
    expect(parseCreditRow(row({ email: 'a@x.se', credits: '999999' }))).toMatchObject({ credits: 999999 });
  });

  it('AC 6: rejects a row with neither number nor email, keeping the valid value', () => {
    expect(parseCreditRow(row({ legacy_member_number: ' ', email: '', credits: '4' }))).toMatchObject({
      reason: 'MISSING_MEMBER_REFERENCE',
      message: 'Row has neither legacy member number nor email.',
      credits: 4,
    });
  });

  it('treats absent optional columns as empty', () => {
    expect(parseCreditRow(row({ credits: '4' }))).toMatchObject({ reason: 'MISSING_MEMBER_REFERENCE' });
  });

  it('reports INVALID_CREDITS before MISSING_MEMBER_REFERENCE (first failure wins)', () => {
    expect(parseCreditRow(row({ credits: 'x' }))).toMatchObject({ reason: 'INVALID_CREDITS' });
  });

  it('keeps the raw trimmed values for the rejection report', () => {
    expect(parseCreditRow(row({ legacy_member_number: ' L9 ', email: ' A@x.se ', credits: '-2' }))).toMatchObject({
      legacyNumber: 'L9',
      email: 'a@x.se',
      creditsRaw: '-2',
    });
  });
});
