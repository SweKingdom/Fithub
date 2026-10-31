# US-135: Import existing members without duplicates
**Status:** Ready for UAT · **Category:** data_migration · **Points:** 3 · **Sprint:** —

## Summary
Club managers can load existing members from the legacy source into FitHub once, without creating duplicate accounts. The import is an operator command-line tool; it has no screen. Every run produces a summary, a rejection report and a merge report.

## What was built
- `api/src/modules/imports/csv.ts`: reads and writes the import CSV (BOM, delimiter, quoted fields, CSV-injection guard on output).
- `api/src/modules/imports/normalize.ts`: `normalizeEmail`, `normalizeName`, `normalizeLookupKey`.
- `api/src/modules/imports/member-type-map.ts`: `loadMemberTypeMap` reads the reviewed membership-type mapping file.
- `api/src/modules/imports/members.parse.ts`: `parseMemberRow` validates one row (pure).
- `api/src/modules/imports/members.plan.ts`: `planMemberImport` decides insert, update, unchanged, merged or rejected for each row (pure).
- `api/src/modules/imports/repository.ts`: `lockImports`, `loadMemberSnapshot`, `insertMembers`, `updateMember`, `insertAliases`.
- `api/src/modules/imports/members.ts`: `importMembers` runs plan and apply in one transaction (or plan only for a dry run).
- `api/src/modules/imports/report.ts`: `writeImportReport`, `formatSummaryLine`.
- `api/src/modules/imports/db-types.ts`: `ImportMemberAliasTable`.
- `api/src/modules/imports/errors.ts`: `ImportFileError` and the rejection reason codes.
- `api/scripts/import-members.ts`: CLI wrapper (`npm run import:members -w api -- …`).
- `api/migrations/0020_create_import_member_alias.ts`: creates table `import_member_alias`.
- `api/seed/member-type-map.example.json`: example mapping (the real file is added at deploy).
- `.gitignore`: `api/import-data/` and `api/import-output/`.
- `README.md`: section "Importing legacy members".
- Tests: unit tests for normalize, csv, member-type-map, parse and plan; integration test `imports.members.test.ts` for AC 1–9.

## How it works
- **AC 1 Members loaded:** each new valid row creates one member with role `member` and no password. Email and name are normalised. The member type comes from the mapping file. Each legacy number gets an alias row.
- **AC 2 Duplicates merged:** rows with the same normalised email, name, membership type and club become one member. The first legacy number is kept on the member. The other rows are listed in `import-merges.csv`.
- **AC 3 Conflicting duplicates:** rows with the same email but a different name, type or club are all rejected with `CONFLICTING_DUPLICATE`. Nothing is written for that email.
- **AC 4 Re-run safe:** matched members are compared field by field. Only real differences are updated, in place, so a re-run changes nothing.
- **AC 5 Rejections:** each invalid row is rejected with one reason code (see the reason table in the story spec). No row gets a default membership type.
- **AC 6 Staff untouched:** if the email belongs to a non-member account, the row is rejected with `EMAIL_USED_BY_STAFF` and the account is not changed.
- **AC 7 Reconciliation:** every source row has exactly one outcome. If the totals do not balance, the run writes nothing and exits with code 1.
- **AC 8 Dry run:** `--dry-run` produces the same reports without writing to the database.
- **AC 9 File errors:** a missing file, a missing or duplicate column, no data rows, or a bad mapping file stops the run with exit code 1 and no database change. A database error rolls back the whole transaction.

## How to test
**Automated:** `docker compose up -d db && npm run db:migrate && npm test -w api -- imports`.
Not run yet: the project has no checks configured until TK-119 is merged (see Known limitations).

**Setup:** seed the clubs (`seed/clubs.example.json`). Copy `seed/member-type-map.example.json` to `seed/member-type-map.json`. Create `api/import-data/members.csv` with the columns `email,full_name,member_type,legacy_member_number,home_club_code`. `DATABASE_URL` must be set.

