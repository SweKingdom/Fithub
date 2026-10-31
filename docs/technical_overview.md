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

## Waiting list promotion (US-128)

**Modules**
- `api/src/modules/waitlist/promotion.ts`: `promoteNext(trx, classId, ctx)`, `checkPromotionEligibility`, `notifyPromotions`.
- `api/src/modules/waitlist/maintenance.ts`: `runWaitlistMaintenance` (job `waitlist-maintenance`).
- `api/src/modules/waitlist/repository.ts`: waiting list queries and state changes.
- `api/src/notifications/notifier.ts`: `Notifier` port and `LogNotifier` default.
- `api/src/jobs/runner.ts`: `startIntervalJobs`; one run at a time per job; errors logged.

**Behaviour**
- Promotion runs inside the transaction that frees the place, under the `gym_class` row lock. Triggers: booking cancel (US-124, pending wiring), payment failure/expiry (US-132/US-133, pending wiring), and the maintenance job.
- Promotes at most one member per freed place, in `queue_seq` order. Skips members with an active booking (entry `removed`).
- Regular member → booking `confirmed`. Drop-in member → `pending_payment`. Booking `source` = `waitlist`.
- No promotion when `now >= start_at − WAITLIST_PROMOTION_CUTOFF_MINUTES`. The job then sets remaining `waiting` entries to `expired`.
- Notifications are sent after commit. Errors are logged and do not undo a promotion.

**Data**
- `waitlist_entry` (provisional migration 0005): statuses `waiting`, `promoted`, `removed`, `expired`; `promoted_booking_id`, `queue_seq`, `ended_at`.
- `booking.source` and `booking.booked_at` (provisional migration 0006). No other schema change.

**Configuration**

| Variable | Type | Default | Notes |
|---|---|---|---|
| `WAITLIST_PROMOTION_CUTOFF_MINUTES` | int ≥ 0 | `0` | Assumption; also used by US-127 |
| `WAITLIST_JOB_INTERVAL_SECONDS` | int ≥ 10 | `60` | Maintenance job interval |
| `JOBS_ENABLED` | boolean | `true` (`false` when `NODE_ENV=test`) | Starts interval jobs in `server.ts` |

**Notification event**
- `{ type: 'waitlist_promoted', memberId, bookingId, classId }`. `LogNotifier` writes `notification.waitlist_promoted` with ids only.

**Deployment**
- Run `npm run db:migrate -w api` after deploy. `allowUnorderedMigrations` is enabled in the migrator.
- Drop-in promotion must not go live before US-132.

## Attendance and no-show recording (US-129)

Staff record attendance per confirmed booking. Source: fithub-requirements.pdf §1, §2.2, §5; ADR-008 to ADR-012.

**Modules** (`api/src/modules/attendance/`)

| File | Purpose |
|---|---|
| `window.ts` | Pure. `attendanceWindow(classRow, now, editWindowHours)` returns `opensAt` (= `start_at`), `closesAt` (= `start_at + duration_minutes + ATTENDANCE_EDIT_WINDOW_HOURS`) and `state` (`not_open`, `open`, `closed`). `canEditAttendance(user, window)`. |
| `repository.ts` | Roster read, class-scoped booking lock, update of one booking, query of classes due for the auto no-show sweep. |
| `service.ts` | `getAttendance`, `recordAttendance` (one transaction). |
| `auto-no-show.ts` | `runAutoNoShowSweep`, `startAutoNoShowSweeper`. |
| `routes.ts` | `GET` and `PUT /api/classes/:classId/attendance`, guarded by `requireRole('instructor','club_manager')`. |

**Data model:** `booking` gains `attendance_recorded_by` (uuid, FK `app_user.id`, ON DELETE RESTRICT, nullable) and `attendance_recorded_at` (timestamptz, nullable). CHECK `booking_attendance_recorded_ck`: `(attendance = 'unknown') = (attendance_recorded_at IS NULL)`. Migration `0021_add_booking_attendance_audit`.

