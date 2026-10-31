# Technical overview

## Configuration: payments (Stripe)

Payment settings are read from environment variables in `api/src/config.ts` (zod schema, validated at startup). Payments are off by default.

| Variable | Format | Default | Required when |
|---|---|---|---|
| `PAYMENTS_ENABLED` | `true` \| `false` | `false` | — |
| `STRIPE_SECRET_KEY` | `sk_`/`rk_` + `test`/`live` + key | none | `PAYMENTS_ENABLED=true` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_` + `test`/`live` + key | none | `PAYMENTS_ENABLED=true` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_` + value | none | `PAYMENTS_ENABLED=true` |
| `STRIPE_LIVE_MODE_ALLOWED` | `true` \| `false` | `false` | — |
| `STRIPE_TIMEOUT_MS` | integer 1000–30000 | `10000` | — |
| `DROP_IN_PRICE_AMOUNT` | integer 1–99999999 (minor units) | none | `PAYMENTS_ENABLED=true` |
| `DROP_IN_CURRENCY` | ISO 4217 (3 letters), stored lower case | none | `PAYMENTS_ENABLED=true` |

Rules:
- `PAYMENTS_ENABLED` not `true`: all other payment variables are ignored and not validated. `config.payments.enabled = false`, Stripe fields are `null`.
- Secret and publishable key must be the same mode (`test` or `live`).
- Live keys are accepted only when `STRIPE_LIVE_MODE_ALLOWED=true`. Set this only in production.
- All issues are reported together in one startup error: `Invalid configuration: <VAR>: <reason>`. Values are never echoed.
- `server.ts` logs `payments.enabled=<bool>` and, when enabled, `mode=<test|live>` once at startup.
- Secrets live in the host's secret store or a git-ignored `.env` locally. CI has no `STRIPE_*` variables.
- Stripe webhook endpoint: `/webhooks/stripe` (unprefixed route), events `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.refund.updated`. Local testing: `stripe listen --forward-to localhost:3000/webhooks/stripe`.
- No database migration. Stripe SDK and gateway are added by US-132.

## Class schedule (US-121)

**Endpoint:** `GET /api/classes` (sign-in required; 401 `UNAUTHENTICATED` otherwise, checked before query validation).

**Query:** `clubId` (optional UUID; non-UUID → 400 `VALIDATION_ERROR` on `clubId`), `from` / `to` (optional ISO 8601 date-times with offset; clamped to the window; `from` ≥ `to` → 400 on `to`).

**Window:** `SCHEDULE_WINDOW_DAYS` = 14, computed in `schedule-window.ts` (`computeWindow`): now < `startAt` ≤ now + 14 days. Started classes are never returned.

**Free places:** max(0, capacity − count of bookings with status `confirmed` or `pending_payment`). Computed in one statement in `repository.ts` (`findSchedule`).

**Member status:** `myBookingStatus`, `myBooking` (`{ id, status }`) are filled only for a signed-in member's own booking. Staff get `none` / `null`. `myWaitlist` is `null` until US-127.

**Unknown club:** 404 `CLUB_NOT_FOUND` (`clubs/errors.ts`).

**Response:** `items` sorted by `startAt`, then name, then id. Header `Cache-Control: no-store`. Fields never include `instructorId`, `createdBy`, `memberId` or other members' ids.

**Web:** `SchedulePage` (club selector, `?clubId` sync), `ClassCard`, `lib/time.ts` (`formatClubTime`, `clubDateKey`, `formatClubDay`; uses `club.timezone`), `api/classes.ts`, `api/clubs.ts` (`GET /api/clubs`).

**Deployment:** no migration and no configuration. `classRoutes({ db, clock })` must be registered in the `/api` scope by `buildApp`. The `/schedule` route, the `/` redirect and the header link must be added at merge with US-118/US-120.

**Status:** implemented but not compiled or tested; no project checks are configured.

## Legacy member import (US-135)

Operator-only CLI in the `imports` module (`api/src/modules/imports/`), run with `npm run import:members -w api -- --file <path> [--type-map <path>] [--delimiter ","] [--dry-run] [--out-dir <dir>]`.

- **Flow:** read the CSV and the membership-type map, then plan in memory, then write. A real run uses one transaction that takes advisory lock `735136` (shared with US-136). A dry run takes no lock and writes nothing.
- **Dedup key:** normalised email (trim, lower-case). Legacy member numbers are kept in `app_user.legacy_member_id` and in table `import_member_alias`.
- **Data model:** `import_member_alias (legacy_member_id text PK, user_id uuid FK → app_user.id ON DELETE RESTRICT, created_at timestamptz)`. Invariant: if `app_user.legacy_member_id` is set, an alias with that number points to the same user.
- **Passwords:** none are set. Imported members have role `member`.
- **Reports** (in `--out-dir`, default `api/import-output/members-{UTC timestamp}`): `import-summary.json`, `import-rejections.csv`, `import-merges.csv`. They contain personal data and are git-ignored. Console output has counts only.
- **Exit codes:** 0 when the run completes (rejections are not a failure); 1 for file, mapping, database or reconciliation errors, with nothing written.
- **Configuration:** `DATABASE_URL`. Mapping file `api/seed/member-type-map.json` (reviewed like `clubs.json`; the example is `member-type-map.example.json`).
- **Migration:** `0020_create_import_member_alias` (number to be checked at merge).
- **Status:** written but not compiled or run on this branch; see the US-135 task document for the merge checklist.

