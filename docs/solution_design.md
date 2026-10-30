# FitHub – Solution Design

Status: living document. **Last update:** refinement of FT-107, covering US-117 (club seed) and US-118 (sign-in, sessions, roles).
- What this update adds: auth and session design, the secure-by-default route protection, the shared error handler, and ADR-014 to ADR-016.
- What it fixes: it merges the duplicated sections 4 and 5 into one each. It also removes three contradictions: the nested error body, 422 for the cancellation window, and 403 for `BOOKING_BLOCKED`. The values ADR-008 already decided apply.

Earlier updates: FT-112 (US-127, US-128), FT-108/TK-119, US-121, US-122.

## 1. Architecture overview
FitHub is a **web app backed by a JSON API** (brief §1). It is built as a single repository with two npm workspaces:

```
Browser (React SPA, web/)  ──HTTP/JSON + session cookie──►  API (Fastify, api/)  ──SQL──►  PostgreSQL 16
                                              │
                                              ├──► Stripe Payments API (PaymentIntents)  [EP-104]
                                              ◄── Stripe webhooks (/webhooks/stripe)      [EP-104]
                                              ├──► Notifier port (LogNotifier now; email/SMS TBD)  [US-128, ADR-012]
                                              └── in-process interval jobs (waitlist-maintenance, payment-retry)  [ADR-007]
Operator CLIs (api/scripts/: seed-clubs, user-admin, import-*) ──► PostgreSQL       [US-117, US-118, EP-105]
```

- The API is the only component that talks to the database and to Stripe. The SPA holds no business rules. All checks (authentication, roles, capacity, double booking, windows) run on the server.
- **Authentication is secure by default** (ADR-015). One `onRequest` hook in the `/api` scope resolves the session cookie on every route. Only routes marked `config: { public: true }` skip it, and today those are sign-in and sign-out. Sessions are opaque tokens stored hashed in PostgreSQL (ADR-014).
- **Place allocation is serialised per class** by a row lock on `gym_class` (ADR-010). Booking, cancellation, waiting-list join and promotion all take this lock first.
- **Waiting-list promotion runs synchronously** inside the transaction that frees the place (ADR-009, US-128). An interval job is the safety net and expires entries.
- Background work runs in-process through `api/src/jobs/runner.ts` (ADR-007). Jobs are idempotent and safe when several instances run.
- Times are stored as `timestamptz` in UTC. They are shown in the club's local time, taken from `club.timezone` (US-117).

## 2. Technology stack
| Concern | Choice | ADR |
|---|---|---|
| Runtime | Node.js 22 LTS, TypeScript 5 (strict, ESM) | ADR-001 |
| Repo layout | npm workspaces `api`, `web` | ADR-002 |
| API framework | Fastify 5 + zod (`fastify-type-provider-zod`); `@fastify/cookie`, `@fastify/rate-limit` (US-118) | ADR-003, ADR-014 |
| Database / access | PostgreSQL 16, Kysely + `pg`, Kysely Migrator | ADR-004 |
| Password hashing | `node:crypto` scrypt (no extra dependency) | ADR-014 |
| Web | React 18 + Vite 5 SPA, `react-router-dom` 6 (US-118) | ADR-005 |
| Tests / quality | Vitest 2, ESLint 9 + typescript-eslint, Prettier 3; GitHub Actions CI | ADR-006 |
| Background jobs | In-process interval jobs (`api/src/jobs/runner.ts`) | ADR-007 |

Note: the US-120 spec mentioned Express/Knex/`apps/` in an early draft. TK-119 and this table are authoritative.

## 3. Module map