**Save flow (`PUT`)**, one transaction:
1. Lock the class row (`FOR UPDATE`). Missing → 404 `CLASS_NOT_FOUND`.
2. `assertStaffOfClass` (club scope) → 403.
3. Status `cancelled` → 409 `CLASS_CANCELLED`.
4. Window: `not_open` → 409 `ATTENDANCE_NOT_OPEN`; `closed` and not club manager → 409 `ATTENDANCE_CLOSED`.
5. Lock requested bookings of this class ordered by `member_id`. Any id not `confirmed` in this class → 400 `VALIDATION_ERROR` on `entries[i].bookingId`; nothing written.
6. For each changed row: update `attendance`, `attendance_recorded_by`, `attendance_recorded_at`, `updated_at`; publish `AttendanceRecorded`.

**Event:** `AttendanceRecorded` { `bookingId`, `memberId`, `classId`, `classStartAt`, `previousAttendance`, `attendance`, `recordedBy`, `recordedAt` }. Published in the same transaction (ADR-009). The no-show block handler (US-130) subscribes; its failure rolls back the save.

**Auto no-show sweep:** runs only when `ATTENDANCE_AUTO_NO_SHOW_ENABLED=true`. Every `ATTENDANCE_SWEEP_INTERVAL_MINUTES` the sweeper picks up to 50 scheduled classes past their window that still have `unknown` confirmed bookings. Per class it locks with `FOR UPDATE SKIP LOCKED`, sets `no_show` with `attendance_recorded_by = null`, and publishes one event per booking. Only `unknown` rows are touched, so repeated runs are harmless. The sweeper starts in `server.ts` only; tests call `runAutoNoShowSweep` directly.

**Staff schedule (US-121 rework):** `GET /api/classes` returns, to instructors and club managers only, started classes of their own club until `start + duration + ATTENDANCE_EDIT_WINDOW_HOURS`. It does not apply to members, to other clubs, or when the caller passes `from`. `ScheduleDeps.attendanceEditWindowHours` supplies the window; `app.ts` passes `config.attendance.editWindowHours`.

**Configuration: attendance**

| Variable | Type | Default | Notes |
|---|---|---|---|
| `ATTENDANCE_EDIT_WINDOW_HOURS` | int 1–168 | `24` | Hours after class end during which instructors may record. |
| `ATTENDANCE_AUTO_NO_SHOW_ENABLED` | boolean | `false` | Switch on only after product owner confirmation. |
| `ATTENDANCE_SWEEP_INTERVAL_MINUTES` | int 1–1440 | `15` | Sweep frequency. |

Documented in `.env.example`. Loaded by `config.attendance` in `config.ts`.

**Security:** role and club scope on both routes. `recordedBy` comes from the session only. Booking ids are accepted only when they belong to the class in the URL. The roster returns member names, never e-mail addresses.

**Performance:** ≤ ~40 confirmed bookings per class. One save = 1 class lock, 1 select, ≤ 40 updates. Target p95 < 300 ms.

**Open items:** integration tests (`attendance`, `bookings.access`, `classes.schedule`) must be run against PostgreSQL before release. Auto no-show stays off until the product owner confirms it.

## No-show booking block (US-130)

**Data model**
- `booking_block`: `id`, `member_id` (FK `app_user`, RESTRICT), `reason` (CHECK `no_show` | `manual`), `starts_at`, `ends_at` (CHECK `ends_at >= starts_at`), `no_show_count`, `lifted_at`, `created_at`. Index `booking_block_member_ends_idx (member_id, ends_at)`.
- `booking.no_show_block_id` (FK `booking_block`, SET NULL). Partial index `booking_uncounted_no_show_idx (member_id) WHERE attendance = 'no_show' AND no_show_block_id IS NULL`.
- Migration `0021_create_booking_block`. Also adds `booking.attendance` (IF NOT EXISTS) and re-creates its CHECK; verify against the US-129 migration on merge.

**Configuration**

