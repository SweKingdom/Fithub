import { describe, expect, it } from 'vitest';
import type { CsvRow } from '../../../src/modules/imports/csv.js';
import type { MemberType } from '../../../src/modules/imports/member-type-map.js';
import type { ParseContext } from '../../../src/modules/imports/members.parse.js';
import {
  planMemberImport,
  type MemberSnapshot,
  type SnapshotUser,
} from '../../../src/modules/imports/members.plan.js';

const ctx: ParseContext = {
  typeMap: new Map<string, MemberType>([
    ['regular', 'regular'],
    ['drop_in', 'drop_in'],
  ]),
  clubsByCode: new Map([
    ['STH', 'club-1'],
    ['GBG', 'club-2'],
  ]),
};

function row(line: number, values: Record<string, string>): CsvRow {
  return {
    line,
    values: {
      email: 'anna@x.se',
      full_name: 'Anna Lind',
      member_type: 'regular',
      legacy_member_number: '',
      home_club_code: 'STH',
      ...values,
    },
  };
}

function snapshot(users: SnapshotUser[] = [], aliases: Array<[string, string]> = []): MemberSnapshot {
  return {
    usersByEmail: new Map(users.map((u) => [u.email, u])),
    usersById: new Map(users.map((u) => [u.id, u])),
    aliases: new Map(aliases),
  };
}

function user(overrides: Partial<SnapshotUser> = {}): SnapshotUser {
  return {
    id: 'u1',
    email: 'anna@x.se',
    fullName: 'Anna Lind',
    role: 'member',
    memberType: 'regular',
    clubId: 'club-1',
    legacyMemberId: null,
    ...overrides,
  };
}

function expectBalanced(plan: ReturnType<typeof planMemberImport>): void {
  expect(plan.inserted + plan.updated + plan.unchanged + plan.merged + plan.rejected).toBe(plan.sourceRows);
  expect(plan.balanced).toBe(true);
}