| Path | Responsibility | Introduced by |
|---|---|---|
| `.github/workflows/ci.yml` | CI: install → format → lint → typecheck → migrate → test → build | TK-119 |
| `docker-compose.yml`, `docker/initdb/` | Local PostgreSQL (`fithub`, `fithub_test`) | TK-119 |
| `api/src/config.ts` | Environment parsing and validation (zod) | TK-119; auth/session variables (US-118); `BOOKING_CANCEL_CUTOFF_MINUTES` (US-124); `ATTENDANCE_*` (US-129); `NO_SHOW_*` (US-130) |
| `api/src/app.ts` | `buildApp({config, db, clock?, events?, ...deps})` Fastify factory with injected dependencies. It records `app.routeTable` (US-118), registers the error handler, cookie and rate-limit plugins, the `/api` scope (US-117) with `originGuard` and `authHook` (US-118), the route plugins, and the domain-event subscriptions | TK-119, US-117, US-118 |
| `api/src/server.ts` | Process entry point (listen, graceful shutdown). It starts and stops the background loops; `buildApp` never does | TK-119 |
| `api/src/db/` | `client.ts` (Kysely), `schema.ts` (table types), `migrate.ts` (CLI) | TK-119 |
| `api/migrations/` | `NNNN_snake_case.ts` with `up`/`down`. `0001_create_club` (US-117), `0002_create_app_user_and_session` (US-118), … | US-117 onward |
| `api/src/routes/health.ts` | `GET /health` | TK-119 |
| `api/src/shared/errors.ts` | `DomainError(code, message, httpStatus, fieldErrors?)`, `unauthenticated()`, `forbidden()`, and the global error handler (validation → 400, unknown route → 404, otherwise 500) | US-118 |
| `api/src/shared/clock.ts` | `Clock { now(): Date }`, `systemClock` | US-118 (session expiry) |
| `api/src/shared/domain-events.ts` | `DomainEvent` union, `DomainEventBus` (`subscribe`, `publish(trx, event)`) | US-124 |
| `api/src/modules/<domain>/` | Feature modules: `routes.ts` (HTTP + zod), `service.ts` (rules, transactions), `repository.ts` (Kysely), `errors.ts`, optional `dto.ts` | Feature stories |
| `api/src/modules/clubs` | `repository.ts` (`listClubs`, `findClubById`, `findClubByCode`), `dto.ts`, `routes.ts` (`GET /api/clubs`), `seed.ts` (`parseClubSeed`, `seedClubs`) | US-117 |
| `api/src/modules/auth` | `password.ts` (scrypt), `session.ts`, `repository.ts`, `service.ts` (`authenticate`, `login`), `hooks.ts` (`authHook`, `originGuard`, `requireRole`, `currentUser`), `types.ts` (`AuthUser`, `Role`), `routes.ts` (`/auth/login`, `/auth/logout`, `/me`), `user-admin.ts`. US-130 adds `bookingBlock` to `/me` | US-118 |
| `api/src/modules/classes` | Create/cancel class, schedule query, class DTO (`freePlaces`, `myBooking`) | US-120, US-121, US-126 |
| `api/src/modules/bookings` | `service.ts`, `access.ts` (ownership and club-scope helpers), `dto.ts` (`BookingDto`), `cancel-window.ts`, credits | US-122–US-125 |
| `api/src/modules/waitlist` | Join/leave the waiting list, promotion (subscribes to `BookingCancelled`) | US-127, US-128 |
| `api/src/modules/attendance` | Attendance window, roster, recording, auto no-show sweep (off by default), no-show block service | US-129, US-130 |
| `api/src/modules/payments` | Stripe client wrapper, webhook, retries, refunds | TK-131, US-132–US-134 |
| `api/src/modules/reports` | Weekly attendance/no-show report | US-137 |
| `api/scripts/` | Operator CLIs: `seed-clubs.ts` (US-117), `user-admin.ts` (`create`, `set-password`; US-118), `import-*` (US-135, US-136) | US-117 onward |
| `api/seed/` | `clubs.example.json` (fake values), `clubs.json` (confirmed values, pre-deploy) | US-117 |
| `api/test/unit`, `api/test/integration`, `api/test/helpers` | Vitest tests. `helpers/factories.ts`: `createClub` (US-117), `createUser` (US-118), classes and bookings (US-120/US-122). `helpers/auth.ts`: `signInAs(db, user)` returns a session cookie without scrypt (US-118) | TK-119 onward |
| `api/test/integration/auth.protection.test.ts` | Iterates `app.routeTable` and asserts 401 for every non-public `/api` route. Also asserts that the set of public `/api` routes is exactly login and logout | US-118 |
| `api/test/integration/bookings.access.test.ts` | Route × actor access matrix for member-owned and club-scoped resources | US-123 onward |
| `web/src/` | React SPA: `pages/`, `components/`, `api/` (`client.ts` with `ApiError`, `auth.ts`), `lib/` (`auth.tsx` `AuthProvider`/`useAuth`, `safe-next.ts`). Tests under `web/test/` | TK-119, US-118 onward |
| `web/src/pages/SignInPage.tsx`, `web/src/components/RequireAuth.tsx`, `AppHeader.tsx` | Sign-in page, route guard, signed-in header with sign-out | US-118 |
| `web/src/pages/MyBookingsPage.tsx`, `components/BookButton.tsx`, `CancelBookingButton.tsx`, `ConfirmDialog.tsx` | Booking UI | US-122–US-124 |
| `web/src/pages/ClassAttendancePage.tsx`, `components/BookingBlockBanner.tsx` | Attendance roster (staff); block banner (members) | US-129, US-130 |

### Coding conventions
- Every request body, query and params object is validated with a zod schema in `routes.ts`. Services receive typed input only.
- Business errors are `DomainError`s with a `code` and a human-readable `message`. One error handler maps them to the flat body `{ code, message, fieldErrors? }` (ADR-008).
- **The caller's identity comes only from `currentUser(request)`.** Ids, roles and clubs in the request body are never trusted.
- **New `/api` routes are protected automatically.** Add `config: { public: true }` only with an ADR. Staff-only routes add `preHandler: requireRole([...], message?)`.
- Every multi-step write runs in one DB transaction inside the service.
- **Lock order:** `gym_class` row first, then `booking` / `waitlist_entry` / `payment` rows (in `member_id` order), then `app_user` rows (ADR-010, ADR-013).
- Ownership of member resources is part of the SQL `WHERE` clause (ADR-011).
- Third-party clients, the clock and the event bus are injected through `buildApp` deps. Tests use fakes, and CI never uses real keys.
- Background loops are exported `runXxx(deps)` functions. They are idempotent and use `FOR UPDATE SKIP LOCKED`.
- Operator CLIs are thin wrappers: the logic lives in a module function that tests call directly (`seedClubs`, `createUser`, `setPassword`). Secrets such as passwords are read from stdin and never accepted as command-line arguments.
- Enumerations are `text` + CHECK, not PostgreSQL enum types (ADR-008).

