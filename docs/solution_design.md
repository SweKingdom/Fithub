# FitHub – Solution Design

Status: living document. Last update: re-refinement of FT-112 (US-127 waiting list join/leave). Changes in this update:
- US-127 aligned with ADR-008/010/011/015: flat error body, 409 `BOOKING_BLOCKED`, global `authHook` + `requireRole` as `preValidation`, **leave takes the `gym_class` lock before the entry lock**, ownership lookup `findOwnWaitlistEntry` in `bookings/access.ts`, access-matrix rows for both waiting-list routes.
- §5 waiting-list contract expanded (check order, lock order); waiting-list error codes moved into the §5 error table; the corresponding §10 risk is closed.

Previous update: FT-110 (US-121 schedule browsing) — merged two diverged versions (US-117/US-118 content restored), ADR renumbering (FT-109 decisions are now **ADR-017** test-DB guard, **ADR-018** `date-fns-tz`, **ADR-019** class cancellation; US-120, US-126 and TK-119 still cite the old numbers, see §10), `GET /api/classes` contract finalised, ADR-020.

Earlier updates: FT-109 (US-120, US-126), FT-112 (US-127, US-128), FT-108/TK-119, FT-107 (US-117, US-118), US-122.

## 1. Architecture overview
FitHub is a **web app backed by a JSON API** (brief §1), built as a single repository with two npm workspaces:

```
Browser (React SPA, web/)  ──HTTP/JSON + session cookie──►  API (Fastify, api/)  ──SQL──►  PostgreSQL 16
                                              │
                                              ├──► Stripe Payments API (PaymentIntents)  [EP-104]
                                              ◄── Stripe webhooks (/webhooks/stripe)      [EP-104]
                                              ├──► Notifier port (LogNotifier now; email/SMS TBD)  [US-128, US-126]
                                              └── in-process interval jobs (waitlist-maintenance, payment-retry)  [ADR-007]
Operator CLIs (api/scripts: seed-clubs, user-admin, import-*) ──► PostgreSQL              [US-117, US-118, EP-105]
```

- The API is the only component that talks to the database and to Stripe. The SPA holds no business rules; all checks (capacity, double booking, windows, roles) are enforced server-side.
- **Every `/api` route requires a session by default** (global `authHook`, ADR-015); only sign-in and sign-out are public. Sessions are opaque, hashed and stored server-side (ADR-014).
- **Place allocation is serialised per class** by a row lock on `gym_class` (ADR-010). Booking, booking cancellation, class cancellation, waiting-list join, waiting-list leave and promotion all take this lock first. The schedule read takes no locks.
- **Waiting-list promotion runs synchronously** inside the transaction that frees the place (US-128). An interval job is the safety net and expires entries.
- Side effects of a cancellation (credits, refunds) react to in-transaction domain events (ADR-009); notifications run after commit through the `Notifier` port.
- Background work runs in-process through `api/src/jobs/runner.ts` interval jobs (ADR-007). Jobs are idempotent and safe on several instances.
- Times are stored as `timestamptz` in UTC and shown in the club's local time (`club.timezone`, brief §7).

## 2. Technology stack
| Concern | Choice | ADR |
|---|---|---|
| Runtime | Node.js 22 LTS, TypeScript 5 (strict, ESM) | ADR-001 |
| Repo layout | npm workspaces `api`, `web` | ADR-002 |
| API framework | Fastify 5 + zod (`fastify-type-provider-zod`), `@fastify/cookie`, `@fastify/rate-limit` | ADR-003, ADR-014 |
| Database / access | PostgreSQL 16, Kysely + `pg`, Kysely Migrator | ADR-004 |
| Auth | Local e-mail/password (scrypt, `node:crypto`), opaque server-side sessions | ADR-014, ADR-015 |
| Web | React 18 + Vite 5 SPA, `react-router-dom` 6; `date-fns` + `date-fns-tz` for club-local time | ADR-005, ADR-018 |
| Tests / quality | Vitest 2, ESLint 9 + typescript-eslint, Prettier 3; GitHub Actions CI | ADR-006, ADR-017 |
| Background jobs | In-process interval jobs (`api/src/jobs/runner.ts`) | ADR-007 |

## 3. Module map