| Variable | Type | Default | Notes |
|---|---|---|---|
| `NO_SHOW_THRESHOLD` | int 1–20 | `3` | provisional |
| `NO_SHOW_WINDOW` | `rolling_days` \| `calendar_month` | `rolling_days` | provisional |
| `NO_SHOW_WINDOW_DAYS` | int 1–366 | `30` | used with `rolling_days` |
| `NO_SHOW_BLOCK_DAYS` | int 1–90 | `7` | |

Changing values affects only future decisions; existing blocks are not recalculated.

**Behaviour**
- `block-service.onAttendanceRecorded` handles `AttendanceRecorded` in the same transaction as the attendance save (subscribed in `app.ts`). It locks the member row, then creates a block at the threshold or lifts a block when a linked no-show is corrected to `attended`.
- `assertNotBlocked(trx, memberId)` throws `DomainError('BOOKING_BLOCKED', …, 409)`. Message date uses `Intl.DateTimeFormat('en-GB', …)` in the home club's time zone.
- Call sites: `bookClass` step 3 and the waiting-list join, after class checks. Not yet on this branch (US-122, US-127).

**API**
- `GET /api/me` and the sign-in response include `bookingBlock: { endsAt, reason, noShowCount, message } | null`. Always `null` for staff.
- `POST /api/classes/:classId/bookings` and `POST /api/classes/:id/waitlist` return `409 BOOKING_BLOCKED` (pending US-122 / US-127).

**Web**
- `BookingBlockBanner` (`role="status"`) renders from `me.bookingBlock` on the schedule page. Its element id is `BOOKING_BLOCK_BANNER_ID`; Book and Join buttons reference it via `aria-describedby`.

**Security:** the member id comes from the session. Block data is returned only to the member via `/api/me`. No staff route for blocks.

## Class creation and instructor list (US-120)

**Endpoints**

| Method and route | Who | Result |
|---|---|---|
| `POST /api/classes` | instructor, club_manager (own club) | `201` + `Location`, body `ClassDto`; `400` `VALIDATION_ERROR` with `fieldErrors`; `403` role/club; `401` no session |
| `GET /api/clubs/:clubId/instructors` | instructor, club_manager (own club) | `200` `[{ id, fullName }]` sorted by name, then id; no e-mail |

- Global `authHook` runs first (ADR-015). The `requireRole` guard runs in `preValidation`, so a member with an invalid body gets 403.
- The service uses `currentUser(request)` for the caller. `status`, `created_by` and (for instructors) `instructor_id` are set by the server; body values for them are ignored.
- Club scope: `input.clubId` must equal `user.clubId`, otherwise 403 (no existence leak).
- Instructor rule: `instructorId` absent, null or own id → own id; anything else → 400 on `instructorId`.
- Club manager rule: `instructorId` must match an `app_user` with `role = 'instructor'` and the same `club_id` (`findInstructorInClub`).

**Data model: `gym_class` (migration `0003_create_gym_class`)**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `club_id` | uuid FK → `club.id` | ON DELETE RESTRICT |
| `name` | varchar(100) | stored trimmed; CHECK `gym_class_name_ck` (`btrim(name)` non-empty) |
| `start_at` | timestamptz | UTC |
| `duration_minutes` | integer | CHECK `gym_class_duration_ck` (> 0) |
| `capacity` | integer | CHECK `gym_class_capacity_ck` (≥ 1) |
| `status` | text | default `scheduled`; CHECK `gym_class_status_ck` (`scheduled`, `cancelled`) |
| `instructor_id` | uuid FK → `app_user.id` | nullable; ON DELETE SET NULL |
| `created_by` | uuid FK → `app_user.id` | NOT NULL; ON DELETE RESTRICT |
| `created_at`, `updated_at` | timestamptz | default `now()` |

Indexes: `gym_class_club_start_idx (club_id, start_at)`, `gym_class_instructor_idx (instructor_id)`. Down migration drops the table.