## 4. Data model

Table names are singular snake_case (ADR-008). Each story's tech spec fixes the detailed columns, constraints and migrations. Status values are `text` + CHECK.

| Table | Key columns | Key constraints / indexes | Story |
|---|---|---|---|
| `club` | `id` uuid, `code`, `name`, `timezone` (IANA, no default), `created_at`, `updated_at` | `club_code_uq`, CHECK `code ~ '^[A-Z0-9-]{2,20}$'`, unique `lower(name)`, CHECK name length 1–100 | US-117 |
| `app_user` | `id` uuid, `email`, `full_name`, `role` (`member`\|`instructor`\|`club_manager`), `member_type` (`regular`\|`drop_in`), `club_id` → `club`, `password_hash` (nullable), `legacy_member_id`, `created_at`, `updated_at` | unique `lower(email)`; `legacy_member_id` unique; CHECK `(role='member') = (member_type IS NOT NULL)`; CHECK `role='member' OR club_id IS NOT NULL`; index `club_id` | US-118, US-135 |
| `user_session` | `id` uuid, `user_id` → `app_user` (cascade), `token_hash` bytea (SHA-256), `created_at`, `last_seen_at`, `expires_at` | `token_hash` unique; index `user_id` | US-118 |
| `gym_class` | `id`, `club_id`, `name`, `start_at`, `duration_minutes`, `capacity`, `status` (`scheduled`\|`cancelled`), `instructor_id`, `created_by`, `created_at`, `updated_at` | CHECK `capacity >= 1`, `duration_minutes > 0`, `length(btrim(name)) > 0`; index `(club_id, start_at)`, `instructor_id` | US-120 (cancel columns: US-126) |
| `booking` | `id`, `class_id`, `member_id`, `status` (`pending_payment`\|`confirmed`\|`cancelled`), `attendance` (`unknown`\|`attended`\|`no_show`), `attendance_recorded_by` (null = system), `attendance_recorded_at`, `no_show_block_id` → `booking_block`, `source` (`direct`\|`waitlist`), `booked_at`, `cancelled_at`, `created_at`, `updated_at` | partial unique `booking_active_member_class_uq (class_id, member_id) WHERE status IN ('pending_payment','confirmed')`; CHECK `(status='cancelled') = (cancelled_at IS NOT NULL)`; CHECK `(attendance='unknown') = (attendance_recorded_at IS NULL)`; indexes `(class_id, status)`, `(member_id)`, partial `booking_uncounted_no_show_idx` | US-122, US-129, US-130 |
| `waitlist_entry` | `id`, `class_id`, `member_id`, `queue_seq` (bigint identity), `status` (`waiting`\|`promoted`\|`removed`\|`expired`), `joined_at`, `ended_at`, `promoted_booking_id` → `booking` | `queue_seq` unique; partial unique `(class_id, member_id) WHERE status='waiting'`; CHECK `(status='waiting') = (ended_at IS NULL)`; CHECK `promoted_booking_id IS NULL OR status='promoted'`; index `(class_id, status, queue_seq)`, `(member_id, status)` | US-127 |
| `payment` | `id`, `booking_id`, `stripe_payment_intent_id`, `amount`, `currency`, `status`, `attempts`, `next_retry_at`, `idempotency_key` | `idempotency_key` unique | US-132, US-133 |
| `credit_transaction` (+ balance view) | `member_id`, `delta`, `reason`, `booking_id` | | US-125, US-136 |
| `booking_block` | `id`, `member_id`, `reason` (`no_show`\|`manual`), `starts_at`, `ends_at`, `no_show_count`, `lifted_at`, `created_at` | CHECK `ends_at >= starts_at`; index `(member_id, ends_at)` | US-130 |
| `job` (outbox / background jobs) | `id`, `type`, `payload` jsonb, `run_at`, `attempts`, `status` | polled with `FOR UPDATE SKIP LOCKED` | US-133 (ADR-007) |

**Migration order:** `0001_create_club` (US-117) → `0002_create_app_user_and_session` (US-118) → `gym_class` (US-120) → … Each migration has a working `down`. `api/test/integration/migrations.test.ts` migrates down to zero and up again.

### Derived values (not stored)
- **Free places** = `capacity − count(booking WHERE status IN ('confirmed','pending_payment'))`, floored at 0. They are computed on read and counted under the class lock (ADR-010).
- **Waiting-list position** = count of `waiting` entries with `queue_seq <=` own `queue_seq` (US-127).
- **Valid session** = `expires_at > now AND last_seen_at > now − SESSION_IDLE_TIMEOUT_MINUTES` (US-118).

