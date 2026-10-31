import type { ColumnType, Generated, Selectable } from 'kysely';

/** `club`: reference data, written only by the seed CLI (US-117). */
export interface ClubTable {
  id: Generated<string>;
  code: string;
  name: string;
  timezone: string;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type ClubRow = Selectable<ClubTable>;

/** The tables the clubs module touches. Merge `ClubTable` into `db/schema.ts` (`club: ClubTable`) when it exists. */
export interface ClubDatabase {
  club: ClubTable;
}
