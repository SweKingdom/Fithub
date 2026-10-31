import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Kysely } from 'kysely';
import type { Clock } from '../../shared/clock.js';
import { readCsvFile, type CsvRow } from './csv.js';
import type { ImportDatabase } from './db-types.js';
import { ImportFileError } from './errors.js';
import { loadMemberTypeMap } from './member-type-map.js';
import type { ParseContext } from './members.parse.js';
import { planMemberImport, type MemberImportPlan, type MemberSnapshot } from './members.plan.js';
import { insertAliases, insertMembers, loadMemberSnapshot, lockImports, updateMember } from './repository.js';

export const MEMBER_REQUIRED_COLUMNS = ['email', 'full_name', 'member_type'];
export const MEMBER_OPTIONAL_COLUMNS = ['legacy_member_number', 'home_club_code'];

export type MemberPlanner = (rows: CsvRow[], ctx: ParseContext, snapshot: MemberSnapshot) => MemberImportPlan;

export interface ImportMembersOptions {
  file: string;
  typeMapPath: string;
  delimiter: string;
  dryRun: boolean;
  clock: Clock;
  /** Replaceable in tests only. */
  planner?: MemberPlanner;
}

export interface MemberImportResult {
  file: string;
  fileSha256: string;
  dryRun: boolean;
  startedAt: Date;
  finishedAt: Date;
  plan: MemberImportPlan;
}

/**
 * Reads, plans and (unless `dryRun`) applies the member import in one transaction.
 * File errors and an unbalanced plan throw `ImportFileError`; a database error rolls everything back and propagates.
 * A dry run with an unbalanced plan returns the result with `plan.balanced = false`.
 */
export async function importMembers(db: Kysely<ImportDatabase>, options: ImportMembersOptions): Promise<MemberImportResult> {
  const startedAt = options.clock.now();
  const planner = options.planner ?? planMemberImport;

  const typeMap = loadMemberTypeMap(options.typeMapPath);
  const { rows } = readCsvFile(options.file, {
    delimiter: options.delimiter,
    required: MEMBER_REQUIRED_COLUMNS,
    optional: MEMBER_OPTIONAL_COLUMNS,
  });
  const fileSha256 = createHash('sha256').update(readFileSync(options.file)).digest('hex');

  const finish = (plan: MemberImportPlan): MemberImportResult => ({
    file: options.file,
    fileSha256,
    dryRun: options.dryRun,
    startedAt,
    finishedAt: options.clock.now(),
    plan,
  });

  if (options.dryRun) {
    const { snapshot, clubsByCode } = await loadMemberSnapshot(db);
    return finish(planner(rows, { typeMap, clubsByCode }, snapshot));
  }

  const plan = await db.transaction().execute(async (trx) => {
    await lockImports(trx);
    const { snapshot, clubsByCode } = await loadMemberSnapshot(trx);
    const planned = planner(rows, { typeMap, clubsByCode }, snapshot);
    if (!planned.balanced) {
      throw new ImportFileError('The import counts do not add up; nothing was written.');
    }

    const newIds = await insertMembers(
      trx,
      planned.inserts.map((insert) => insert.row),
    );
    for (const update of planned.updates) {
      if (Object.keys(update.patch).length > 0) await updateMember(trx, update.userId, update.patch, startedAt);
    }

    const aliases: Array<{ legacy_member_id: string; user_id: string }> = [];
    for (const insert of planned.inserts) {
      const userId = newIds.get(insert.row.email);
      if (userId === undefined) throw new Error('A member insert did not return its id.');
      for (const number of insert.aliases) aliases.push({ legacy_member_id: number, user_id: userId });
    }
    for (const update of planned.updates) {
      for (const number of update.newAliases) aliases.push({ legacy_member_id: number, user_id: update.userId });
    }
    await insertAliases(trx, aliases);
    return planned;
  });

  return finish(plan);
}