### Waiting-list lifecycle (US-127, US-128)
```
waiting ──leave (member)────────────► removed
   │   ──direct booking of same class► removed
   │   ──class cancelled (US-126)────► removed
   │   ──promotion, already booked───► removed
   ├──promotion (place freed)────────► promoted (+ booking source = waitlist)
   └──cut-off / class start (job)────► expired
```

### Attendance and blocks
- Only `confirmed` bookings carry attendance (ADR-012).
- A no-show counts towards a block only while `no_show_block_id IS NULL` (ADR-013).

### Schedule read path (US-121)
`GET /api/classes` runs one query: `gym_class` ⋈ `club` ⟕ instructor ⟕ aggregated active-booking count ⟕ the caller's booking ⟕ LATERAL the caller's waiting entry. It filters `start_at > now AND start_at <= now + 14 d`, orders by `start_at, name, id`, and reads at most ~560 rows.

## 5. API inventory

All business routes use the prefix **`/api`** and need a session unless marked public. Only `/health` and `/webhooks/stripe` sit outside `/api` (ADR-008). Neither uses the session: health is public, and the webhook is verified by its Stripe signature.

| Method & route | Access | Story |
|---|---|---|
| `GET /health` | public | TK-119 |
| `POST /api/auth/login` | **public**, rate-limited | US-118 |
| `POST /api/auth/logout` | **public** (idempotent) | US-118 |
| `GET /api/me` | signed in (`bookingBlock` added for members by US-130) | US-118 |
| `GET /api/clubs` | signed in | US-117 |
| `GET /api/clubs/:clubId/instructors` | instructor, club_manager (own club) | US-120 |
| `POST /api/classes` | instructor, club_manager (own club) | US-120 |
| `POST /api/classes/:id/cancel` | instructor, club_manager (own club) | US-126 |
| `GET /api/classes?clubId=&from=&to=` | signed in | US-121 |
| `POST /api/classes/:classId/bookings` | member (self). 201 regular / 202 drop-in | US-122 |
| `GET /api/classes/:classId/bookings` | instructor, club_manager (own club). Roster | US-123 |
| `GET /api/me/bookings?period=upcoming\|past&limit=&offset=` | member (own bookings and waiting entries) | US-123, US-127 |
| `GET /api/bookings/:id` | owner member; staff of the class's club | US-123 |
| `POST /api/bookings/:id/cancel` | member (own only). Triggers promotion | US-124, US-128 |
| `POST /api/classes/:classId/waitlist` | member | US-127 |
| `DELETE /api/waitlist/:entryId` | member (own only) | US-127 |
| `GET /api/classes/:classId/attendance` | instructor, club_manager (own club) | US-129 |
| `PUT /api/classes/:classId/attendance` | instructor, club_manager (own club); after the window only club_manager | US-129 |
| `POST /webhooks/stripe` | Stripe (signature-verified, no session) | US-132 |
| `GET /api/reports/weekly-attendance?clubId=&week=` | club_manager (own club) | US-137 |

### Auth contract (US-118)
- `POST /api/auth/login` takes `{ email, password }` and returns 200 `MeDto` plus the cookie `fithub_session` (HttpOnly; SameSite=Strict; Path=/api; Max-Age = session max age; Secure in production).
- `POST /api/auth/logout` returns 204 and clears the cookie.
- `GET /api/me` returns 200 `MeDto` with `Cache-Control: no-store`.
- `MeDto = { id, email, fullName, role, memberType: 'regular'|'drop_in'|null, clubId: string|null, clubName: string|null }`.
- Errors: 400 `VALIDATION_ERROR`; 401 `INVALID_CREDENTIALS` "Email or password is incorrect." (the same for unknown e-mail, wrong password and no password); 401 `UNAUTHENTICATED` "Please sign in to continue."; 403 `FORBIDDEN` (role: "You don't have permission to do this." or a route-specific message; origin: "This request was blocked for security reasons."); 429 `TOO_MANY_ATTEMPTS`.

### `GET /api/clubs` contract (US-117)
200 `[{ id, code, name, timezone }]`, sorted by `name`, then `id`. No paging (4 rows).

### `GET /api/classes` contract (US-121)
- Query: `clubId` (UUID, optional), `from`/`to` (ISO 8601 with offset; they can only narrow the window `(now, now + 14 d]`).
- 200: `{ from, to, items: [{ id, clubId, clubName, clubTimezone, name, startAt, durationMinutes, capacity, freePlaces, status, instructorName, myBookingStatus, myBooking, myWaitlist }] }`, with header `Cache-Control: no-store`.
- Errors: 400 `VALIDATION_ERROR`, 401 `UNAUTHENTICATED`, 404 `CLUB_NOT_FOUND`.

