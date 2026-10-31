# US-117: Seed the four FitHub clubs as reference data
**Status:** Ready for UAT · **Category:** script · **Points:** 3 · **Sprint:** –

## Summary
The four FitHub clubs are stored in a `club` table, loaded by a reviewed seed file through a CLI command. Classes, staff and reports can then be linked to a club. No user interface or API can create, edit or delete clubs.

## What was built
- `api/migrations/0001_create_club.ts`: creates the `club` table with format and length checks, a unique `code`, and a unique index on `lower(name)`. `down` drops the table.
- `api/src/modules/clubs/db-types.ts`: `ClubTable` and `ClubRow`, imported by `api/src/db/schema.ts`.
- `api/src/modules/clubs/repository.ts`: `listClubs`, `findClubById`, `findClubByCode`.
- `api/src/modules/clubs/dto.ts`: `ClubDto` and `toClubDto`.
- `api/src/modules/clubs/routes.ts`: `clubRoutes` exposes `GET /api/clubs`.
- `api/src/modules/clubs/seed.ts`: `parseClubSeed` (validation) and `seedClubs` (idempotent upsert in one transaction).
- `api/scripts/seed-clubs.ts`: CLI for `db:seed:clubs`, with `--file` (default `seed/clubs.json`).
- `api/src/db/migrate.ts`: `--down` reverts the most recent migration. Scripts `db:migrate:down` and `db:seed:clubs` added to `api/package.json` and the root `package.json`.
- `api/seed/clubs.example.json`: four example entries (`EXAMPLE-1` to `EXAMPLE-4`).
- Tests: `unit/clubs.seed-parse.test.ts`, `unit/clubs.seed.test.ts`, `integration/clubs.seed.test.ts`, `integration/clubs.routes.test.ts`, `integration/migrations.test.ts`.

## How it works
- **AC 1, created:** a seed run on an empty table inserts every entry. The CLI prints `Clubs seeded: 4 inserted, 0 updated, 0 unchanged.` and exits 0.
- **AC 2, re-run:** matching is done on `code`. Equal rows are left untouched. A changed name or time zone updates the row in place (same `id`, new `updated_at`).
- **AC 3, invalid file:** all validation errors are collected and printed, one per line, and the CLI exits 1. Nothing is written. A name that clashes with another code in the database rolls back the transaction.
- **AC 4, missing file:** the CLI prints the path and the copy instruction and exits 1.
- **AC 5, clubs not in file:** the row is kept and a warning is printed.
- **AC 6, read API:** `GET /api/clubs` returns `{ id, code, name, timezone }` sorted by `name`, then `id`. Access control is added by US-118.
- **AC 7, migration:** `db:migrate` creates `club`. `db:migrate:down` drops it. It reverts one migration per run.

## How to test
Automated (needs `docker compose up -d db`): `npm run typecheck`, `npm run lint`, `npm run test:unit -w api`, `npm run test:integration -w api`, `npm test -w web`, `npm run build`.

- **AC 1:** `npm run db:migrate && npm run db:seed:clubs -- --file seed/clubs.example.json`. **Verify:** `Clubs seeded: 4 inserted, 0 updated, 0 unchanged.`, exit 0.
- **AC 2:** Run the same command again. **Verify:** `0 inserted, 0 updated, 4 unchanged`. Change one name in a copy and run it. **Verify:** `1 updated`, same `id`.
- **AC 3:** Use a copy with timezone `Europe/Atlantis`. **Verify:** exit 1, `Entry 1 (code "EXAMPLE-1"): unknown time zone "Europe/Atlantis".`, table unchanged.
- **AC 4:** Run `npm run db:seed:clubs` without `api/seed/clubs.json`. **Verify:** `Club seed file not found: <path>. Copy seed/clubs.example.json ...`, exit 1.
- **AC 5:** Insert club `OLD-1` and re-run. **Verify:** warning printed, row kept.
- **AC 6:** Signed in, call `GET /api/clubs`. **Verify:** 200, sorted by name, keys `id, code, name, timezone`. Without a session: 401.
- **AC 7:** `npm run db:migrate:down` (repeat for each later migration), then `npm run db:migrate`. **Verify:** `club` is dropped and recreated without error.

## Deployment notes
**Pre-deploy**
- The product owner delegated the club values. The architect records them as an assumption. Confirm code, display name and IANA time zone for each club.
- Add `api/seed/clubs.json` with the confirmed values through a reviewed pull request.

**Post-deploy**
- Run `npm run db:migrate` on the target database.
- Run `npm run db:seed:clubs`. Expected: `Clubs seeded: 4 inserted, 0 updated, 0 unchanged.`
- Check: `SELECT code, name, timezone FROM club ORDER BY name;` returns the four confirmed clubs.

**Release constraint:** US-117 must be released together with US-118, because `GET /api/clubs` is protected by the global auth hook added in US-118.

**Configuration:** no new variables. The CLI uses `DATABASE_URL`.

## Known limitations
- The club values in the example file and in the pre-deploy file are placeholders until the product owner confirms them.
- `db:migrate:down` reverts one migration per run.
- Club administration (create, edit, delete), opening hours, rooms, addresses and the club picker are out of scope and come in later stories.
- The integration suite (`clubs.seed`, `clubs.routes`, `migrations`) was not run by the automated checks. It must be run against the database before release.
