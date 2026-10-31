# Release 0.1.0 — 2026-10-31

## Highlights
- Members can sign in with role-based access, and staff accounts are separated from member accounts (US-118).
- Members can browse the two-week class schedule filtered by club (US-121).
- Freed places in full classes are given automatically to the first person on the waiting list (US-128).
- Members with repeated no-shows are blocked from booking for a set period (US-130).
- Existing members can be imported without creating duplicate accounts (US-135).
- Stripe account, API keys and webhook secret configuration is in place for later payment work (TK-131).

## Delivered

| Code | Title | Category | Points |
|---|---|---|---|
| TK-131 | Configure Stripe account, API keys and webhook secret | configuration | 2 |
| US-121 | View the two-week class schedule filtered by club | development | 5 |
| US-118 | Sign-in and role-based access control | security | 3 |
| US-128 | Automatically give the first free place to the waiting list | development | 3 |
| US-130 | Block members with repeated no-shows from booking for a week | development | 3 |
| US-135 | Import existing members without duplicates | data_migration | 3 |

## Checks

Run on the base branch (`run_checks`, this run). All passed.

| Check | Result |
|---|---|
| install (`npm install`) | ✅ exit 0 |
| typecheck (`npm run typecheck`) | ✅ exit 0 |
| lint (`npm run lint`) | ✅ exit 0 |
| api unit tests (`npm run test:unit -w api`) | ✅ exit 0 |
| web tests (`npm test -w web`) | ✅ exit 0 |
| build (`npm run build`) | ✅ exit 0 |

## Smoke test results

| Code | Result | Note |
|---|---|---|
| TK-131 | ✅ | Config and server entry present; config unit tests pass. Stripe dashboard steps are manual and not verified here. |
| US-121 | ✅ | Schedule API, service and web page present; schedule-window and web tests pass. |
| US-118 | ✅ | Auth module, sign-in page and route guards present; auth unit and web tests pass. |
| US-128 | ✅ | Waitlist promotion, maintenance job and migrations present; job runner and config unit tests pass. |
| US-130 | ✅ | Block migration and attendance module present; no-show unit tests and web banner test pass. |
| US-135 | ✅ | Import module, migration and script present; import unit tests pass. |

Integration tests were not part of `run_checks` in this run and were not re-run. They should be run in CI against a test database.

## Known issues
- Story-level integration tests (classes, auth, waitlist, no-show block, imports) were not re-run in this release.
- Release scope note: the request listed six items in "Smoke Testing", but none were in "Release Ready". All six were released as they are the items awaiting release.
- No previous release tag was found, so this is the first tagged release (0.1.0). The version is an assumption.

## Pre-release and post-release steps
- Set in the target environment: `DATABASE_URL`, `NODE_ENV=production`, `APP_ORIGIN`, `SESSION_COOKIE_SECURE=true`, and `TRUST_PROXY=true` if a reverse proxy is used (US-118).
- Set `NO_SHOW_THRESHOLD`, `NO_SHOW_WINDOW`, `NO_SHOW_WINDOW_DAYS` and `NO_SHOW_BLOCK_DAYS` to the product owner's values. Defaults are provisional (US-130).
- Optional: set `WAITLIST_PROMOTION_CUTOFF_MINUTES` and `WAITLIST_JOB_INTERVAL_SECONDS`. Keep `JOBS_ENABLED=true` (US-128).
- Run `npm run db:migrate` to apply migrations 0005, 0006, 0020 and 0021.
- Merge notes: migrations 0005 and 0006 are provisional (`IF NOT EXISTS`) and may duplicate US-127/US-122 migrations. Drop duplicates when those merge. Migration 0020 may need renumbering (US-135).
- The user-admin script is needed to create accounts (US-118).

## Rollback plan
- Previous tag: none found. Rollback target is the state before this release on the base branch.
- Migrations with a down step: 0021 (drops `booking_block` and `booking.no_show_block_id`), 0020 (drops import alias table), 0006 and 0005 (drop booking source/booked_at and waitlist_entry). Run the down steps in reverse order before redeploying the previous build.
- Data: no data restore is planned. The import in US-135 should be re-run only after the rollback, if needed.
- Decision: the release manager proposes the rollback. The product owner decides.