### Waiting-list contract (US-127)
- `POST /api/classes/:classId/waitlist` → 201 `WaitlistEntryDto`.
- `DELETE /api/waitlist/:entryId` → 204.
- Errors: 400 `VALIDATION_ERROR`; 401; 403 `FORBIDDEN` (role); 404 `CLASS_NOT_FOUND`, `WAITLIST_ENTRY_NOT_FOUND`; 409 `BOOKING_BLOCKED`, `CLASS_NOT_BOOKABLE`, `WAITLIST_CLOSED`, `ALREADY_BOOKED`, `ALREADY_ON_WAITLIST`, `CLASS_NOT_FULL`, `WAITLIST_ENTRY_NOT_ACTIVE`.

### Internal service contract: promotion (US-128)
`promoteNext(trx, classId, ctx): Promise<Promotion[]>` runs inside the transaction that frees a place. The caller runs `notifyPromotions` after commit. It is idempotent.

### Error envelope (ADR-008)
Flat body: `{ "code": "<UPPER_SNAKE>", "message": "<plain language>", "fieldErrors"?: [{ "field", "message" }] }`. `fieldErrors` appears only with `VALIDATION_ERROR`.

Status codes:
- 400 `VALIDATION_ERROR`
- 401 `UNAUTHENTICATED` / `INVALID_CREDENTIALS`
- 403 `FORBIDDEN` (role, club scope or origin only)
- 404 not found, including resources owned by someone else (`NOT_FOUND` for unknown routes)
- 409 business-rule conflict (including the cancellation window and `BOOKING_BLOCKED`)
- 429 `TOO_MANY_ATTEMPTS`
- 500 `INTERNAL_ERROR` (no stack in the body)
- 503 dependency unavailable

| Code | Status | Message |
|---|---|---|
| `UNAUTHENTICATED` | 401 | "Please sign in to continue." |
| `INVALID_CREDENTIALS` | 401 | "Email or password is incorrect." |
| `FORBIDDEN` | 403 | "You don't have permission to do this." (or a route-specific message, e.g. "Only instructors and club managers can manage classes.") |
| `TOO_MANY_ATTEMPTS` | 429 | "Too many sign-in attempts. Please wait 15 minutes and try again." |
| `CLASS_NOT_FOUND` | 404 | "This class does not exist." |
| `CLASS_NOT_BOOKABLE` | 409 | "This class can no longer be booked." |
| `ALREADY_BOOKED` | 409 | "You have already booked this class." |
| `CLASS_FULL` | 409 | "This class is full. You can join the waiting list." |
| `BOOKING_NOT_FOUND` | 404 | "This booking does not exist." |
| `BOOKING_ALREADY_CANCELLED` | 409 | "This booking is already cancelled." |
| `CLASS_CANCELLED` | 409 | "This class has been cancelled." |
| `CANCELLATION_WINDOW_CLOSED` | 409 | "Bookings can only be cancelled up to {2 hours} before the class starts." |
| `BOOKING_BLOCKED` | 409 | "You can't book classes until {date} because of {N} missed classes." |
| `ATTENDANCE_NOT_OPEN` | 409 | "Attendance can be recorded once the class has started." |
| `ATTENDANCE_CLOSED` | 409 | "Attendance for this class can no longer be changed. Ask your club manager to correct it." |

**DTOs and events:**
- `BookingDto` (US-122 to US-124): `id, type: "booking", memberId, classId, className, clubId, clubName, startAt, durationMinutes, classStatus, status, attendance, source, bookedAt, cancelledAt, cancelDeadline, canCancel`. Staff viewers also get `memberName`.
- Domain events (ADR-009): `BookingCancelled` (US-124), `AttendanceRecorded` (US-129).

## 6. Security model

### Authentication (US-118, ADR-014, ADR-015)
- **Method:** local e-mail + password. This is an assumption until the PO confirms it.
- **Passwords:** scrypt (N = 2^17, r = 8, p = 1, 16-byte salt). The parameters are stored in the hash string. Sign-ins for unknown e-mail addresses verify against a dummy hash, so they take the same time.
- **Sessions:** 32 random bytes, stored only as a SHA-256 hash in `user_session`. Idle timeout 12 h, absolute limit 7 days (assumed). Sign-in rotates the token (no session fixation). Sign-out deletes the row. `set-password` ends all sessions of the user.
- **Cookie:** `fithub_session`, HttpOnly, `SameSite=Strict`, `Path=/api`, `Secure` in production.
- **CSRF:** the Strict cookie plus `originGuard`, which rejects state-changing requests whose `Origin` is not `APP_ORIGIN`. No CORS: the SPA is served from the same origin (Vite proxy in dev).
- **Brute force:** at most 10 attempts per IP + e-mail per 15 minutes (`@fastify/rate-limit`, in-memory store; see the risk table).
- **Accounts:** created by operator CLI (`user:create`, `user:set-password`; password read from stdin) and by the member import (US-135, no password). Self-registration, invitations and password reset are open questions.
- **Logs:** cookie and authorization headers, `Set-Cookie` and any `password` field are redacted. Failed sign-ins log the IP only.

