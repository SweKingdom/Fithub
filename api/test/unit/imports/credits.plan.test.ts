import { describe, expect, it } from 'vitest';
import { planCreditImport } from '../../../src/modules/imports/credits.plan.js';
import type { CreditSnapshot } from '../../../src/modules/imports/credits.types.js';

const row = (line: number, values: Record<string, string>) => ({ line, values });

function snapshot(overrides: Partial<CreditSnapshot> = {}): CreditSnapshot {
  return {
    aliases: new Map([
      ['L1', 'A'],
      ['L2', 'A'],
      ['L3', 'B'],
      ['LD', 'D'],
      ['LS', 'S'],
    ]),
    usersById: new Map([
      ['A', { id: 'A', role: 'member', memberType: 'regular' }],
      ['B', { id: 'B', role: 'member', memberType: 'regular' }],
      ['D', { id: 'D', role: 'member', memberType: 'drop_in' }],
      ['S', { id: 'S', role: 'instructor', memberType: null }],
    ]),
    usersByEmail: new Map([
      ['a@x.se', 'A'],
      ['b@x.se', 'B'],
      ['d@x.se', 'D'],
      ['s@x.se', 'S'],
    ]),
    migrated: new Map(),
    ...overrides,
  };
}

describe('planCreditImport (US-136)', () => {
  it('AC 1: loads a member resolved by number and by email', () => {
    const plan = planCreditImport(
      [row(2, { legacy_member_number: 'L3', credits: '8' }), row(3, { email: 'A@x.se', credits: '5' })],
      snapshot(),
    );
    expect(plan.loads).toEqual([
      { userId: 'B', line: 2, total: 8 },
      { userId: 'A', line: 3, total: 5 },
    ]);
    expect(plan).toMatchObject({ loaded: 2, creditsLoaded: 13, sourceCredits: 13, balanced: true });
  });

  it('AC 5: sums the rows of one member over several aliases and lists the later lines as merged', () => {
    const plan = planCreditImport(
      [
        row(2, { legacy_member_number: 'L1', credits: '3' }),
        row(3, { legacy_member_number: 'L2', credits: '2' }),
        row(4, { email: 'a@x.se', credits: '1' }),
      ],
      snapshot(),
    );
    expect(plan.loads).toEqual([{ userId: 'A', line: 2, total: 6 }]);
    expect(plan.loaded).toBe(1);
    expect(plan.merged).toBe(2);
    expect(plan.merges).toEqual([
      { line: 3, mergedIntoLine: 2, legacyNumber: 'L2', email: '', credits: 2 },
      { line: 4, mergedIntoLine: 2, legacyNumber: '', email: 'a@x.se', credits: 1 },
    ]);
    expect(plan.balanced).toBe(true);
  });

  it('AC 2: sourceCredits equals loaded + unchanged + rejected and rows add up, with every outcome present', () => {
    const plan = planCreditImport(
      [
        row(2, { email: 'a@x.se', credits: '4' }), // loaded
        row(3, { email: 'a@x.se', credits: '1' }), // merged
        row(4, { email: 'b@x.se', credits: '7' }), // unchanged
        row(5, { email: 'nobody@x.se', credits: '9' }), // rejected, value counted
        row(6, { email: 'd@x.se', credits: '2' }), // rejected, value counted
        row(7, { email: 'a@x.se', credits: 'abc' }), // rejected, value not counted
        row(8, { legacy_member_number: 'LD', email: 'b@x.se', credits: '0' }), // ambiguous
      ],
      snapshot({ migrated: new Map([['B', 7]]) }),
    );
    expect(plan).toMatchObject({
      sourceRows: 7,
      loaded: 1,
      unchanged: 1,
      merged: 1,
      zero: 0,
      rejected: 4,
      sourceCredits: 23,
      creditsLoaded: 5,
      creditsUnchanged: 7,
      creditsRejected: 11,
      balanced: true,
    });
    expect(plan.loaded + plan.unchanged + plan.merged + plan.zero + plan.rejected).toBe(plan.sourceRows);
  });

  it('AC 3: an equal existing migration total is unchanged and writes nothing', () => {
    const plan = planCreditImport([row(2, { email: 'a@x.se', credits: '8' })], snapshot({ migrated: new Map([['A', 8]]) }));
    expect(plan).toMatchObject({ loaded: 0, unchanged: 1, creditsLoaded: 0, creditsUnchanged: 8, balanced: true });
    expect(plan.loads).toEqual([]);
  });

  it('AC 3: a different existing total rejects every row of the member, merged rows included', () => {
    const plan = planCreditImport(
      [row(2, { legacy_member_number: 'L1', credits: '3' }), row(3, { legacy_member_number: 'L2', credits: '2' })],
      snapshot({ migrated: new Map([['A', 8]]) }),
    );
    expect(plan.loads).toEqual([]);
    expect(plan.merged).toBe(0);
    expect(plan.rejected).toBe(2);
    expect(plan.rejectedByReason).toEqual({ ALREADY_MIGRATED_DIFFERENT_TOTAL: 2 });
    expect(plan.rejections[0].message).toBe(
      'Member already has migrated credits (8) that differ from this file (5). Correct manually.',
    );
    expect(plan).toMatchObject({ creditsRejected: 5, sourceCredits: 5, balanced: true });
  });

  it('AC 4: an unknown number or email is MEMBER_NOT_FOUND with its line', () => {
    const plan = planCreditImport(
      [row(2, { legacy_member_number: 'NOPE', credits: '1' }), row(5, { email: 'x@x.se', credits: '2' })],
      snapshot(),
    );
    expect(plan.rejections.map((r) => [r.line, r.reason])).toEqual([
      [2, 'MEMBER_NOT_FOUND'],
      [5, 'MEMBER_NOT_FOUND'],
    ]);
    expect(plan.loads).toEqual([]);
  });

  it('AC 6: resolves by the reference that matches when the other matches nothing', () => {
    const plan = planCreditImport([row(2, { legacy_member_number: 'NOPE', email: 'a@x.se', credits: '1' })], snapshot());
    expect(plan.loads).toEqual([{ userId: 'A', line: 2, total: 1 }]);
  });

  it('AC 6: a number and an email of two different members are AMBIGUOUS_MEMBER', () => {
    const plan = planCreditImport([row(2, { legacy_member_number: 'L1', email: 'b@x.se', credits: '1' })], snapshot());
    expect(plan.rejections[0]).toMatchObject({ reason: 'AMBIGUOUS_MEMBER', credits: 1 });
  });

  it('AC 6: drop-in and staff targets are MEMBER_NOT_CREDIT_USER', () => {
    const plan = planCreditImport(
      [row(2, { email: 'd@x.se', credits: '1' }), row(3, { legacy_member_number: 'LS', credits: '1' })],
      snapshot(),
    );
    expect(plan.rejections.map((r) => r.reason)).toEqual(['MEMBER_NOT_CREDIT_USER', 'MEMBER_NOT_CREDIT_USER']);
    expect(plan.loads).toEqual([]);
  });

  it('AC 6: a rejected row does not stop the valid rows of the same member', () => {
    const plan = planCreditImport(
      [row(2, { email: 'a@x.se', credits: '-3' }), row(3, { email: 'a@x.se', credits: '5' })],
      snapshot(),
    );
    expect(plan.loads).toEqual([{ userId: 'A', line: 3, total: 5 }]);
    expect(plan).toMatchObject({ loaded: 1, rejected: 1, merged: 0, sourceCredits: 5, balanced: true });
  });

  it('AC 7: zero credits write nothing and count as zero', () => {
    const plan = planCreditImport([row(2, { email: 'a@x.se', credits: '0' })], snapshot());
    expect(plan.loads).toEqual([]);
    expect(plan).toMatchObject({ zero: 1, loaded: 0, sourceCredits: 0, balanced: true });
  });

  it('AC 7: zero credits for a member with an existing migration row are not a conflict', () => {
    const plan = planCreditImport([row(2, { email: 'a@x.se', credits: '0' })], snapshot({ migrated: new Map([['A', 8]]) }));
    expect(plan).toMatchObject({ zero: 1, rejected: 0 });
  });

  it('counts a repeated line of an already-correct member as merged and its credits as unchanged', () => {
    const plan = planCreditImport(
      [row(2, { email: 'a@x.se', credits: '3' }), row(3, { email: 'a@x.se', credits: '2' })],
      snapshot({ migrated: new Map([['A', 5]]) }),
    );
    expect(plan).toMatchObject({ unchanged: 1, merged: 1, creditsUnchanged: 5, balanced: true });
  });

  it('handles an empty row list without error', () => {
    expect(planCreditImport([], snapshot())).toMatchObject({ sourceRows: 0, balanced: true, loads: [] });
  });
});