**Validation and errors**
- Zod schema `createClassBodySchema(clock)`; the start-time rule uses the injected `Clock`.
- Shared error handler maps zod issues to one `fieldErrors` entry per field (first issue wins), top-level message "Please correct the highlighted fields.". Malformed JSON returns `VALIDATION_ERROR` "The request body is not valid JSON." Detection relies on `SyntaxError` / `FST_ERR_CTP_*` codes; verify in integration tests.
- Messages are centralised in `CLASS_MESSAGES` (`modules/classes/errors.ts`).

**DTO**
- `ClassDto` via `toClassDto(row, activeBookingCount)`. `freePlaces = max(capacity − active bookings, 0)`; currently always 0 bookings. `cancelledAt` and `cancellationReason` are always null until US-126.

**Web**
- `clubLocalToUtc(date, time, timezone)` in `web/src/lib/time.ts` (date-fns-tz `fromZonedTime`, ADR-018).
- `NewClassPage` posts through `createClass` in `web/src/api/classes.ts`; instructors loaded via `getInstructors` in `web/src/api/clubs.ts`.

**Testing**
- Unit: `test/unit/classes.schema.test.ts`.
- Integration (not yet run): `test/integration/classes.create.test.ts`, `test/integration/clubs.instructors.test.ts`. The auth protection suite covers both routes automatically.
- Factory: `createClass` in `test/helpers/factories.ts`.

## Bookings access and read routes (US-123)

Module: `api/src/modules/bookings/`. Access is decided in SQL, not after the fetch.

| Route | Who | Behaviour |
|---|---|---|
| `GET /api/me/bookings?period=upcoming\|past&offset` | member | Own bookings. `upcoming` = `confirmed`, `pending_payment` on classes not yet ended, soonest first. `past` = any status on ended classes, newest first. Other `period` values → `400 VALIDATION_ERROR`. |
| `GET /api/bookings/:id` | member (own), staff (own club) | Foreign, other-club or unknown id → `404 BOOKING_NOT_FOUND` "This booking does not exist." (identical body). |
| `POST /api/bookings/:id/cancel` | member only | **Placeholder** (US-124 replaces the body). Staff → `403 FORBIDDEN`. Foreign or unknown id → `404`. Already cancelled or class started → `409 BOOKING_NOT_CANCELLABLE`. |
| `GET /api/classes/:classId/bookings` | instructor, club manager (own club) | Roster, names only. Other club → `403 FORBIDDEN` "You can only manage classes for your own club.". Member → `403 FORBIDDEN` "Only instructors and club managers can manage classes.". |

Files:
- `access.ts`: `getReadableBooking`, `getOwnBookingForUpdate` (takes the class lock before the booking lock), `assertStaffOfClass`, `bookingNotFound`, `classNotFound`.
- `repository.ts`: `listMemberBookings`, `findBookingForMember`, `findBookingForClub`, `findOwnBooking`, `markBookingCancelled`, `findClassForRoster`, `listClassRoster`.
- `service.ts`: zod schemas, `toBookingDto`, `listMyBookings`, `getBooking`, `getClassRoster`, `cancelBooking`.

`BookingDto`: `id, classId, className, clubName, clubTimezone, startAt, durationMinutes, status, attendance, canCancel`, plus `memberName` for staff viewers only.

`canCancel` is computed only in `toBookingDto`: true when the viewer owns the booking, the status is `confirmed` or `pending_payment`, and the class has not started. Always false for staff. US-124 adds the cut-off rule (`BOOKING_CANCEL_CUTOFF_MINUTES`, not yet defined).

Web: `/my-bookings` (`RequireAuth roles={['member']}`), `web/src/api/bookings.ts`, `MyBookingsPage.tsx`, `formatClubDateTime` in `web/src/lib/time.ts`.

Tests: `bookings.list` and `bookings.access` integration tests (need the test database); `MyBookingsPage` web tests.

Configuration and migrations: none. Depends on the `booking` table and `BookingDto` from US-122.