### Authorisation
- **Secure by default:** every `/api` route needs a session unless it is marked `public`. `auth.protection.test.ts` fails if a route is unprotected or if a new public route appears.
- **Roles** (`member`, `instructor`, `club_manager`; one per user) are checked with `requireRole` preHandlers. 403 `FORBIDDEN` is returned before any business logic runs.
- The **database enforces** the role invariants: members have a member type, staff have a club, staff have no member type.
- **Member-owned resources** (bookings, waiting entries, payments): ownership is enforced in SQL through `bookings/access.ts`. A foreign resource returns 404 (ADR-011).
- **Club scope:** staff manage or read only their own club's classes and bookings (`app_user.club_id = gym_class.club_id`). They get 403 on another club's class and 404 on a single foreign booking. Rosters show names only, never e-mail addresses.
- **Attendance (US-129):** recorded inside the time window. After the window only the club manager can correct it. Booking ids must belong to the class in the URL.
- **No-show blocks (US-130):** visible only to the member through `/api/me`.
- The member id always comes from the session (`currentUser`), never from the request.

### Secrets and CI
- Stripe keys and the webhook secret come only from the environment or a secret store. The design needs no session secret: tokens are random and stored hashed.
- `.env` is git-ignored, and `.env.example` lists variable names only.
- CI has `permissions: contents: read`, runs on `pull_request` (never `pull_request_target`) and has no repository secrets.
- Integration tests refuse to run against a database whose name does not end in `_test`.

## 7. Integration inventory
| System | Direction | Mechanism | Status |
|---|---|---|---|
| Stripe Payments API | outbound | PaymentIntents via the official `stripe` SDK, idempotency keys per attempt | EP-104; price, retry policy and refunds open |
| Stripe webhooks | inbound | `POST /webhooks/stripe`, signature verification | EP-104 |
| Legacy member data | inbound, one-off | CLI import, idempotent upsert by dedup key into `app_user` (no password) | EP-105; format and dedup key open |
| Club master data | inbound, one-off/rare | Reviewed `api/seed/clubs.json` + `db:seed:clubs` CLI (idempotent on `code`) | US-117; values open |
| Identity provider | – | None (local accounts, ADR-014). `authenticate()` is the single replacement point if SSO is chosen | US-118; open question |
| Email/notifications | outbound | `Notifier` port (ADR-012), `LogNotifier` until a channel is chosen | Channel open |
| GitHub Actions | CI | `.github/workflows/ci.yml` | TK-119 |

## 8. Delivery pipeline and quality checks (FT-108)
- **Workflow `CI` / job `checks`** runs on every pull request and every push to `main`: `npm ci` → `format:check` → `lint` → `typecheck` → `db:migrate` → `test` → `build`.
- `npm run ci` runs the same chain locally.
- `main` is protected by the required `CI / checks` status (post-deploy step in TK-119).
- Test environment: `TZ=UTC`, `NODE_ENV=test`, `JOBS_ENABLED=false`, `AUTH_SCRYPT_COST=16384`. There are no real third-party calls.
- No checks are configured in the repository yet; TK-119 introduces them.
- Not yet in place: a coverage gate, E2E browser tests, CD and dependency scanning.

### Configuration inventory (selected)
| Variable | Default | Story |
|---|---|---|
| `DATABASE_URL`, `PORT`, `NODE_ENV`, `LOG_LEVEL` | see TK-119 | TK-119 |
| `APP_ORIGIN` | `http://localhost:5173` (required in production) | US-118 |
| `SESSION_COOKIE_SECURE` | `true` in production, else `false` | US-118 |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `720` (assumption) | US-118 |
| `SESSION_MAX_AGE_HOURS` | `168` (assumption) | US-118 |
| `AUTH_SCRYPT_COST` | `131072` (`16384` in tests) | US-118 |
| `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW_MINUTES` | `10` / `15` | US-118 |
| `TRUST_PROXY` | `false` | US-118 |
| `BOOKING_CANCEL_CUTOFF_MINUTES` | `120` | US-124 |
| `WAITLIST_PROMOTION_CUTOFF_MINUTES` | `0` (assumption) | US-128 |
| `WAITLIST_JOB_INTERVAL_SECONDS` | `60` | US-128 |
| `JOBS_ENABLED` | `true` (`false` in tests) | US-128 / US-133 |

## 9. Key decisions (ADR)

**ADR-001 – Node.js 22 + TypeScript (strict, ESM)**
- Reason: one language for SPA and API, a first-class Stripe SDK, and strict types for status logic.
- Alternatives: Python/Django, Java/Spring.
- Consequences: npm tooling; `.nvmrc` = 22.

**ADR-002 – Single repo, npm workspaces `api` and `web`**
- Reason: one PR spans API and UI, with one CI pipeline.
- Alternatives: separate repos, Turborepo.
- Consequences: root scripts fan out with `--workspaces`.

**ADR-003 – Fastify 5 + zod**
- Reason: TypeScript-first, validation at the boundary, and `app.inject()` for tests.
- Alternatives: Express, NestJS, Next.js API routes.
- Consequences: every route declares zod schemas, and `buildApp` stays a pure factory.