| Path | Responsibility | Introduced by |
|---|---|---|
| `.github/workflows/ci.yml` | CI pipeline: install → format → lint → typecheck → migrate → test → build | TK-119 |
| `docker-compose.yml`, `docker/initdb/` | Local PostgreSQL (`fithub`, `fithub_test`) | TK-119 |
| `api/src/config.ts` | Environment parsing and validation (zod) | TK-119; auth/session variables (US-118); `BOOKING_CANCEL_CUTOFF_MINUTES` (US-124); `WAITLIST_*` (US-128; `WAITLIST_PROMOTION_CUTOFF_MINUTES` added by US-127 if it merges first); `ATTENDANCE_*` (US-129); `NO_SHOW_*` (US-130) |
| `api/src/app.ts` | `buildApp({config, db, clock?, events?, notifier?, ...deps})` Fastify factory with injected dependencies. Records `app.routeTable` (`onRoute`, US-118), logger redaction, error handler, cookie and rate-limit plugins, the `/api` scope (US-117) with `originGuard` + `authHook` (US-118), route plugins, domain-event subscriptions | TK-119, US-117, US-118 |
| `api/src/server.ts` | Process entry point (listen, graceful shutdown). Starts/stops background loops — never `buildApp` | TK-119 |
| `api/src/db/` | `client.ts` (Kysely), `schema.ts` (table types), `migrate.ts` (CLI) | TK-119 |
| `api/migrations/` | `NNNN_snake_case.ts` with `up`/`down`: `0001_create_club` (US-117), `0002_create_app_user_and_session` (US-118), then `gym_class` (US-120), `booking` (US-122), `waitlist_entry` (US-127), … | US-117 onward |
| `api/src/routes/health.ts` | `GET /health` | TK-119 |
| `api/src/shared/errors.ts` | `DomainError(code, message, httpStatus, fieldErrors?)`, `unauthenticated()`, `forbidden(message?)`, `registerErrorHandler` (validation → 400 with one `fieldErrors` entry per field, unknown route → 404 `NOT_FOUND`, rate limit → 429, else 500) | US-118 (zod mapping completed by US-120 if missing) |
| `api/src/shared/clock.ts` | `Clock { now(): Date }`, `systemClock` | US-118 (first user), US-120 |
| `api/src/shared/domain-events.ts` | `DomainEvent` union (`BookingCancelled` US-124 + `cause` US-126, `AttendanceRecorded` US-129), `DomainEventBus` (`subscribe`, `publish(trx, event)`) | US-124 |
| `api/src/notifications/notifier.ts` | `Notifier` port, `LogNotifier`; events `waitlist_promoted` (US-128), `class_cancelled` (US-126) | US-128 |
| `api/src/jobs/runner.ts` | Interval job runner | US-128 / US-133 |
| `api/src/modules/<domain>/` | Feature modules: `routes.ts` (HTTP + zod), `service.ts` (rules, transactions), `repository.ts` (Kysely), `errors.ts`, optional `dto.ts`, `policy.ts` | Feature stories |
| `api/src/modules/auth` | `password.ts` (scrypt), `session.ts`, `repository.ts`, `service.ts` (`authenticate`, `login`), `hooks.ts` (`authHook`, `originGuard`, `requireRole`, `currentUser`), `types.ts` (`AuthUser`, `Role`), `routes.ts` (`/auth/login`, `/auth/logout`, `/me`; `bookingBlock` added by US-130), `user-admin.ts` | US-118 |
| `api/src/modules/clubs` | `repository.ts` (`listClubs`, `findClubById`, `findClubByCode`, `listInstructors`, `findInstructorInClub`), `dto.ts`, `routes.ts` (`GET /api/clubs`, `GET /api/clubs/:clubId/instructors`), `seed.ts`, `errors.ts` (`clubNotFound`, US-121) | US-117, US-120, US-121 |
| `api/src/modules/classes` | `routes.ts` (create, cancel, schedule), `service.ts` (`createClass`, `cancelClass`, `getSchedule`), `repository.ts` (`insertClass`, `findSchedule`, …), `dto.ts` (`ClassDto`, `ClassCancellationDto`), `schedule.dto.ts` (`ScheduleItem`, US-121), `schedule-window.ts` (`computeWindow`), `policy.ts` (`canCancelClass`), `notify.ts`, `errors.ts` | US-120, US-121, US-126 |
| `api/src/modules/bookings` | `service.ts` (`bookClass`, `listMyBookings`, `getBooking`, `getClassRoster`, `cancelBooking`), `access.ts` (ownership / club-scope helpers, incl. `findOwnWaitlistEntry` US-127), `dto.ts` (`BookingDto`), `cancel-window.ts`, credits | US-122–US-125, US-127 |
| `api/src/modules/waitlist` | `routes.ts`, `service.ts` (`joinWaitlist`, `leaveWaitlist`), `repository.ts`, `dto.ts` (`WaitlistEntryDto`), `errors.ts` (US-127); `promotion.ts` (`promoteNext`), `maintenance.ts` (US-128) | US-127, US-128 |
| `api/src/modules/attendance` | Attendance window, roster, auto no-show sweep, no-show block service | US-129, US-130 |
| `api/src/modules/payments` | Stripe client wrapper, webhook, retries, refunds | TK-131, US-132–US-134 |
| `api/src/modules/reports` | Weekly attendance/no-show report | US-137 |
| `api/scripts/` | Operator CLIs: `seed-clubs.ts` (US-117), `user-admin.ts` (`create`, `set-password`; US-118), `import-*` (US-135, US-136) | US-117 onward |
| `api/seed/` | `clubs.example.json` (fake values), `clubs.json` (confirmed values, pre-deploy) | US-117 |
| `api/test/unit`, `api/test/integration`, `api/test/helpers` | Vitest tests against PostgreSQL `*_test`. `helpers/factories.ts` (`createClub` US-117, `createUser` US-118, classes/bookings US-120/US-122, `createWaitlistEntry` US-127), `helpers/auth.ts` (`signInAs`, `loginViaApi`; US-118), `helpers/fakes.ts` (`FakeNotifier`, spy bus; US-128) | TK-119 onward |
| `api/test/integration/auth.protection.test.ts` | Iterates `app.routeTable`: every non-public `/api` route → 401; public set = login + logout exactly | US-118 |
| `api/test/integration/bookings.access.test.ts` | Route × actor **access matrix** for member-owned and club-scoped routes | US-123 (+US-126, US-127, US-129) |
| `web/src/` | React SPA: `pages/`, `components/`, `api/` (`client.ts` with `apiFetch`/`ApiError`, `auth.ts`, `classes.ts`, `waitlist.ts`, …), `lib/` (`auth.tsx`, `safe-next.ts`, `time.ts`). Tests under `web/test/` | TK-119, US-118 onward |
| `web/src/pages/SignInPage.tsx`, `components/RequireAuth.tsx`, `AppHeader.tsx` | Sign-in, route guard, header with "Schedule" link and sign-out | US-118, US-121 |
| `web/src/pages/NewClassPage.tsx` (`/classes/new`), `web/src/lib/time.ts` | Class creation form; club-time helpers (`clubLocalToUtc` US-120; `formatClubTime`, `formatClubDay`, `clubDateKey` US-121) | US-120, US-121 |
| `web/src/pages/SchedulePage.tsx` (`/schedule`, `/` redirects here), `components/ClassCard.tsx` (badge + `action` slot), `CancelClassButton.tsx` | Schedule; staff class cancellation | US-121, US-126 |
| `web/src/pages/MyBookingsPage.tsx`, `components/BookButton.tsx`, `WaitlistButton.tsx`, `CancelBookingButton.tsx`, `ConfirmDialog.tsx` | Booking and waiting-list UI (rendered in `ClassCard`'s action slot on the schedule) | US-122–US-124, US-127 |
| `web/src/pages/ClassAttendancePage.tsx`, `components/BookingBlockBanner.tsx` | Attendance roster (staff); block banner (members) | US-129, US-130 |

### Coding conventions
- Every request body, query and params object is validated with a zod schema in `routes.ts`. Services receive typed input only. The error handler returns **one `fieldErrors` entry per field** (first zod issue for that path).
- **Authentication is global:** `authHook` (`onRequest`, `/api` scope) authenticates every route; a public route needs `config: { public: true }`, an ADR and an update of the route-table test (ADR-015). Routes never add their own auth hook.
- **Role guards run before validation:** `requireRole(roles, message?)` is attached as `preValidation` so a wrong-role caller gets 403, never 400 (US-120). US-118's code sample shows `preHandler`; `preValidation` is the convention.
- The caller is read only with `currentUser(request)`; ids of the acting user are never taken from the body or query.
- Business errors are typed (`DomainError` with a `code` and a human-readable `message`). One handler maps them to HTTP status codes and the flat body (ADR-008).
- Every multi-step write runs in one DB transaction inside the service (`db.transaction().execute(...)`). Read endpoints (e.g. the schedule) run one statement without a transaction.
- **Lock order:** `gym_class` row first, then `booking` / `waitlist_entry` / `payment` rows (several rows in `member_id` order), then `app_user` rows (ADR-010, ADR-013). A write that starts from a child id (e.g. `DELETE /api/waitlist/:entryId`) first reads the child without a lock to get `class_id`, locks the class, then locks and re-reads the child.
- Ownership of member resources is part of the SQL `WHERE` clause (`member_id = :currentUserId`) (ADR-011).
- Authorisation rules that may change (e.g. who may cancel a class) live in one pure `policy.ts` function per module, shared by the endpoint and by flags such as `canCancel`.
- Third-party clients (Stripe, mailer), the clock, the notifier and the event bus are injected through `buildApp` deps. Tests use fakes; CI never uses real keys.
- Responses that depend on the caller (`/api/me`, `/api/classes`, `/api/me/bookings`, waiting-list join) send `Cache-Control: no-store`.
- Background loops are plain exported functions (`runXxx(deps)`) that tests call directly; `server.ts` only schedules them. Runs are idempotent and use `FOR UPDATE SKIP LOCKED`.
- Enumerations are stored as `text` with a named CHECK constraint, not as PostgreSQL enum types (ADR-008).

## 4. Data model

Tables use singular snake_case names (ADR-008). Detailed columns, constraints and migrations are fixed in each story's tech spec.

| Table | Key columns | Key constraints / indexes | Story |
|---|---|---|---|
| `club` | `id`, `code`, `name`, `timezone` (IANA), `created_at`, `updated_at` | `club_code_uq`, `club_code_format_ck` (`^[A-Z0-9-]{2,20}$`), `club_name_lower_uq (lower(name))`, `club_name_len_ck` | US-117 |
| `app_user` | `id`, `email`, `full_name`, `role` (`member`\|`instructor`\|`club_manager`), `member_type` (`regular`\|`drop_in`, null for staff), `club_id`, `password_hash` (null = cannot sign in), `legacy_member_id` | `app_user_email_lower_uq`, `app_user_role_ck`, `app_user_member_type_role_ck`, `app_user_staff_club_ck`, `app_user_legacy_member_id_uq`, index `app_user_club_idx` | US-118, US-135 |
| `user_session` | `id`, `user_id` (FK, cascade), `token_hash` bytea (SHA-256), `created_at`, `last_seen_at`, `expires_at` | `user_session_token_hash_uq`, `user_session_user_idx` | US-118 |
| `gym_class` | `id`, `club_id`, `name` varchar(100), `start_at`, `duration_minutes`, `capacity`, `status` (`scheduled`\|`cancelled`), `instructor_id` (null allowed), `created_by`, `created_at`, `updated_at`; `cancelled_at`, `cancelled_by`, `cancellation_reason` varchar(500) | CHECK `gym_class_capacity_ck capacity >= 1`, `gym_class_duration_ck`, `gym_class_name_ck`, `gym_class_status_ck`, `gym_class_cancelled_ck`. Index `gym_class_club_start_idx (club_id, start_at)`, `gym_class_instructor_idx` | US-120, US-126 |
| `booking` | `id`, `class_id`, `member_id`, `status` (`pending_payment`\|`confirmed`\|`cancelled`), `attendance` (`unknown`\|`attended`\|`no_show`), `attendance_recorded_by`, `attendance_recorded_at`, `no_show_block_id`, `source` (`direct`\|`waitlist`), `booked_at`, `cancelled_at`, `created_at`, `updated_at` | partial unique `booking_active_member_class_uq (class_id, member_id) WHERE status IN ('pending_payment','confirmed')`; CHECK `(status='cancelled') = (cancelled_at IS NOT NULL)`; `booking_attendance_recorded_ck`; indexes `booking_class_status_idx`, `booking_member_idx`, partial `booking_uncounted_no_show_idx` | US-122, US-129, US-130 |
| `waitlist_entry` | `id`, `class_id`, `member_id`, `queue_seq` (bigint identity), `status` (`waiting`\|`promoted`\|`removed`\|`expired`), `joined_at`, `ended_at`, `promoted_booking_id`, `created_at`, `updated_at` | `waitlist_entry_queue_seq_uq`; partial unique `waitlist_entry_waiting_class_member_uq (class_id, member_id) WHERE status = 'waiting'`; CHECKs `waitlist_entry_status_ck`, `waitlist_entry_ended_ck` (`(status='waiting') = (ended_at IS NULL)`), `waitlist_entry_promoted_ck`; indexes `waitlist_entry_class_status_seq_idx (class_id, status, queue_seq)`, `waitlist_entry_member_status_idx (member_id, status)` | US-127 |
| `payment` | `id`, `booking_id`, `stripe_payment_intent_id`, `amount`, `currency`, `status`, `attempts`, `next_retry_at`, `idempotency_key` (+ `refund_status`, `stripe_refund_id` US-134) | `idempotency_key` unique | US-132–US-134 |
| `credit_transaction` (+ balance) | `member_id`, `delta`, `reason` (`migration`\|`booking`\|`cancellation_refund`\|`class_cancelled_refund`\|`manual_adjustment`), `booking_id` | unique (`booking_id`, `reason`) for idempotent returns (proposed) | US-125, US-136 |
| `booking_block` | `id`, `member_id`, `reason` (`no_show`\|`manual`), `starts_at`, `ends_at`, `no_show_count`, `lifted_at`, `created_at` | CHECK `ends_at >= starts_at`; index `(member_id, ends_at)` | US-130 |
| `job` (outbox / background jobs) | `id`, `type`, `payload` jsonb, `run_at`, `attempts`, `status` | polled with `FOR UPDATE SKIP LOCKED` | US-133 (ADR-007) |

### Derived values (not stored)
- **Free places** = `capacity − count(booking WHERE status IN ('confirmed','pending_payment'))`, floored at 0; computed on read and under the class lock for writes (ADR-010).
- **Waiting-list position** = count of `waiting` entries on the class with `queue_seq <=` own `queue_seq`; `null` for non-`waiting` entries (US-127).
- **`myBookingStatus`** (schedule) = the viewer's active booking status → else `waiting` if the viewer has a `waiting` entry → else `none`; always `none` for staff (US-121, US-127).
- **`canCancel`** on schedule items = `status = 'scheduled' AND start_at > now AND canCancelClass(user, class) = 'ok'` (US-126).

### Class lifecycle (US-120, US-126)
```
(create, staff) ──► scheduled ──cancel (staff, before start)──► cancelled   (final; no reinstating)
```
Cancelling a class, in one transaction under the class lock: active bookings → `cancelled` (one `BookingCancelled { cause: 'class_cancelled' }` each), `waiting` entries → `removed`, no promotion. Members are notified after commit. Cancelled classes stay visible on the schedule with a "Cancelled" badge (US-121, assumption pending PO confirmation).

### Waiting-list lifecycle (US-127, US-128)
```
waiting ──leave (member)────────────► removed
   │   ──direct booking of same class► removed
   │   ──class cancelled (US-126)────► removed
   │   ──promotion, already booked───► removed
   ├──promotion (place freed)────────► promoted (+ booking source = waitlist)
   └──cut-off / class start (job)────► expired
```
Terminal states set `ended_at`. Re-joining creates a new row at the end of the queue. Every transition runs under the class lock (ADR-010).

### Schedule read path (US-121, extended by US-126/US-127)
`GET /api/classes` runs **one** read-only statement: `gym_class` ⋈ `club` ⟕ `app_user` (instructor) ⟕ aggregated active-booking count ⟕ the caller's active booking (US-121) ⟕ LATERAL the caller's `waiting` entry with position (US-127, members only). Window: `start_at > effectiveFrom AND start_at <= effectiveTo`, where the effective window is `(now, now + 14 × 24 h]` optionally narrowed by `from`/`to` (`schedule-window.ts`). Order `start_at, name, id`; ≤ ~560 rows (all clubs) / ~140 (one club); served by `gym_class_club_start_idx`. `instructor_id` is selected for `canCancel` (US-126) but never returned. No pagination, no caching (`Cache-Control: no-store`).

### Other data rules
- **Sessions (ADR-014):** valid when `token_hash = sha256(cookie)`, `expires_at > now` and `last_seen_at > now − idle timeout`. Expired rows of a user are deleted at that user's next sign-in.
- **Attendance (ADR-012):** only `confirmed` bookings carry attendance; `attendance_recorded_by IS NULL` with a timestamp = set by the auto no-show sweep. "Not recorded" in the report = `confirmed` and `unknown`.
- **No-show blocks (ADR-013):** a no-show counts towards a block only while `no_show_block_id IS NULL`.

Migrations: Kysely Migrator, `api/migrations/NNNN_snake_case.ts`, each with a working `down`. `npm run db:migrate` runs in CI against the test DB on every change; `migrations.test.ts` (US-117) migrates down to zero and up again.

## 5. API inventory

All business routes use the prefix **`/api`** and need a session unless marked public (ADR-015). Only `/health` and `/webhooks/stripe` are unprefixed (ADR-008); neither uses the session.

| Method & route | Access | Story |
|---|---|---|
| `GET /health` | public | TK-119 |
| `POST /api/auth/login` | **public**, rate-limited | US-118 |
| `POST /api/auth/logout` | **public** (idempotent) | US-118 |
| `GET /api/me` | signed in (`bookingBlock` for members, US-130) | US-118 |
| `GET /api/clubs` | signed in | US-117 |
| `GET /api/clubs/:clubId/instructors` | instructor, club_manager (own club) | US-120 |
| `POST /api/classes` | instructor, club_manager (own club) | US-120 |
| `POST /api/classes/:id/cancel` | club_manager (own club); instructor (own club, classes they lead — assumption) | US-126 |
| `GET /api/classes?clubId=&from=&to=` | signed in (any role) | US-121 (+US-126, US-127) |
| `POST /api/classes/:classId/bookings` | member (self) — 201 regular / 202 drop-in | US-122 |
| `GET /api/classes/:classId/bookings` | instructor, club_manager (own club) — roster | US-123 |
| `GET /api/me/bookings?period=upcoming\|past&limit=&offset=` | member (own only) | US-123 (+US-127) |
| `GET /api/bookings/:id` | owner member; staff of the class's club | US-123 |
| `POST /api/bookings/:id/cancel` | member (own only); triggers promotion | US-124, US-128 |
| `POST /api/classes/:classId/waitlist` | member (self) | US-127 |
| `DELETE /api/waitlist/:entryId` | member (own entry only) | US-127 |
| `GET /api/classes/:classId/attendance`, `PUT /api/classes/:classId/attendance` | instructor, club_manager (own club); after the window only club_manager | US-129 |
| `POST /webhooks/stripe` | Stripe (signature-verified, no session) | US-132 |
| `GET /api/reports/weekly-attendance?clubId=&week=` | club_manager (own club) | US-137 |

### Auth contract (US-118)
- `POST /api/auth/login` `{ email, password }` → 200 `MeDto` + cookie `fithub_session` (HttpOnly; SameSite=Strict; Path=/api; Max-Age = session max age; Secure in production).
- `POST /api/auth/logout` → 204, cookie cleared.
- `GET /api/me` → 200 `MeDto`, `Cache-Control: no-store`.
- `MeDto = { id, email, fullName, role, memberType: 'regular'|'drop_in'|null, clubId: string|null, clubName: string|null }`.
- Errors: 400 `VALIDATION_ERROR`; 401 `INVALID_CREDENTIALS` (identical for unknown e-mail, wrong password, no password); 401 `UNAUTHENTICATED`; 403 `FORBIDDEN` (role, or origin: "This request was blocked for security reasons."); 429 `TOO_MANY_ATTEMPTS`.

### `GET /api/clubs` contract (US-117)
- 200 `ClubDto[]` = `[{ id, code, name, timezone }]`, sorted by `name`, then `id`. No other fields, no paging (4 rows). 401 without a session.

### Class contracts (US-120, US-126)
- `POST /api/classes` body `{ clubId, name, startAt (ISO with offset), durationMinutes, capacity, instructorId? }` → 201 `ClassDto` + `Location`. Errors 400 `VALIDATION_ERROR` (per-field messages in US-120), 401, 403 (role, club scope).
- `ClassDto`: `{ id, clubId, name, startAt, durationMinutes, capacity, freePlaces, status, instructorId, instructorName, createdBy, createdAt, cancelledAt, cancellationReason }` (staff-facing).
- `POST /api/classes/:id/cancel` body `{ reason? (≤ 500) }` → 200 `ClassCancellationDto` = `ClassDto` + `{ bookingsCancelled, waitlistEntriesRemoved }`. Errors 400, 401, 403, 404 `CLASS_NOT_FOUND`, 409 `CLASS_ALREADY_CANCELLED`, 409 `CLASS_NOT_CANCELLABLE`.

### `GET /api/classes` contract (US-121)
- Access: any signed-in role; protected by the global `authHook` (ADR-015), so anonymous callers get 401 before validation.
- Query: `clubId` (UUID, optional; unknown club → 404 `CLUB_NOT_FOUND`); `from`/`to` (ISO 8601 with offset, optional). They can only narrow the window `(now, now + 14 d]` and are clamped to it; `from >= to` → 400 on field `to`; an empty window after clamping → 200 `items: []`. Unknown params are ignored.
- 200: `{ from, to, items: ScheduleItem[] }` with `Cache-Control: no-store`; `from`/`to` echo the effective window (ISO UTC).
- `ScheduleItem = { id, clubId, clubName, clubTimezone, name, startAt, durationMinutes, capacity, freePlaces, status, instructorName, myBookingStatus, myBooking, myWaitlist, canCancel }`:
  - `myBooking: { id, status: 'confirmed'|'pending_payment' } | null` — delivered by US-121; US-122 consumes it.
  - `myWaitlist: { entryId, position } | null` — reserved by US-121 (always `null`), filled by US-127 (members only).
  - `myBookingStatus: 'none'|'confirmed'|'pending_payment'|'waiting'` — an active booking wins over a waiting entry; always `none` for staff.
  - `canCancel: boolean` — added by US-126; always `false` for members.
  - Never returned: `instructorId`, `createdBy`, member ids, other members' bookings, queue length.
- Errors (flat body): 400 `VALIDATION_ERROR` (`clubId` "Choose a valid club.", `from`/`to` "Enter a valid date and time.", `to` "The end of the period must be after its start."), 401 `UNAUTHENTICATED`, 404 `CLUB_NOT_FOUND`.

### Waiting-list contract (US-127)
- `POST /api/classes/:classId/waitlist` (member, no body) → 201 `WaitlistEntryDto` `{ id, type: "waitlist", classId, className, clubId, clubName, startAt, durationMinutes, classStatus, status, position, joinedAt, promotedBookingId }`, `Cache-Control: no-store`. `position` is derived (count of `waiting` entries with `queue_seq <=` own), `null` unless `waiting`. No `memberId`, no queue length.
- `DELETE /api/waitlist/:entryId` (member, own entry) → 204.
- Guards: global `authHook` (ADR-015) → `requireRole('member', 'Only members can join waiting lists.')` as `preValidation` (403 before 400). Ownership via `bookings/access.ts` `findOwnWaitlistEntry` (ADR-011).
- Join check order (one transaction, class row locked first): `CLASS_NOT_FOUND` → `CLASS_NOT_BOOKABLE` (cancelled/started) → `WAITLIST_CLOSED` (cut-off > 0) → `BOOKING_BLOCKED` (US-130) → `ALREADY_BOOKED` → `ALREADY_ON_WAITLIST` → `CLASS_NOT_FULL` → insert (23505 on the partial unique index → `ALREADY_ON_WAITLIST`).
- Leave order: owned-entry lookup without lock (404) → lock `gym_class` → lock and re-read entry → `WAITLIST_ENTRY_NOT_ACTIVE` if not `waiting` → `removed`, `ended_at = now`. Same lock order as promotion (ADR-010), so leave vs. promotion has exactly one winner.
- Direct booking (`bookClass`, US-122) sets the member's `waiting` entry on that class to `removed` in the booking transaction; a rejected booking leaves it `waiting`.
- Errors (flat body, ADR-008): 400 `VALIDATION_ERROR`; 401 `UNAUTHENTICATED`; 403 `FORBIDDEN`; 404 `CLASS_NOT_FOUND`, `WAITLIST_ENTRY_NOT_FOUND`; 409 `CLASS_NOT_BOOKABLE`, `WAITLIST_CLOSED`, `BOOKING_BLOCKED` (US-130), `ALREADY_BOOKED`, `ALREADY_ON_WAITLIST`, `CLASS_NOT_FULL`, `WAITLIST_ENTRY_NOT_ACTIVE` (messages in the error envelope table below).

### Internal contracts
- **Promotion (US-128):** `promoteNext(trx, classId, ctx): Promise<Promotion[]>`, called inside the transaction that frees a place (booking cancel US-124, payment declined/expired US-132/US-133). The caller calls `notifyPromotions` after commit. Idempotent; returns `[]` when nothing to do (incl. non-`scheduled` classes). Class cancellation does **not** call it.
- **Waiting list (US-127):** `removeWaitingForMember(trx, classId, memberId, now)` called by `bookClass`; `listActiveEntriesForMember(db, memberId, now)` consumed by US-123 ("My bookings").
- **Domain events (ADR-009):** `BookingCancelled { bookingId, classId, memberId, previousStatus, cancelledAt, cause: 'member_cancelled' | 'class_cancelled' }` (US-124, `cause` US-126 → credits US-125, refunds US-134); `AttendanceRecorded { bookingId, memberId, classId, classStartAt, previousAttendance, attendance, recordedBy|null, recordedAt }` (US-129 → US-130).
- **Notifications (after commit):** `waitlist_promoted { memberId, bookingId, classId }` (US-128); `class_cancelled { memberId, classId, bookingId|null, waitlistEntryId|null }` (US-126).
- `BookingDto` (US-122–US-124): `id, type: "booking", memberId, classId, className, clubId, clubName, startAt, durationMinutes, classStatus, status, attendance, source, bookedAt, cancelledAt, cancelDeadline, canCancel` (+ `memberName` for staff).

### Error envelope (ADR-008)
Flat body: `{ "code": "<UPPER_SNAKE>", "message": "<plain language>", "fieldErrors"?: [{ "field", "message" }] }`. `fieldErrors` appears only with `VALIDATION_ERROR`; its top-level message is the shared handler's text (US-118). Status codes: 400 validation · 401 unauthenticated · 403 role, club scope or rejected origin only · 404 not found (also non-owned resources, ADR-011; `NOT_FOUND` for unknown routes) · 409 business conflict (including the cancellation window and `BOOKING_BLOCKED`) · 429 too many attempts · 500 `INTERNAL_ERROR` (no stack) · 503 dependency unavailable.

| Code | Status | Message | Story |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | "Please sign in to continue." | US-118 |
| `INVALID_CREDENTIALS` | 401 | "Email or password is incorrect." | US-118 |
| `FORBIDDEN` | 403 | "You don't have permission to do this." or route-specific ("Only instructors and club managers can manage classes.", "You can only manage classes for your own club.", "You can only cancel classes that you lead.", "Only members can book classes.", "Only members can join waiting lists.", "This request was blocked for security reasons.") | US-118, US-120, US-122, US-126, US-127 |
| `TOO_MANY_ATTEMPTS` | 429 | "Too many sign-in attempts. Please wait 15 minutes and try again." | US-118 |
| `NOT_FOUND` | 404 | "This page or resource does not exist." | US-118 |
| `CLUB_NOT_FOUND` | 404 | "Club not found." | US-121 |
| `CLASS_NOT_FOUND` | 404 | "This class does not exist." | US-122, US-126, US-127 |
| `CLASS_NOT_BOOKABLE` | 409 | "This class can no longer be booked." | US-122, US-127 |
| `CLASS_ALREADY_CANCELLED` | 409 | "This class has already been cancelled." | US-126 |
| `CLASS_NOT_CANCELLABLE` | 409 | "This class has already started and can no longer be cancelled." | US-126 |
| `ALREADY_BOOKED` | 409 | "You have already booked this class." | US-122, US-127 |
| `CLASS_FULL` | 409 | "This class is full. You can join the waiting list." | US-122 |
| `CLASS_NOT_FULL` | 409 | "This class has free places – book directly." | US-127 |
| `ALREADY_ON_WAITLIST` | 409 | "You are already on the waiting list for this class." | US-127 |
| `WAITLIST_CLOSED` | 409 | "The waiting list for this class is closed." | US-127 |
| `WAITLIST_ENTRY_NOT_FOUND` | 404 | "This waiting-list place does not exist." | US-127 |
| `WAITLIST_ENTRY_NOT_ACTIVE` | 409 | "You are no longer on this waiting list." | US-127 |
| `BOOKING_NOT_FOUND` | 404 | "This booking does not exist." | US-123 |
| `BOOKING_ALREADY_CANCELLED` | 409 | "This booking is already cancelled." | US-124 |
| `CLASS_CANCELLED` | 409 | "This class has been cancelled." | US-124 |
| `CANCELLATION_WINDOW_CLOSED` | 409 | "Bookings can only be cancelled up to {2 hours} before the class starts." | US-124 |
| `BOOKING_BLOCKED` | 409 | "You can't book classes until {date} because of {N} missed classes." | US-130 (booking and waiting-list join) |
| `ATTENDANCE_NOT_OPEN` | 409 | "Attendance can be recorded once the class has started." | US-129 |
| `ATTENDANCE_CLOSED` | 409 | "Attendance for this class can no longer be changed. Ask your club manager to correct it." | US-129 |
| `INTERNAL_ERROR` | 500 | "Something went wrong. Please try again." | US-118 |

## 6. Security model

### Authentication (US-118, ADR-014, ADR-015)
- Local e-mail + password (assumption pending PO confirmation). Passwords hashed with scrypt (`node:crypto`, cost 2^17, parameters stored in the hash). Unknown e-mails are verified against a dummy hash, so timing does not reveal accounts.
- Opaque random session token in cookie `fithub_session` (HttpOnly, SameSite=Strict, Path=/api, Secure in production); only its SHA-256 hash is stored. Idle timeout 12 h, maximum age 7 days (configurable). Sign-in rotates the token; sign-out and `user:set-password` delete sessions.
- **Secure by default:** a global `onRequest` `authHook` in the `/api` scope authenticates every route; only `POST /api/auth/login` and `POST /api/auth/logout` are public (`config.public`). `auth.protection.test.ts` iterates the route table, so a new route (e.g. `GET /api/classes`, the waiting-list routes) is covered without extra code.
- CSRF: `SameSite=Strict` plus `originGuard` (state-changing requests with a foreign `Origin` → 403). No CORS: the SPA is served from the same origin.
- Brute force: `@fastify/rate-limit` on login, 10 attempts per e-mail + IP per 15 minutes (in-memory store, single instance assumed).
- Logs redact cookies, `Set-Cookie`, authorization headers and passwords.

### Authorisation
- Role guard `requireRole` (as `preValidation`) on every staff- or member-only route. Read-only reference routes (`GET /api/clubs`, `GET /api/classes`) are open to every signed-in role.
- **Member-owned resources** (bookings, waiting-list entries, payments): ownership enforced in SQL by `bookings/access.ts`; a foreign resource returns the same 404 as a non-existent one (ADR-011). The schedule computes `myBooking`/`myWaitlist` only for the session's member id and never exposes other members' ids or the queue length.
- **Waiting list (US-127):** only `member` may join or leave; staff get 403 and have no waiting-list view in this release.
- **Club scope:** staff may only manage or read classes and bookings of their own club (`app_user.club_id = gym_class.club_id`). 403 on another club's class, 404 on a single booking of another club. Rosters return member names only, never e-mail addresses.
- **Class management (US-120, US-126):** creating requires `clubId = user.clubId`; instructors always lead the classes they create. Cancelling: club manager any class of own club; instructor only classes with `instructor_id = user.id` (assumption, `classes/policy.ts`). Server-set fields (`status`, `created_by`, `cancelled_by`) come from the session.
- **Attendance (US-129):** any instructor or the club manager of the class's club during the window; afterwards only the club manager.
- **No-show blocks (US-130):** visible only to the member themself.
- `bookings.access.test.ts` is the regression net: one row per route × actor (owner, other member, staff own club, staff other club, anonymous; for class cancel also instructor leading / not leading).
- Caller-specific responses carry `Cache-Control: no-store`.

### Secrets and CI
- Secrets come only from environment variables or the host's secret store; never in code, tests, logs or CI. `.env` is git-ignored and `.env.example` lists names only. There is no session signing secret (tokens are random and stored hashed).
- Notification payloads and logs contain ids only, no personal data.
- CI: `permissions: contents: read`, `pull_request` trigger only, no repository secrets.
- Integration tests refuse to run against any database whose name does not end in `_test` (ADR-017).

## 7. Integration inventory
| System | Direction | Mechanism | Status |
|---|---|---|---|
| Stripe Payments API | outbound | PaymentIntents via official `stripe` SDK, idempotency keys per attempt; refunds `refund-{bookingId}` (US-134) | EP-104, open questions (price, retry policy, refunds) |
| Stripe webhooks | inbound | `POST /webhooks/stripe`, signature verification | EP-104 |
| Legacy member data | inbound, one-off | CLI import script, idempotent upsert by dedup key | EP-105, format and dedup key open |
| Club master data | inbound, operator | `api/seed/clubs.json` + `npm run db:seed:clubs` (idempotent on `code`, never deletes) | US-117, values open |
| Email/notifications | outbound | `Notifier` port, `LogNotifier` until a channel is decided. Events: `waitlist_promoted` (US-128), `class_cancelled` (US-126) | channel open question |
| GitHub Actions | CI | `.github/workflows/ci.yml` | TK-119 |

## 8. Delivery pipeline and quality checks (FT-108)

- **Workflow `CI` / job `checks`** (TK-119) runs on every pull request and on every push to `main`: `npm ci` → `format:check` → `lint` (0 warnings) → `typecheck` → `db:migrate` (PostgreSQL 16 service, DB `fithub_test`) → `test` (unit + integration, coverage artifact) → `build`. Timeout 15 min (target < 5 min). `concurrency` cancels superseded runs. Permissions: `contents: read`; trigger `pull_request` only (never `pull_request_target`).
- `npm run ci` runs the same chain locally.
- `main` is protected: `CI / checks` required (post-deploy step in TK-119).
- **Test environment:** TK-119 sets `TZ=UTC`, `NODE_ENV=test`, `JOBS_ENABLED=false`, `DATABASE_URL=…/fithub_test`; no secrets, no `STRIPE_*`. Later stories add their own non-secret test variables to the workflow `env` (e.g. `AUTH_SCRYPT_COST=16384` with US-118). Jobs are tested by calling their run function directly.
- **Test layout:** `api/vitest.workspace.ts` projects `unit` (`test/unit/**`) and `integration` (`test/integration/**`, serial, real PostgreSQL). `web` uses jsdom + Testing Library.
- **Test-DB lifecycle (ADR-017):** `api/test/helpers/integration-global-setup.ts` enforces the `_test` name guard (`assertTestDatabase`), then migrates to latest via the shared `createMigrator`; `resetDb()` before each integration test.
- **Skeleton:** npm workspaces `api` (Fastify 5, Kysely, zod) and `web` (React + Vite); `GET /health` (public, outside `/api`) returns `200 {status:ok,db:ok}` or `503 {status:error,db:unreachable}` with no error detail.
- **Env loading:** Node's `--env-file-if-exists=../.env`; no `dotenv`.
- Not yet in place: coverage gate, E2E browser tests, CD, dependency scanning. **Until TK-119 is merged the repository has no checks at all** (today it contains only `docs/` and `.gitignore`).

## 9. Key decisions (ADR)

Format: Decision · Reason · Alternatives · Consequences. Numbering note: ADR-017…019 were numbered ADR-014…016 in the FT-109 draft of this document.

**ADR-001 – Node.js 22 + TypeScript (strict, ESM)**
· Reason: one language for SPA and API; first-class Stripe SDK; strict types catch status/enum mistakes.
· Alternatives: Python/Django, Java/Spring.
· Consequences: npm tooling; Node 22 LTS pinned via `.nvmrc` (`engines` `>=22.9 <23`).

**ADR-002 – Single repo, npm workspaces `api` and `web`**
· Reason: one PR changes API and UI together; one CI pipeline; no extra tool.
· Alternatives: separate repos, Turborepo.
· Consequences: root scripts fan out with `--workspaces`; a shared-types workspace only if needed.

**ADR-003 – Fastify 5 + zod for the API**
· Reason: TypeScript-first, schema validation at the boundary, `app.inject()` for fast HTTP tests.
· Alternatives: Express, NestJS, Next.js API routes.
· Consequences: every route declares zod schemas; `buildApp` stays a pure factory.

**ADR-004 – PostgreSQL 16 with Kysely and Kysely Migrator**
· Reason: capacity must never be exceeded under concurrency, which needs explicit transactions, row locks and partial unique indexes — Kysely expresses these with full typing.
· Alternatives: Prisma, TypeORM, raw `pg`.
· Consequences: table types in `api/src/db/schema.ts`, updated with each migration.

**ADR-005 – React + Vite SPA**
· Reason: simple client-rendered app, fast builds, same test runner.
· Alternatives: Next.js, server-rendered templates.
· Consequences: same-origin hosting (Vite proxy in dev), which ADR-014 relies on for `SameSite=Strict`.

**ADR-006 – Vitest, ESLint, Prettier and GitHub Actions with a Postgres service container**
· Reason: one test runner; real PostgreSQL proves locking and constraints; steps are portable npm scripts.
· Alternatives: Jest, Testcontainers, SQLite.
· Consequences: serial integration files, reset per test, `_test` guard (ADR-017).

**ADR-007 – In-process DB-backed job polling for background work (proposed)**
· Reason: low volume; no Redis/queue; the `job` table doubles as the outbox.
· Alternatives: BullMQ + Redis, cloud scheduler.
· Consequences: confirmed when US-133 is refined; jobs idempotent with `FOR UPDATE SKIP LOCKED`.

**ADR-008 – API and schema conventions: `/api` prefix, flat error body, singular table names, text + CHECK enums**
· Reason: the first stories already use `/api/...`, `{ code, message, fieldErrors? }`, `club`/`app_user`/`gym_class` (`user` is reserved in PostgreSQL, `class` is a TS keyword). `text` + CHECK is easier to extend and roll back.
· Alternatives: nested `{ error: {...} }` body and plural tables (first draft); PostgreSQL enums.
· Consequences: business-rule rejections use 409 (incl. cancellation window and `BOOKING_BLOCKED`); 403 only for role, club scope or a rejected origin; `/health` and `/webhooks/stripe` stay outside `/api`.

**ADR-009 – Side effects through in-transaction domain events**
· Reason: cancelling a booking must atomically free the place, promote, return credits and enqueue refunds; DB-only handlers run inside the transaction, I/O handlers only enqueue a `job` row.
· Alternatives: direct cross-module calls, after-commit events, a broker.
· Consequences: injected `DomainEventBus`; a handler failure rolls back the write; handlers fast and idempotent. Exception kept deliberately small: `bookClass` calls `waitlist.removeWaitingForMember` directly (US-127) — one same-transaction DB update with no other subscribers, so an event would add indirection without benefit.

**ADR-010 – Derived free places with a class row lock and a fixed lock order**
· Reason: no drifting counter; cheap count at ≤ ~40 places; `gym_class` first, child rows second avoids deadlocks.
· Alternatives: stored `booked_count`, SERIALIZABLE with retries, advisory locks.
· Consequences: partial unique index as second line of defence; order extended by ADR-013 (`app_user` last). Reads (schedule) compute the count without locks and may be momentarily stale; writes re-check under the lock. Writes addressed by a child id (waiting-list leave, US-127) read the child unlocked, lock the class, then lock and re-check the child.

**ADR-011 – Ownership enforced in SQL; foreign resources return 404**
· Reason: no leaks through a forgotten post-fetch check; 404 does not reveal existence.
· Alternatives: fetch-then-check, PostgreSQL RLS.
· Consequences: all access through `bookings/access.ts` (bookings, waiting-list entries via `findOwnWaitlistEntry`); the access matrix test must grow with every new route.

**ADR-012 – Attendance captured by staff on a roster, stored on `booking`, with a time window and opt-in auto no-show**
· Reason: no hardware; reuses club scope; one row per member and class; window limits late edits; auto no-show off by default.
· Alternatives: separate `attendance` table, member self check-in/QR, auto no-show always on.
· Consequences: only `confirmed` bookings carry attendance; `AttendanceRecorded` in the same transaction; PO confirmation pending (US-129).

**ADR-013 – No-show block counted from uncounted no-shows, decided per member under a row lock**
· Reason: `booking.no_show_block_id` records which no-shows were used; locking `app_user` serialises decisions per member; values configurable.
· Alternatives: count since last block, stored counter, nightly batch.
· Consequences: `assertNotBlocked` in booking and waiting-list join (409 `BOOKING_BLOCKED`).

**ADR-014 – Local e-mail/password accounts with opaque, hashed server-side sessions (assumption pending PO confirmation)**
· Reason: no identity provider is named; members already exist as records to import. Server-side sessions can be revoked and role/club changes apply on the next request; storing only the token hash means a DB leak yields no usable sessions and no signing secret is needed; scrypt from `node:crypto` avoids a native dependency.
· Alternatives: JWT (no revocation, stale claims), external IdP (not requested, cost), argon2id via `@node-rs/argon2` (extra dependency), magic links (need the open e-mail channel).
· Consequences: one indexed lookup per request; `@fastify/cookie` and `@fastify/rate-limit` added; `authenticate()` is the single replacement point for SSO; account onboarding is a follow-up story once the PO answers.

**ADR-015 – Secure-by-default route protection with a public allow-list and a route-table test**
· Reason: brief §7 asks for authorisation on every endpoint. A global `onRequest` hook in the `/api` scope cannot be forgotten; recording routes with `onRoute` lets one test assert that every non-public route returns 401 and that the public list is exactly sign-in and sign-out.
· Alternatives: a `requireAuth` hook per route (relies on reviewers), separate plugin contexts per protection level.
· Consequences: a new public route needs `config: { public: true }`, an ADR and an update of the test's allow-list; anonymous callers get 401 before validation (400) or lookup (404); US-117 and US-118 ship together.

**ADR-016 – Club master data from a reviewed seed file, not an admin UI**
· Reason: four clubs that rarely change and no requirement for club administration; a versioned JSON file is reviewed and audited; the seed is idempotent on `code` and never deletes.
· Alternatives: clubs hard-coded in a migration; an admin UI (out of scope).
· Consequences: club changes are operator tasks (`db:seed:clubs`); each club carries its own time zone; retiring a club needs a future story.

**ADR-017 – Test databases guard and migrate themselves; env files loaded by Node natively** (was "ADR-014" in the FT-109 draft)
· Reason: a clean clone must not hit the dev DB; `globalSetup` guards `_test` and migrates; `--env-file-if-exists` instead of `dotenv`.
· Alternatives: separate `db:migrate:test`, `dotenv`, Testcontainers.
· Consequences: Node ≥ 22.9; migrations re-runnable.

**ADR-018 – `date-fns-tz` for club-local time in the web app** (was "ADR-015" in the FT-109 draft)
· Reason: staff enter date and time in the club's time zone (US-120) and the schedule groups and formats by club-local day (US-121); converting correctly across DST needs a time-zone lookup that `Intl.DateTimeFormat` can format but not parse. `fromZonedTime` / `formatInTimeZone` do both, small and tree-shakeable.
· Alternatives: hand-written `Intl` offset trick (error-prone around DST), Luxon/Day.js (larger or plugin-based), sending local time + time zone to the API.
· Consequences: web dependencies `date-fns` + `date-fns-tz`; the API accepts and returns only ISO 8601 (UTC out, offset in); `time.test.ts` covers a DST-change date.

**ADR-019 – Class cancellation in one transaction, cause carried on `BookingCancelled`, no promotion (US-126)** (was "ADR-016" in the FT-109 draft)
· Reason: a cancelled class must not leave active bookings or waiting entries behind, and credit/refund handlers must know the club cancelled. Reusing `BookingCancelled` with `cause` lets US-125/US-134 handle both cases with one subscriber; the class lock makes concurrent bookings, joins and promotions see `cancelled`.
· Alternatives: a separate `ClassCancelled` event expanded by each handler; a `cancellation_cause` column on `booking`; soft cancel with async cleanup.
· Consequences: `BookingCancelled.cause` is required; one event per booking (≤ ~40) inside the transaction; notifications after commit; permission rule isolated in `classes/policy.ts` pending PO confirmation.

**ADR-020 – One viewer-aware schedule read model with reserved fields (US-121)**
· Reason: the schedule is the hub for booking, waiting list and class cancellation. One endpoint returning per-item viewer state (`myBooking`, `myWaitlist`, `myBookingStatus`, `canCancel`) lets the UI render every card from one request and keeps the query single-round-trip. US-121 defines the full item shape up front (later fields nullable/reserved) so US-122/US-126/US-127 extend the query and fill fields without changing the contract.
· Alternatives: separate calls for "my bookings on these classes" and "my waiting entries" (N+1 or client-side joins, more latency); the staff `ClassDto` reused for members (exposes `instructorId`/`createdBy`); caching the public schedule (impossible once viewer fields are included).
· Consequences: the response is caller-specific → `Cache-Control: no-store`; staff always get `none`/`null` for member fields; the query grows with each extension and must stay one statement (≤ 560 rows); free places on the schedule are a snapshot, writes re-check under the class lock (ADR-010).

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Concurrent full-document saves by different refinements overwrite each other (this happened: US-117/US-118 content was lost and ADR-014…016 numbers were reused) | Med | Med | Agents update single `##` sections where possible. The section tool does not address `###` subsections — it appends a new section. Agents re-read the full document before any full rewrite |
| Stories reference old ADR numbers: US-126 cites "ADR-016" (now ADR-019); TK-119 may cite "ADR-014" for the test-DB guard (now ADR-017). US-120 was fixed on 2026-10-31 | Med | Low | Planner informed; fix the references when the stories are next touched. The content is unchanged |
| US-122 may still use the old 401 text "Please sign in." and a per-route `requireAuth` (US-120 and US-127 are aligned) | Med | Low | ADR-008/ADR-015 and §5 are authoritative (flat body, 409, "Please sign in to continue.", global hook); align during implementation |
| US-127 merges before US-123 / US-128, so the shared pieces (`bookings/access.ts`, `bookings.access.test.ts`, `WAITLIST_PROMOTION_CUTOFF_MINUTES`) do not exist yet | Med | Low | The US-127 spec says "create if missing" with the same definition; the later story extends instead of re-creating |
| The `requireRole` example in US-118 uses `preHandler`, but US-120 needs `preValidation` (403 before 400) | Med | Low | Convention in §3: attach as `preValidation`. `requireRole(roles, message?)` returns a plain hook function usable in either |
| The zod major version (3 vs 4) changes the ISO date-time API (`z.string().datetime` vs `z.iso.datetime`) | Low | Low | TK-119 pins the version; the US-120 spec names both forms |
| A staff user without `club_id` cannot create classes | Low | Low | The service returns 403 club scope; `user:create` (US-118) should require a club for staff |
| The PO picks SSO or another auth method after US-118 is built | Med | Med | `authenticate()` is the single replacement point; guards, sessions and `request.user` stay |
| Imported members (US-135) and new drop-ins have no password and cannot sign in on day one | High | High | Open question on onboarding; follow-up story before go-live; operator CLI in the meantime |
| US-117 merged before US-118 leaves `GET /api/clubs` without auth on `main` | Med | Low | Release constraint: ship them together; the route-table test covers the route |
| In-memory rate-limit store not shared between API instances | Low | Med | Single instance assumed; move to a shared store when scaling out |
| scrypt 2^17 uses 128 MiB per concurrent sign-in | Low | Med | Rate limit, low volume, and the libuv pool caps concurrency; cost is configurable |
| Club master data not confirmed before go-live | Med | Med | Pre-deploy step on US-117; the seed refuses to run without `clubs.json` |
| Schedule shows stale free places between load and booking | High | Low | Expected (no real-time updates). Booking re-checks under the class lock, and the UI refreshes after every action and on error (US-121/US-122) |
| Schedule query degrades as US-126/US-127 add joins | Low | Med | Single statement, ≤ 560 rows, indexed joins; p95 < 300 ms target checked against the integration test data set |
| Drop-in bookings hold places in `pending_payment` if US-122 ships before US-132/US-133 | Med | Med | Release constraint on US-122; hold expiry defined in US-133 |
| A class is cancelled while drop-in payments are live but refunds (US-134) are not | Med | High | Pre-deploy step on US-126: manual refunds in Stripe; deliver US-134 with US-132 |
| Class cancellation assumptions are wrong (instructor scope, full refund/credit, no reinstating, cancelled classes visible on the schedule) | Med | Med | Rules isolated in `classes/policy.ts`, the US-125/US-134 handlers and one badge rule in `ClassCard`; questions recorded |
| Members of a cancelled class are not actually informed (log-only notifier) | High | Med | "Cancelled" badge on the schedule and `classStatus` in "My bookings"; channel question open |
| Members join a waiting list but promotion (US-128) is not live yet, so nobody is ever promoted | Med | Med | Release constraint: ship US-127 and US-128 together (same feature FT-112) |
| `BookingCancelled.cause` added after US-124 merged → compile error | Med | Low | US-126 updates the call and test in the same PR |
| Repository is not on GitHub, so the workflow does not run | Low–Med | Low | Steps are npm scripts (`npm run ci`) |
| Branch protection not enabled, so red builds get merged | Med | High | Post-deploy manual step on TK-119 |
| Concurrent bookings exceed capacity | Med | High | Class row lock + partial unique index (ADR-010), parallel integration tests |
| Deadlocks between book, cancel, class cancel, waiting-list join/leave, promotion, attendance and block decisions | Low | Med | Fixed lock order `gym_class` → child rows by `member_id` → `app_user`; leave locks the class before the entry; parallel leave/join test in US-127 |
| A slow or failing event handler blocks cancellations | Low | Med | DB-only handlers, I/O to the outbox (ADR-009) |
| A new route is added without an access check | Med | High | Secure-by-default hook + route-table test (ADR-015); `access.ts`/`policy.ts` + access-matrix test (ADR-011) |
| Flaky integration tests from shared DB state or time | Med | Med | Serial files, `resetDb()`, `TZ=UTC`, injected clock (schedule window, session expiry, class start validation) |
| Integration tests run against a real database | Low | High | `_test` name guard (ADR-017) |
| Duplicate Stripe charges or refunds on retry | Med | High | Idempotency keys + unique `payment.idempotency_key` (US-133), `refund-{bookingId}` (US-134) |
| Instructors forget to record attendance | Med | High | Auto no-show off by default; the report shows "not recorded"; manager corrections |
| No-show threshold/window go live with provisional values | Med | Med | Pre-deploy step on US-130; configuration only |
| Time zone assumption wrong | Low | Med | UTC storage, per-club `timezone` (US-117), DST tests (ADR-018) |

## 11. Open questions (architecture-relevant)

- Authentication method (local vs SSO) and how imported members and drop-ins get access: invitation, self-registration or front desk (US-118, US-135).
- Whether a cross-club admin/head-office role is needed, and whether one person can be both staff and member (US-118).
- Club codes, names and time zones (US-117).
- Repository hosting and an admin for branch protection (TK-119).
- Hosting/deployment target: same-origin serving, HTTPS, reverse proxy (`TRUST_PROXY`), single or multiple instances (rate-limit store), secret store.
- Notification channel (US-126, US-128; also block notifications for US-130).
- Whether members can book at any club or only their home club (US-122 assumes any club; the schedule shows all clubs to everyone).
- Whether cancelled classes should stay visible on the schedule (US-121 assumes yes, with a "Cancelled" badge).
- How long a drop-in `pending_payment` hold lasts (US-133).
- Attendance capture details (US-129); no-show threshold and window (US-130).
- Waiting list (US-127/US-128): maximum length (assumed none), promotion cut-off (default 0), drop-in promotion as `pending_payment`, notification channel.
- **Class cancellation (US-126):** may instructors cancel any class of their club or only those they lead (built: only those they lead)? Full credit return/refund without penalty? Cancellation until start only? Final (no reinstating)?

## FT-111 Booking and cancellation (US-123, US-124) – refinement notes

Re-checked US-123 and US-124 against §3–§5, ADR-008/009/010/011/016: specs are consistent with the API inventory and internal contracts; no contract changes.

- **Access (US-123):** `bookings/access.ts` is the single place deciding booking access. Ownership (`member_id`) or club (`club_id`) is always in the SQL `WHERE`; foreign and unknown ids return identical `404 BOOKING_NOT_FOUND`. Staff are read-only on bookings. `GET /api/classes/:classId/bookings` returns names, no e-mail.
- **Cancel (US-124):** `POST /api/bookings/:id/cancel`, member only. One transaction; lock order `gym_class` → `booking` (ADR-010); check order: not found 404 → already cancelled 409 → class cancelled 409 → window closed 409. Window `now <= start − BOOKING_CANCEL_CUTOFF_MINUTES` (default 120, 0–1440, startup validation). `BookingCancelled` is published inside the transaction (`cause: 'member_cancelled'`); a handler error rolls back the cancel.
- **New shared module:** `api/src/shared/domain-events.ts` (event bus, injected via `buildApp({ events })`). No production handler until US-125.
- **Merge-order note:** the `promoteNext` call (US-128) is added to `cancelBooking` by whichever story merges second.
- **Risk (low):** `getOwnBookingForUpdate` is used as an unlocked pre-read in US-124 despite its name; the row is re-read under lock. Developers must not skip the re-read.
- **Checks:** none configured until TK-119; tests run via `npm test -w api` / `-w web`.

## FT-115 Member and class credit import (US-135, US-136) – refinement notes

**Shape:** two operator-only CLIs (`import:members`, `import:credits`) on one shared module `api/src/modules/imports/` (csv, normalize, errors, report, repository). No HTTP route, no UI. Pure `parse` and `plan` functions; apply runs in one transaction; dry run runs plan only.

**Data model:** new table `import_member_alias (legacy_member_id PK, user_id FK, created_at)` (US-135) so merged legacy numbers still resolve. US-136 adds no tables: it writes `credit_balance` and `credit_transaction` (`reason = 'migration'`) created by US-125. Build order: US-125 migration, US-135, US-136.

**Idempotency / concurrency:** members matched by lower(email) or alias; credits by `credit_transaction_migration_uq (member_id) WHERE reason='migration'`. Both CLIs take `pg_advisory_xact_lock(735136)`, so imports never run in parallel.

**Reconciliation:** every source row has one outcome; counts must add up (members: inserted+updated+unchanged+merged+rejected; credits also sum of credit values) or the run rolls back and exits 1.

**Decisions**
- ADR-022 (members, from US-135): canonical CSV contract; operator converts the real FitHub export beforehand. Reason: the source format is unknown. Alternative: parsing the raw spreadsheets.
- ADR-023: credit import never updates an existing migrated total. A different total is rejected `ALREADY_MIGRATED_DIFFERENT_TOTAL`. Reason: the ledger is append-only. Alternative: delta rows for corrections (rejected: needs a new reason).
- ADR-024: credits of merged/duplicate rows are summed; drop-in/staff rows are rejected. Both are PO-to-confirm assumptions.

**Risks**
- Dedup key (email) and type mapping not yet confirmed. Medium likelihood, high impact; the key and mapping are isolated in one plan function and a data file.
- Imported members have no password (onboarding open question, US-118). They cannot sign in until resolved.
- Summing duplicate credit rows may double-count an accidental duplicate. Mitigation: merges report reviewed in the dry run.
- Credit expiry dates in the source are ignored.
- Personal data in import files and reports. Mitigation: git-ignored dirs, deletion after sign-off.
- Credits must be imported before members get access (US-125).