describe('planMemberImport (US-135)', () => {
  it('AC 1: inserts valid rows with distinct emails as members without a password', () => {
    const plan = planMemberImport(
      [row(2, { email: 'a@x.se', legacy_member_number: 'L1' }), row(3, { email: 'b@x.se', home_club_code: '' })],
      ctx,
      snapshot(),
    );
    expect(plan.inserted).toBe(2);
    expect(plan.inserts[0]).toEqual({
      line: 2,
      row: {
        email: 'a@x.se',
        full_name: 'Anna Lind',
        role: 'member',
        member_type: 'regular',
        club_id: 'club-1',
        legacy_member_id: 'L1',
        password_hash: null,
      },
      aliases: ['L1'],
    });
    expect(plan.inserts[1].row).toMatchObject({ club_id: null, legacy_member_id: null });
    expect(plan.inserts[1].aliases).toEqual([]);
    expectBalanced(plan);
  });

  it('AC 2: merges rows with the same email, keeps the first number and aliases both', () => {
    const plan = planMemberImport(
      [
        row(2, { email: 'Anna@x.se', legacy_member_number: 'L1' }),
        row(3, { email: ' anna@x.se ', legacy_member_number: 'L2' }),
      ],
      ctx,
      snapshot(),
    );
    expect(plan.inserted).toBe(1);
    expect(plan.inserts[0].row.legacy_member_id).toBe('L1');
    expect(plan.inserts[0].aliases).toEqual(['L1', 'L2']);
    expect(plan.merges).toEqual([{ line: 3, mergedIntoLine: 2, email: 'anna@x.se', legacyNumber: 'L2' }]);
    expect(plan.merged).toBe(1);
    expectBalanced(plan);
  });

  it.each([
    ['full name', { full_name: 'Anna Berg' }],
    ['membership type', { member_type: 'drop_in' }],
    ['home club', { home_club_code: 'GBG' }],
  ])('AC 3: rejects both rows when the %s differs', (field, change) => {
    const plan = planMemberImport([row(2, {}), row(3, change)], ctx, snapshot([user()]));
    expect(plan.rejections.map((r) => [r.line, r.reason])).toEqual([
      [2, 'CONFLICTING_DUPLICATE'],
      [3, 'CONFLICTING_DUPLICATE'],
    ]);
    expect(plan.rejections[0].message).toBe(`Same email as line(s) 3 but different ${field}.`);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([]);
    expectBalanced(plan);
  });

  it('AC 3: treats a name that differs only in letter case or spacing as the same', () => {
    const plan = planMemberImport([row(2, {}), row(3, { full_name: ' anna   LIND' })], ctx, snapshot());
    expect(plan.inserted).toBe(1);
    expect(plan.merged).toBe(1);
  });

  it('AC 5: rejects every row of a legacy number used with two emails', () => {
    const plan = planMemberImport(
      [
        row(2, { email: 'a@x.se', legacy_member_number: 'L1' }),
        row(3, { email: 'b@x.se', legacy_member_number: 'L1' }),
        row(4, { email: 'c@x.se', legacy_member_number: 'L3' }),
      ],
      ctx,
      snapshot(),
    );
    expect(plan.rejections.map((r) => [r.line, r.reason])).toEqual([
      [2, 'LEGACY_NUMBER_REUSED'],
      [3, 'LEGACY_NUMBER_REUSED'],
    ]);
    expect(plan.rejections[0].message).toBe('Legacy member number L1 is used with different emails on lines 2, 3.');
    expect(plan.inserted).toBe(1);
    expectBalanced(plan);
  });

  it('AC 5: reports parse failures with their reason and counts them', () => {
    const plan = planMemberImport(
      [
        row(2, { email: 'bad' }),
        row(3, { full_name: '' }),
        row(4, { member_type: 'gold' }),
        row(5, { home_club_code: 'NOPE' }),
      ],
      ctx,
      snapshot(),
    );
    expect(plan.rejections.map((r) => r.reason)).toEqual([
      'INVALID_EMAIL',
      'INVALID_NAME',
      'UNMAPPED_MEMBER_TYPE',
      'UNKNOWN_CLUB',
    ]);
    expect(plan.inserted).toBe(0);
    expect(plan.rejectedByReason).toEqual({
      INVALID_EMAIL: 1,
      INVALID_NAME: 1,
      UNMAPPED_MEMBER_TYPE: 1,
      UNKNOWN_CLUB: 1,
    });
    expectBalanced(plan);
  });

  it('AC 6: rejects an email that belongs to staff and plans no change', () => {
    const plan = planMemberImport(
      [row(2, {}), row(3, {})],
      ctx,
      snapshot([user({ role: 'instructor', memberType: null })]),
    );
    expect(plan.rejections.map((r) => r.reason)).toEqual(['EMAIL_USED_BY_STAFF', 'EMAIL_USED_BY_STAFF']);
    expect(plan.updates).toEqual([]);
    expect(plan.merged).toBe(0);
    expectBalanced(plan);
  });

  it('AC 4: an unchanged existing member with all aliases is unchanged', () => {
    const plan = planMemberImport(
      [row(2, { legacy_member_number: 'L1' })],
      ctx,
      snapshot([user({ legacyMemberId: 'L1' })], [['L1', 'u1']]),
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.updated).toBe(0);
    expect(plan.inserted).toBe(0);
    expectBalanced(plan);
  });

  it('AC 4: a corrected name updates the matched member in place', () => {
    const plan = planMemberImport([row(2, { full_name: 'Anna Berg' })], ctx, snapshot([user()]));
    expect(plan.updates).toEqual([{ line: 2, userId: 'u1', patch: { full_name: 'Anna Berg' }, newAliases: [] }]);
    expect(plan.inserted).toBe(0);
  });

  it('updates type and club, and sets the club to null for an empty source value', () => {
    const plan = planMemberImport(
      [row(2, { member_type: 'drop_in', home_club_code: '' })],
      ctx,
      snapshot([user()]),
    );
    expect(plan.updates[0].patch).toEqual({ member_type: 'drop_in', club_id: null });
  });

  it('sets the legacy number only when it is currently null and adds the missing alias', () => {
    const plan = planMemberImport([row(2, { legacy_member_number: 'L7' })], ctx, snapshot([user()]));
    expect(plan.updates[0]).toMatchObject({ patch: { legacy_member_id: 'L7' }, newAliases: ['L7'] });
    const kept = planMemberImport(
      [row(2, { legacy_member_number: 'L8' })],
      ctx,
      snapshot([user({ legacyMemberId: 'L7' })], [['L7', 'u1']]),
    );
    expect(kept.updates[0].patch).toEqual({});
    expect(kept.updates[0].newAliases).toEqual(['L8']);
  });

  it('matches by alias, updates the email and keeps the member id', () => {
    const plan = planMemberImport(
      [row(2, { email: 'new@x.se', legacy_member_number: 'L1' })],
      ctx,
      snapshot([user({ legacyMemberId: 'L1' })], [['L1', 'u1']]),
    );
    expect(plan.updates).toEqual([{ line: 2, userId: 'u1', patch: { email: 'new@x.se' }, newAliases: [] }]);
  });

  it('rejects a number linked to another member than the one matched by email', () => {
    const plan = planMemberImport(
      [row(2, { legacy_member_number: 'L1' })],
      ctx,
      snapshot([user(), user({ id: 'u2', email: 'other@x.se', legacyMemberId: 'L1' })], [['L1', 'u2']]),
    );
    expect(plan.rejections[0]).toMatchObject({
      reason: 'LEGACY_NUMBER_BELONGS_TO_OTHER_MEMBER',
      message: 'Legacy member number L1 is already linked to a different member.',
    });
    expect(plan.updates).toEqual([]);
  });

  it('rejects a group whose numbers belong to two different members', () => {
    const plan = planMemberImport(
      [row(2, { legacy_member_number: 'L1' }), row(3, { legacy_member_number: 'L2' })],
      ctx,
      snapshot(
        [user({ id: 'u1', email: 'a@x.se' }), user({ id: 'u2', email: 'b@x.se' })],
        [
          ['L1', 'u1'],
          ['L2', 'u2'],
        ],
      ),
    );
    expect(plan.rejections.map((r) => r.reason)).toEqual([
      'LEGACY_NUMBER_BELONGS_TO_OTHER_MEMBER',
      'LEGACY_NUMBER_BELONGS_TO_OTHER_MEMBER',
    ]);
  });

  it('AC 7: the sum of the outcomes equals the source rows for a mixed file', () => {
    const plan = planMemberImport(
      [
        row(2, { email: 'a@x.se' }),
        row(3, { email: 'a@x.se' }),
        row(4, { email: 'b@x.se', full_name: 'B' }),
        row(5, { email: 'b@x.se', full_name: 'C' }),
        row(6, { email: 'bad' }),
        row(7, { email: 'anna@x.se' }),
        row(8, { email: 'new@x.se' }),
      ],
      ctx,
      snapshot([user()]),
    );
    expect(plan.sourceRows).toBe(7);
    expect([plan.inserted, plan.updated, plan.unchanged, plan.merged, plan.rejected]).toEqual([2, 0, 1, 1, 3]);
    expectBalanced(plan);
  });
});