**ADR-004 – PostgreSQL 16 with Kysely and Kysely Migrator**
- Reason: explicit transactions, row locks and partial unique indexes, with full typing.
- Alternatives: Prisma, TypeORM, raw `pg`.
- Consequences: `schema.ts` is updated with every migration.

**ADR-005 – React + Vite SPA**
- Reason: a simple client-rendered app with fast builds.
- Alternatives: Next.js, server templates.
- Consequences: same-origin hosting (Vite proxy in dev), which ADR-014 relies on for `SameSite=Strict`.

**ADR-006 – Vitest, ESLint, Prettier, GitHub Actions with a Postgres service container**
- Reason: real PostgreSQL proves the locking and constraint behaviour.
- Alternatives: Jest, Testcontainers, SQLite.
- Consequences: integration files run serially, with a `_test` guard.

**ADR-007 – In-process DB-backed job polling (proposed)**
- Reason: low volume, so no Redis or queue is needed; the `job` table doubles as the outbox.
- Alternatives: BullMQ + Redis, a cloud scheduler.
- Consequences: idempotent jobs with `SKIP LOCKED`; to be confirmed in US-133.

**ADR-008 – `/api` prefix, flat error body, singular table names, text + CHECK enums**
- Reason:
  - The early stories already used these conventions.
  - `user` is a reserved word in PostgreSQL, hence `app_user`; `class` clashes with the TypeScript keyword, hence `gym_class`.
  - CHECKs are easier to change than enum types.
- Alternatives: a nested `{ error: {…} }` body, plural tables, PostgreSQL enums.
- Consequences:
  - Business-rule rejections are 409, including the cancellation window and `BOOKING_BLOCKED`.
  - 403 is only for role, club scope or a rejected origin.
  - `/health` and `/webhooks/stripe` stay outside `/api`.

**ADR-009 – Side effects through in-transaction domain events**
- Reason: cancel, promote, credit and refund-enqueue happen atomically, with no network I/O inside the transaction.
- Alternatives: direct service calls, after-commit events, a broker.
- Consequences: a handler failure rolls back the triggering write; handlers must be fast and idempotent.

**ADR-010 – Derived free places with a class row lock and a fixed lock order**
- Reason: no counter that can drift; the count is cheap at ≤ ~40 places.
- Alternatives: a stored counter, SERIALIZABLE isolation with retries, advisory locks.
- Consequences: lock order `gym_class` → child rows by `member_id` → `app_user`. The partial unique index is the second line of defence.

**ADR-011 – Ownership enforced in SQL; foreign resources return 404**
- Reason: a forgotten check after a fetch cannot leak data, and 404 does not reveal that a resource exists.
- Alternatives: fetch-then-check, PostgreSQL row-level security.
- Consequences: all access goes through `bookings/access.ts`, and the access-matrix test is mandatory for new routes.

**ADR-012 – Attendance captured by staff on a roster, stored on `booking`, auto no-show opt-in**
- Reason: no hardware is needed, and the report does not need an extra join. Auto no-show stays off so that a forgotten roster cannot block members.
- Alternatives: a separate table, self check-in or QR, always-on auto no-show.
- Consequences: only `confirmed` bookings carry attendance; `AttendanceRecorded` is published in the same transaction.

**ADR-013 – No-show blocks from uncounted no-shows, decided under an `app_user` row lock**
- Reason: exact counting without double use; decisions are serialised per member.
- Alternatives: count since the last block, a stored counter, a nightly batch.
- Consequences: `assertNotBlocked` runs in booking and waiting-list join (409); thresholds are configuration.

**ADR-014 – Local e-mail/password accounts with opaque, hashed server-side sessions (assumption pending PO confirmation)**
- Reason:
  - No identity provider is named in the requirements, and members already exist as records to import.
  - Server-side sessions can be revoked on sign-out or password change, and role or club changes apply on the next request. Signed JWTs cannot be revoked and would carry stale roles.
  - Storing only the SHA-256 hash of the token means a database leak gives no usable sessions, and no signing secret has to be managed.
  - scrypt from `node:crypto` avoids a native dependency such as argon2 or bcrypt.
- Alternatives:
  - JWT in a cookie or header: stateless, but no revocation and stale claims.
  - An external IdP (Auth0, Entra ID, Google): not requested, and adds cost and onboarding.
  - argon2id through `@node-rs/argon2`: slightly stronger, but adds a dependency.
  - Passwordless magic links: these need the e-mail channel, which is still open.
- Consequences:
  - One indexed lookup per request.
  - `@fastify/cookie` and `@fastify/rate-limit` are added.
  - `authenticate()` is the only place to change if SSO is chosen.
  - Account onboarding (invite or self-service) is a follow-up story once the PO answers.

