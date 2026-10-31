import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql, type Kysely } from 'kysely';
import type { ClubDatabase } from './db-types.js';

const CODE_PATTERN = /^[A-Z0-9-]{2,20}$/;
const NAME_MAX_LENGTH = 100;
const EXAMPLE_HINT = 'Copy seed/clubs.example.json to seed/clubs.json and fill in the confirmed club data.';

export interface ClubSeedEntry {
  code: string;
  name: string;
  timezone: string;
}

export interface ClubSeedResult {
  inserted: number;
  updated: number;
  unchanged: number;
  warnings: string[];
}

/** A seed file problem. Nothing was written. `problems` holds one message per line to print. */
export class ClubSeedError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join('\n'));
    this.name = 'ClubSeedError';
    this.problems = problems;
  }
}

function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates the parsed seed file. Collects every problem and throws them together; unknown keys are
 * ignored. Entry numbers in messages are 1-based. Names are stored trimmed.
 */
export function parseClubSeed(input: unknown): ClubSeedEntry[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ClubSeedError(['Club seed file must be a non-empty JSON array.']);
  }

  const problems: string[] = [];
  const entries: ClubSeedEntry[] = [];
  const codeAt = new Map<string, number>();
  const nameAt = new Map<string, number>();

  input.forEach((raw: unknown, index: number) => {
    const n = index + 1;
    const record: Record<string, unknown> =
      typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

    const code = record.code;
    if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
      problems.push(`Entry ${n}: code must be 2–20 characters A–Z, 0–9 or "-".`);
      return;
    }
    const label = `Entry ${n} (code "${code}")`;
    let valid = true;

    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
      problems.push(`${label}: name is required (max ${NAME_MAX_LENGTH} characters).`);
      valid = false;
    }

    const timezone = typeof record.timezone === 'string' ? record.timezone : '';
    if (!isKnownTimeZone(timezone)) {
      problems.push(`${label}: unknown time zone "${timezone}".`);
      valid = false;
    }

    const firstWithCode = codeAt.get(code);
    if (firstWithCode === undefined) {
      codeAt.set(code, n);
    } else {
      problems.push(`Duplicate code "${code}" in entries ${firstWithCode} and ${n}.`);
      valid = false;
    }

    if (name.length > 0) {
      const nameKey = name.toLowerCase();
      const firstWithName = nameAt.get(nameKey);
      if (firstWithName === undefined) {
        nameAt.set(nameKey, n);
      } else {
        problems.push(`Duplicate name "${name}" in entries ${firstWithName} and ${n}.`);
        valid = false;
      }
    }

    if (valid) entries.push({ code, name, timezone });
  });

  if (problems.length > 0) throw new ClubSeedError(problems);
  return entries;
}

/** Reads, parses and validates a seed file. Relative paths are resolved against the working directory. */
export function loadClubSeedFile(path: string): ClubSeedEntry[] {
  const resolved = resolve(path);
  let text: string;
  try {
    text = readFileSync(resolved, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new ClubSeedError([`Club seed file not found: ${resolved}. ${EXAMPLE_HINT}`]);
    }
    throw new ClubSeedError([`Club seed file cannot be read: ${resolved} (${code ?? 'unknown error'}).`]);
  }

  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new ClubSeedError(['Club seed file must be a non-empty JSON array.']);
  }
  return parseClubSeed(json);
}

/**
 * Applies the entries in one transaction: insert new codes, update a changed name or time zone in
 * place, leave equal rows alone. Clubs are never deleted: a club that is in the database but not in
 * the entries is reported as a warning. Throws `ClubSeedError` (nothing written) when a name is
 * already used by a club with another code. `log` receives one line per change after the commit.
 */
export async function seedClubs(
  db: Kysely<ClubDatabase>,
  entries: ClubSeedEntry[],
  log: (line: string) => void = () => undefined,
): Promise<ClubSeedResult> {
  const lines: string[] = [];
  const result = await db.transaction().execute(async (trx): Promise<ClubSeedResult> => {
    // FOR UPDATE serialises parallel seed runs.
    const existing = await trx
      .selectFrom('club')
      .select(['id', 'code', 'name', 'timezone'])
      .forUpdate()
      .execute();
    const byCode = new Map(existing.map((row) => [row.code, row]));

    for (const entry of entries) {
      const clash = existing.find(
        (row) => row.code !== entry.code && row.name.toLowerCase() === entry.name.toLowerCase(),
      );
      if (clash) {
        throw new ClubSeedError([`Club name "${entry.name}" is already used by club ${clash.code}.`]);
      }
    }

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    for (const entry of entries) {
      const row = byCode.get(entry.code);
      if (!row) {
        await trx
          .insertInto('club')
          .values({ code: entry.code, name: entry.name, timezone: entry.timezone })
          .execute();
        inserted += 1;
        lines.push(`Inserted club ${entry.code}.`);
      } else if (row.name !== entry.name || row.timezone !== entry.timezone) {
        await trx
          .updateTable('club')
          .set({ name: entry.name, timezone: entry.timezone, updated_at: sql<Date>`now()` })
          .where('id', '=', row.id)
          .execute();
        updated += 1;
        lines.push(`Updated club ${entry.code}.`);
      } else {
        unchanged += 1;
      }
    }

    const fileCodes = new Set(entries.map((entry) => entry.code));
    const warnings = existing
      .filter((row) => !fileCodes.has(row.code))
      .map((row) => row.code)
      .sort()
      .map((code) => `Warning: club ${code} exists in the database but not in the seed file; left unchanged.`);

    return { inserted, updated, unchanged, warnings };
  });

  lines.forEach(log);
  return result;
}

export function formatClubSeedSummary(result: ClubSeedResult): string {
  return `Clubs seeded: ${result.inserted} inserted, ${result.updated} updated, ${result.unchanged} unchanged.`;
}
