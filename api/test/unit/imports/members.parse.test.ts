import { describe, expect, it } from 'vitest';
import type { CsvRow } from '../../../src/modules/imports/csv.js';
import type { MemberType } from '../../../src/modules/imports/member-type-map.js';
import { parseMemberRow, type ParseContext } from '../../../src/modules/imports/members.parse.js';

const ctx: ParseContext = {
  typeMap: new Map<string, MemberType>([
    ['regular', 'regular'],
    ['drop-in', 'drop_in'],
  ]),
  clubsByCode: new Map([['STH', 'club-1']]),
};

function row(values: Record<string, string>, line = 2): CsvRow {
  return {
    line,
    values: {
      email: 'anna@x.se',
      full_name: 'Anna Lind',
      member_type: 'regular',
      legacy_member_number: '',
      home_club_code: '',
      ...values,
    },
  };
}

function rejectionOf(values: Record<string, string>) {
  const result = parseMemberRow(row(values), ctx);
  if (result.ok) throw new Error('expected a rejection');
  return result.rejection;
}

describe('parseMemberRow (US-135)', () => {
  it('AC 1: normalises a valid row', () => {
    const result = parseMemberRow(
      row({
        email: ' Anna@X.se ',
        full_name: '  Anna   Lind ',
        member_type: ' Drop-In ',
        legacy_member_number: ' L1 ',
        home_club_code: ' sth ',
      }),
      ctx,
    );
    expect(result).toEqual({
      ok: true,
      member: {
        line: 2,
        email: 'anna@x.se',
        rawEmail: 'Anna@X.se',
        fullName: 'Anna Lind',
        memberType: 'drop_in',
        clubId: 'club-1',
        legacyNumber: 'L1',
      },
    });
  });

  it('AC 1: empty legacy number and home club become null', () => {
    const result = parseMemberRow(row({}), ctx);
    expect(result.ok && result.member.legacyNumber).toBeNull();
    expect(result.ok && result.member.clubId).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['not an address', 'anna'],
    ['no domain', 'anna@'],
    ['too long', `${'a'.repeat(250)}@x.se`],
  ])('AC 5: INVALID_EMAIL when the email is %s', (_label, email) => {
    expect(rejectionOf({ email })).toMatchObject({ reason: 'INVALID_EMAIL', message: 'Email is missing or invalid.' });
  });

  it('AC 5: INVALID_NAME for an empty or too long name', () => {
    expect(rejectionOf({ full_name: '   ' }).reason).toBe('INVALID_NAME');
    expect(rejectionOf({ full_name: 'a'.repeat(201) }).reason).toBe('INVALID_NAME');
  });

  it('AC 5: UNMAPPED_MEMBER_TYPE for a value outside the map or an empty value (no default)', () => {
    expect(rejectionOf({ member_type: 'gold' })).toMatchObject({
      reason: 'UNMAPPED_MEMBER_TYPE',
      message: 'Membership type "gold" is not in the member type map.',
    });
    expect(rejectionOf({ member_type: '' }).reason).toBe('UNMAPPED_MEMBER_TYPE');
  });

  it('INVALID_LEGACY_NUMBER above 64 characters', () => {
    expect(rejectionOf({ legacy_member_number: 'L'.repeat(65) }).reason).toBe('INVALID_LEGACY_NUMBER');
  });

  it('AC 5: UNKNOWN_CLUB for a code that does not exist', () => {
    expect(rejectionOf({ home_club_code: 'xyz' })).toMatchObject({
      reason: 'UNKNOWN_CLUB',
      message: 'Home club code "XYZ" does not exist.',
    });
  });

  it('reports the first failure in the documented order and the raw trimmed values', () => {
    const rejection = rejectionOf({ email: ' bad ', full_name: '', member_type: 'gold', legacy_member_number: ' L9 ' });
    expect(rejection).toMatchObject({ line: 2, reason: 'INVALID_EMAIL', email: 'bad', legacyNumber: 'L9' });
  });
});