**ADR-015 – Secure-by-default route protection with a public allow-list and a route-table test**
- Reason: brief §7 asks for authorisation on every endpoint. A global `onRequest` hook in the `/api` scope cannot be forgotten on a new route. Recording the routes with `onRoute` lets one test assert that every non-public route returns 401 and that the public list contains only sign-in and sign-out. Opting in per route would be easy to forget.
- Alternatives: a `requireAuth` preHandler on each route (relies on reviewers), a separate Fastify plugin context per protection level (works, but is less explicit in tests).
- Consequences:
  - A new public route needs `config: { public: true }`, an ADR and an update of the test's allow-list.
  - Because the hook runs before validation, an anonymous caller gets 401, not 400 or 404.
  - US-117 registers `GET /api/clubs` before the hook exists, so the two stories ship together.

**ADR-016 – Club master data from a reviewed seed file, not an admin UI**
- Reason: there are four clubs that rarely change, and there is no requirement for club administration. A versioned JSON file goes through code review and gives an audit trail. The seed is idempotent on `code` and never deletes, because classes and users reference clubs.
- Alternatives: hard-coding the clubs in a migration (business data mixed into the schema; renames need new migrations), an admin UI (not in scope).
- Consequences:
  - Club changes are operator tasks (edit the file, run `db:seed:clubs`).
  - Each club has its own time zone, even if all four share one.
  - Retiring a club needs a future story.

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| US-120's tech spec still names Express/Knex/`apps/` | Med | Med | §2 note; align US-120 before development |
| The PO picks SSO or another auth method after US-118 is built | Med | Med | `authenticate()` is the single replacement point; guards, sessions and `request.user` stay. The question is recorded |
| Imported members (US-135) and new drop-ins have no password and cannot sign in on day one | High | High | Open question on onboarding (invite, self-service or front desk). A follow-up story is needed before go-live. Operators can set passwords with the CLI in the meantime (not scalable) |
| US-117 is merged before US-118, leaving `GET /api/clubs` without auth on `main` | Med | Low | No deployment pipeline yet. Release constraint: US-117 and US-118 ship together. The US-118 protection test covers the route |
| The in-memory rate-limit store does not share counts between several API instances | Low | Med | Single instance assumed (hosting open). Move to a shared store (PostgreSQL or Redis) when scaling out |
| scrypt at 2^17 uses 128 MiB per concurrent sign-in, so a burst of sign-ins exhausts memory | Low | Med | The rate limit and low volume make this unlikely. Cost is configurable, and the libuv thread pool (4 threads) caps concurrency |
| Club master data is not confirmed before go-live | Med | Med | Pre-deploy step on US-117. The seed refuses to run without `clubs.json`, and the example file uses obviously fake codes |
| Drop-in bookings hold places in `pending_payment` if US-122 ships before US-132/US-133 | Med | Med | Release constraint on US-122. Hold expiry is defined in US-133 |
| The repository is not on GitHub, so the workflow does not run | Low–Med | Low | All steps are npm scripts (`npm run ci`) |
| Branch protection is not enabled | Med | High | Post-deploy step on TK-119 |
| Concurrent bookings exceed capacity | Med | High | Class row lock plus partial unique index (ADR-010), with parallel integration tests |
| Deadlocks between book, cancel, promotion, attendance and block decisions | Low | Med | Fixed lock order (ADR-010, ADR-013) |
| A slow or failing event handler blocks writes | Low | Med | DB-only handlers; I/O goes through the outbox (ADR-009) |
| A new route is added without an access check | Med | High | Secure-by-default hook plus route-table test (ADR-015); `access.ts` plus the access-matrix test (ADR-011) |
| Flaky integration tests | Med | Med | Serial files, `resetDb()`, `TZ=UTC`, an injected clock (session expiry uses it too) |
| Integration tests run against a real database | Low | High | `_test` guard |
| Duplicate Stripe charges on retry | Med | High | Idempotency keys plus unique `payment.idempotency_key` |
| Forgotten attendance makes the no-show rule and the report blind | Med | High | Auto no-show off; the report shows "not recorded"; managers can correct |
| The no-show threshold goes live with provisional values | Med | Med | Pre-deploy configuration step on US-130 |
| Earlier drafts conflict with ADR-008 (`BOOKING_BLOCKED` 403, 422 window, nested error body, `/api/webhooks/stripe`) | Med | Low | Resolved in this document: 409, flat body, `/webhooks/stripe`. US-127 and US-132 must be aligned when they are touched |
| Time zone assumption is wrong | Low | Med | UTC storage plus a per-club `timezone` (US-117) |

## 11. Open questions (architecture-relevant)

- Authentication method (local vs SSO), and how imported members and drop-ins get access: invitation, self-registration or front desk (US-118, US-135).
- Whether a cross-club admin/head-office role is needed, and whether one person can be both staff and member (US-118).
- Club codes, names and time zones (US-117).
- Repository hosting and an admin for branch protection (TK-119).
- Hosting/deployment target: same-origin serving, HTTPS, reverse proxy (`TRUST_PROXY`), single or multiple instances (rate-limit store), secret store.
- Notification channel (US-126, US-128, US-130).
- Whether members can book at any club or only at their home club (US-122 assumes any club).
- How long a drop-in `pending_payment` hold lasts (US-133).
- Attendance capture and auto no-show (US-129); no-show threshold and window (US-130).
