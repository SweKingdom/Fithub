import type { ColumnType, Generated, Selectable } from 'kysely';

/** `club` (migration 0001, US-117): reference data, written only by the seed CLI. */
export interface ClubTable {
  id: Generated<string>;
  /** Short unique code, `^[A-Z0-9-]{2,20}$`. The seed matches clubs on it. */
  code: string;
  name: string;
  /** IANA time zone, e.g. `Europe/Stockholm`. */
  timezone: string;
  created_at: Generated<Date>;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export type ClubRow = Selectable<ClubTable>;