- **AC 1:** Import 1,000 valid rows. **Verify:** `SELECT count(*) FROM app_user WHERE role='member'` = 1000; summary `inserted` = 1000; `password_hash` is null.
- **AC 2:** Add "Anna@x.se",L1 and " anna@x.se ",L2 with the same name, type and club. **Verify:** one user; `import_member_alias` has L1 and L2 for that user; `import-merges.csv` lists the line.
- **AC 3:** Use the same email with two different names. **Verify:** no user with that email; both lines are `CONFLICTING_DUPLICATE` in the rejections file.
- **AC 4:** Run the same file again. **Verify:** `0 inserted, 0 updated`; row counts unchanged. Then fix one name and re-run. **Verify:** `1 updated`, same `id`.
- **AC 5:** Add rows with a bad email, an unmapped type and an unknown club. **Verify:** each is in `import-rejections.csv` with the right code; none is loaded.
- **AC 6:** Create an instructor with `user:create` and add a row with their email. **Verify:** `EMAIL_USED_BY_STAFF`; the instructor is unchanged.
- **AC 7:** Open `import-summary.json`. **Verify:** `sourceRows` = sum of the outcomes and `balanced` = true.
- **AC 8:** Run with `--dry-run` on a fresh DB. **Verify:** the reports are written and `app_user` stays empty.
- **AC 9:** Remove the `email` column and run. **Verify:** exit code 1, "Missing column(s): email…", database unchanged.

## Deployment notes
**Pre-deploy**
- PO confirms the dedup key (email, ignoring case and spaces) and the membership-type mapping.
- Add `csv-parse` and `csv-stringify` to `api/package.json`, and the script `"import:members": "tsx scripts/import-members.ts"`.
- Merge `ImportMemberAliasTable` (from `imports/db-types.ts`) into `api/src/db/schema.ts`. Check that `src/shared/clock.ts` exports `Clock` and `systemClock`. Renumber migration `0020` if needed.
- Store the FitHub member extract in `api/import-data/` on the operator machine only. Convert it to the import file contract (README).
- Add `api/seed/member-type-map.json` with the confirmed mapping through a reviewed pull request.

**Post-deploy**
- `npm run db:migrate` (creates `import_member_alias`). Make sure the clubs are seeded (US-117).
- Dry run: `npm run import:members -w api -- --file import-data/members.csv --dry-run`. Review the rejection and merge files with the PO or club managers.
- Real run without `--dry-run`. Keep `import-summary.json` as the sign-off record.
- After sign-off, delete `api/import-data/` and the rejection and merge files (personal data).

**Verify:** `SELECT count(*) FROM app_user WHERE role = 'member'` equals `inserted` + `updated` + `unchanged` of the summary. `SELECT lower(email), count(*) FROM app_user GROUP BY 1 HAVING count(*) > 1` returns no rows. The summary shows `balanced: true`.

**Rollback:** the `down` migration drops `import_member_alias`. Run it before US-136 is rolled back, otherwise credit lookup by legacy number is lost. Imported `app_user` rows are not deleted by a rollback.

## Known limitations
- Imported members cannot sign in: no password is set. How they get access is open (US-118).
- Deleting members missing from the file, importing history, and importing staff accounts are out of scope.
- No HTTP endpoint or UI for imports.
- **Not compiled or run.** This branch has no `api/package.json`, `db/` or test helpers, and no checks are configured. Before release, resolve these at merge:
  - `test/helpers/db.ts` (`testDb`) is imported by the integration test but does not exist on this branch.
  - `src/shared/clock.ts`, and the `csv-parse`, `csv-stringify`, `zod`, `kysely` and `pg` dependencies, are missing on this branch.
  - The CSV line number is taken from `csv-parse` `info.lines`; this is unverified. Check line numbers in the reports against a real file.
  - The CLI exit codes (AC 7, AC 9) have no CLI-level test yet.
  - Run `npm test -w api -- imports` after merge and fix any failure before release.
- Assumption: the dedup key is email (trimmed, case-insensitive). Awaiting PO confirmation.