## Repository skeleton and CI pipeline (TK-119)

**Layout:** npm workspaces `api` (Fastify 5, Kysely, PostgreSQL 16, Vitest 2) and `web` (React 18, Vite 5, Vitest 2 with jsdom). Node.js 22 (`.nvmrc`). ESM throughout.

**Checks:** `npm run ci` runs Format → Lint → Typecheck → DB migrate → Test → Build. The same chain runs in GitHub Actions workflow `CI` (`.github/workflows/ci.yml`, job `checks`, status check `CI / checks`) on pull requests and pushes to `main`. The workflow has `permissions: contents: read` and no secrets.

**Test database:** Integration tests run only against a database whose name ends in `_test` (`assertTestDatabase`). The global setup migrates that database before the tests. Tables are truncated with `resetDb()` (`api/test/helpers/db.ts`). Local PostgreSQL comes from `docker-compose.yml` (service `db`, creates `fithub_test` on first volume init).

**API:** `GET /health` (public, outside `/api`) returns `200 {"status":"ok","db":"ok"}` or `503 {"status":"error","db":"unreachable"}`. No error detail is returned.

**Configuration:** `DATABASE_URL` (required), `PORT` (3000), `NODE_ENV` (development), `LOG_LEVEL` (info). Validated in `api/src/config.ts`. Env files are loaded natively with `--env-file-if-exists` (no dotenv).

**Open items:** README CI badge still uses placeholder `fithub/fithub` until the real repository owner and name are set. `package-lock.json` must be committed.

## Authentication, sessions and roles (US-118)

**Module:** `api/src/modules/auth/*`, `api/src/shared/errors.ts`, `api/src/shared/clock.ts`, `api/src/app.ts`.

**Data model** (migration `0002_create_app_user_and_session`)
- `app_user`: `id`, `email` (unique on `lower(email)`), `full_name`, `role` (`member`, `instructor`, `club_manager`), `member_type` (`regular`, `drop_in`; required for members only), `club_id` (FK `club`, required for staff), `password_hash` (scrypt, `NULL` = cannot sign in), `legacy_member_id` (unique, set by US-135), timestamps.
- `user_session`: `id`, `user_id` (FK, cascade delete), `token_hash` (SHA-256, unique), `created_at`, `last_seen_at`, `expires_at`.
- A session is valid when `expires_at > now` and `last_seen_at` is within `SESSION_IDLE_TIMEOUT_MINUTES`.

**API**
| Route | Access | Notes |
|---|---|---|
| `POST /api/auth/login` | public, rate-limited | 200 `MeDto` + cookie; 401 `INVALID_CREDENTIALS`; 429 `TOO_MANY_ATTEMPTS` |
| `POST /api/auth/logout` | public | 204, deletes session, clears cookie |
| `GET /api/me` | signed in | 200 `MeDto`, `Cache-Control: no-store` |

All other `/api` routes require a session (`authHook`, opt out with `config: { public: true }`). Guards: `requireRole(roles, message?)` (preHandler) and `currentUser(request)`. `originGuard` rejects cross-origin state-changing requests.

**Errors:** flat body `{ code, message, fieldErrors? }`. Validation → 400 `VALIDATION_ERROR`; unknown route → 404 `NOT_FOUND`; anything else → 500 `INTERNAL_ERROR` (stack logged, not returned).

**Password and session security**
- `scrypt$<N>$<r>$<p>$<salt>$<key>`; cost `AUTH_SCRYPT_COST` (default 2^17, tests 16384). Unknown emails are checked against a dummy hash.
- Sign-in issues a new token and deletes the incoming one (no session fixation).
- Logs record `auth.login_succeeded` (user id) and `auth.login_failed` (IP only). Passwords, tokens and cookies are redacted.

**Configuration:** `APP_ORIGIN`, `SESSION_COOKIE_SECURE`, `SESSION_IDLE_TIMEOUT_MINUTES` (720), `SESSION_MAX_AGE_HOURS` (168), `AUTH_SCRYPT_COST` (131072), `LOGIN_RATE_LIMIT_MAX` (10), `LOGIN_RATE_LIMIT_WINDOW_MINUTES` (15), `TRUST_PROXY` (false).

**Operations:** `npm run user:create -w api -- --email … --name "…" --role <role> [--club <CODE>] [--member-type regular|drop_in] --password-stdin` and `npm run user:set-password -w api -- --email … --password-stdin` (ends all sessions of the user).

**Web:** `react-router-dom` routes, `AuthProvider` (`/api/me` on load), `RequireAuth`, `SignInPage` (`next` validated by `safeNext`), `AppHeader` with sign-out.
