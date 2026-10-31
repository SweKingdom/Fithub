import type { ColumnType, Generated } from 'kysely';
import type { MemberType } from './member-type-map.js';

/** `import_member_alias`: every legacy member number (also merged-away ones) → member (US-135, ADR-022). */
export interface ImportMemberAliasTable {
  legacy_member_id: string;
  user_id: string;
  created_at: Generated<Date>;
}

/** The columns of `app_user` that the import reads and writes. */
export interface ImportAppUserTable {
  id: Generated<string>;
  email: string;
  full_name: string;
  role: string;
  member_type: MemberType | null;
  club_id: string | null;
  legacy_member_id: string | null;
  password_hash: string | null;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface ImportClubTable {
  id: string;
  code: string;
}

/** The tables the import module touches. Merge `ImportMemberAliasTable` into `db/schema.ts` when both exist. */
export interface ImportDatabase {
  app_user: ImportAppUserTable;
  import_member_alias: ImportMemberAliasTable;
  club: ImportClubTable;
}
