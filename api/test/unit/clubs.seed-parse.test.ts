import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClubSeedError, loadClubSeedFile, parseClubSeed } from '../../src/modules/clubs/seed.js';

const valid = (overrides: Record<string, unknown> = {}) => ({
  code: 'SODER',
  name: 'Soder',
  timezone: 'Europe/Stockholm',
  ...overrides,
});

function problemsOf(input: unknown): string[] {
  try {
    parseClubSeed(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ClubSeedError);
    return (error as ClubSeedError).problems;
  }
  throw new Error('Expected parseClubSeed to throw.');
}

describe('parseClubSeed (US-117, AC 3)', () => {
  it('accepts valid entries, trims names and ignores unknown keys', () => {
    const entries = parseClubSeed([
      valid({ name: '  Soder  ', extra: 'ignored' }),
      valid({ code: 'NORR-2', name: 'Norr', timezone: 'UTC' }),
    ]);
    expect(entries).toEqual([
      { code: 'SODER', name: 'Soder', timezone: 'Europe/Stockholm' },
      { code: 'NORR-2', name: 'Norr', timezone: 'UTC' },
    ]);
  });

  it.each([
    ['not an array', { code: 'AB' }],
    ['an empty array', []],
    ['null', null],
  ])('rejects %s', (_label, input) => {
    expect(problemsOf(input)).toEqual(['Club seed file must be a non-empty JSON array.']);
  });

  it.each([
    ['lower case', 'soder'],
    ['too short', 'A'],
    ['too long', 'A'.repeat(21)],
    ['a forbidden character', 'SO_DER'],
    ['empty', ''],
  ])('rejects a code that is %s (no auto-uppercasing)', (_label, code) => {
    expect(problemsOf([valid(), valid({ code, name: 'Other' })])).toEqual([
      'Entry 2: code must be 2–20 characters A–Z, 0–9 or "-".',
    ]);
  });

  it('rejects a missing code and an entry that is not an object', () => {
    expect(problemsOf([{ name: 'X', timezone: 'UTC' }, 'text'])).toEqual([
      'Entry 1: code must be 2–20 characters A–Z, 0–9 or "-".',
      'Entry 2: code must be 2–20 characters A–Z, 0–9 or "-".',
      'Entry 2: name is required (max 100 characters).',
      'Entry 2: unknown time zone "".',
    ]);
  });

  it('still checks name and time zone of an entry with a bad code', () => {
    expect(problemsOf([valid({ code: 'bad', name: '', timezone: 'Europe/Atlantis' })])).toEqual([
      'Entry 1: code must be 2–20 characters A–Z, 0–9 or "-".',
      'Entry 1: name is required (max 100 characters).',
      'Entry 1: unknown time zone "Europe/Atlantis".',
    ]);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['missing', undefined],
    ['not a string', 7],
    ['longer than 100 characters', 'x'.repeat(101)],
  ])('rejects a name that is %s', (_label, name) => {
    expect(problemsOf([valid({ name })])).toEqual([
      'Entry 1 (code "SODER"): name is required (max 100 characters).',
    ]);
  });

  it('accepts a name of exactly 100 characters', () => {
    expect(parseClubSeed([valid({ name: 'x'.repeat(100) })])[0]?.name).toHaveLength(100);
  });

  it('names the entry and the problem for an unknown time zone', () => {
    expect(
      problemsOf([valid(), valid({ code: 'NORR', name: 'Norr' }), valid({ code: 'SOD', name: 'S', timezone: 'Europe/Atlantis' })]),
    ).toEqual(['Entry 3 (code "SOD"): unknown time zone "Europe/Atlantis".']);
  });

  it('rejects a missing time zone', () => {
    expect(problemsOf([valid({ timezone: undefined })])).toEqual([
      'Entry 1 (code "SODER"): unknown time zone "".',
    ]);
  });

  it('rejects a duplicate code', () => {
    expect(problemsOf([valid(), valid({ name: 'Other' })])).toEqual([
      'Duplicate code "SODER" in entries 1 and 2.',
    ]);
  });

  it('rejects a duplicate name, ignoring case and surrounding spaces', () => {
    expect(problemsOf([valid(), valid({ code: 'NORR', name: ' SODER ' })])).toEqual([
      'Duplicate name "SODER" in entries 1 and 2.',
    ]);
  });

  it('collects every problem of every entry', () => {
    const problems = problemsOf([
      valid({ code: 'bad', name: 'First' }),
      valid({ code: 'AA', name: '', timezone: 'Nowhere/Land' }),
      valid({ code: 'AA', name: 'Same' }),
    ]);
    expect(problems).toEqual([
      'Entry 1: code must be 2–20 characters A–Z, 0–9 or "-".',
      'Entry 2 (code "AA"): name is required (max 100 characters).',
      'Entry 2 (code "AA"): unknown time zone "Nowhere/Land".',
      'Duplicate code "AA" in entries 2 and 3.',
    ]);
  });
});

describe('loadClubSeedFile (US-117, AC 4)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'club-seed-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('AC 4: a missing file names the path and how to create it', () => {
    const path = join(dir, 'clubs.json');
    expect(() => loadClubSeedFile(path)).toThrow(
      `Club seed file not found: ${resolve(path)}. Copy seed/clubs.example.json to seed/clubs.json and fill in the confirmed club data.`,
    );
  });

  it('rejects a file that is not valid JSON', () => {
    const path = join(dir, 'broken.json');
    writeFileSync(path, '[ { "code": ');
    expect(() => loadClubSeedFile(path)).toThrow('Club seed file must be a non-empty JSON array.');
  });

  it('reads a valid file, also with a byte order mark', () => {
    const path = join(dir, 'ok.json');
    writeFileSync(path, `${String.fromCharCode(0xfeff)}${JSON.stringify([valid()])}`);
    expect(loadClubSeedFile(path)).toEqual([valid()]);
  });

  it('validates the entries of the file', () => {
    const path = join(dir, 'bad-zone.json');
    writeFileSync(path, JSON.stringify([valid({ timezone: 'Europe/Atlantis' })]));
    expect(() => loadClubSeedFile(path)).toThrow('unknown time zone "Europe/Atlantis"');
  });

  it('accepts the committed example file', () => {
    const entries = loadClubSeedFile(resolve(import.meta.dirname, '../../seed/clubs.example.json'));
    expect(entries.map((entry) => entry.code)).toEqual(['EXAMPLE-1', 'EXAMPLE-2', 'EXAMPLE-3', 'EXAMPLE-4']);
  });
});
