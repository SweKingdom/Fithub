# FitHub – Solution Design

Status: living document. Last update: refinement of FT-112 (US-127 waiting list join/leave, US-128 automatic promotion). Changes: waiting-list data model, promotion design, job runner, notification port, ADR-010…012. Earlier updates: FT-108/TK-119 (tech stack, repository layout, CI), US-121, US-122.

## 1. Architecture overview
FitHub is a **web app backed by a JSON API** (brief §1), built as a single repository with two npm workspaces:

```
Browser (React SPA, web/)  ──HTTP/JSON──►  API (Fastify, api/)  ──SQL──►  PostgreSQL 16
                                              │
                                              ├──► Stripe Payments API (PaymentIntents)  [EP-104]
                                              ◄── Stripe webhooks (/webhooks/stripe)      [EP-104]
                                              ├──► Notifier port (LogNotifier now; email/SMS TBD)  [US-128, ADR-012]
                                              └── in-process interval jobs (waitlist-maintenance, payment-retry)  [ADR-007]
One-off CLI (api/scripts/import-*) ──► PostgreSQL                                         [EP-105]
```

- The API is the only component that talks to the database and to Stripe. The SPA holds no business rules; all checks (capacity, double booking, windows, roles) are enforced server-side.
- **Place allocation is serialised per class** by a row lock on `gym_class` (ADR-010). Booking, cancellation, waiting-list join and promotion all take this lock first.
- **Waiting-list promotion runs synchronously** inside the transaction that frees the place (ADR-011). An interval job is the safety net and expires entries.
- Background work runs in-process in the API through `api/src/jobs/runner.ts` interval jobs (ADR-007). Jobs are idempotent and safe on several instances.
- Times are stored as `timestamptz` in UTC and shown in the club's local time (brief §7).

## 2. Technology stack
| Concern | Choice | ADR |
|---|---|---|
| Runtime | Node.js 22 LTS, TypeScript 5 (strict, ESM) | ADR-001 |
| Repo layout | npm workspaces `api`, `web` | ADR-002 |
| API framework | Fastify 5 + zod (`fastify-type-provider-zod`) | ADR-003 |
| Database / access | PostgreSQL 16, Kysely + `pg`, Kysely Migrator | ADR-004 |
| Web | React 18 + Vite 5 SPA | ADR-005 |
| Tests / quality | Vitest 2, ESLint 9 + typescript-eslint, Prettier 3; GitHub Actions CI | ADR-006 |
| Background jobs | In-process interval jobs (`api/src/jobs/runner.ts`) | ADR-007 |

## 3. Module map

| Path | Responsibility | Introduced by |
|---|---|---|
| `.github/workflows/ci.yml` | CI pipeline: install → format → lint → typecheck → migrate → test → build | TK-119 |
| `docker-compose.yml`, `docker/initdb/` | Local PostgreSQL (`fithub`, `fithub_test`) | TK-119 |
| `api/src/config.ts` | Environment parsing and validation (zod) | TK-119; `BOOKING_CANCEL_CUTOFF_MINUTES` (US-124); `ATTENDANCE_*` (US-129); `NO_SHOW_*` (US-130) |
| `api/src/app.ts` | `buildApp({config, db, clock?, events?, ...deps})` Fastify factory. Dependencies are injected so tests can swap in fakes. Registers business routes under prefix `/api` and the domain-event subscriptions | TK-119 |
| `api/src/server.ts` | Process entry point (listen, graceful shutdown). Starts/stops in-process background loops (auto no-show sweeper, US-129) — never `buildApp` | TK-119 |
| `api/src/db/` | `client.ts` (Kysely), `schema.ts` (table types), `migrate.ts` (CLI) | TK-119 |
| `api/migrations/` | `NNNN_snake_case.ts` migrations with `up`/`down` | TK-119 (empty), US-117 onward |
| `api/src/routes/health.ts` | `GET /health` | TK-119 |
| `api/src/shared/errors.ts` | `DomainError(code, message, httpStatus, fieldErrors?)` + Fastify error handler | US-118 |
| `api/src/shared/clock.ts` | `Clock { now(): Date }`, `systemClock` | US-120 (first user) |
| `api/src/shared/domain-events.ts` | `DomainEvent` union (`BookingCancelled` US-124, `AttendanceRecorded` US-129), `DomainEventBus` (`subscribe`, `publish(trx, event)`) | US-124 |
| `api/src/modules/<domain>/` | Feature modules: `routes.ts` (HTTP + zod schemas), `service.ts` (business rules, transactions), `repository.ts` (Kysely queries), `errors.ts`, optional `dto.ts` | Feature stories |
| `api/src/modules/auth` | Sign-in, sessions, `requireAuth`, `requireRole`; `GET /api/me` (incl. `bookingBlock` from US-130) | US-118 |
| `api/src/modules/clubs` | Club reference data | US-117 |
| `api/src/modules/classes` | Create/cancel class, schedule query, class DTO (`freePlaces`, `myBooking`) | US-120, US-121, US-126 |
| `api/src/modules/bookings` | `service.ts` (`bookClass`, `listMyBookings`, `getBooking`, `getClassRoster`, `cancelBooking`), `access.ts` (ownership / club-scope helpers), `dto.ts` (`BookingDto`), `cancel-window.ts` (pure window rules), credits | US-122–US-125 |
| `api/src/modules/waitlist` | Join/leave waiting list, promotion (subscribes to `BookingCancelled`) | US-127, US-128 |
| `api/src/modules/attendance` | `window.ts` (pure attendance window), `service.ts` (`getAttendance`, `recordAttendance`), `auto-no-show.ts` (sweep, off by default), `routes.ts`; `no-show-window.ts`, `block-service.ts` (`onAttendanceRecorded`, `assertNotBlocked`, `getActiveBlock`), `block-repository.ts` | US-129, US-130 |
| `api/src/modules/payments` | Stripe client wrapper, webhook, retries, refunds | TK-131, US-132–US-134 |
| `api/src/modules/reports` | Weekly attendance/no-show report | US-137 |
| `api/scripts/` | One-off import CLIs | US-135, US-136 |
| `api/test/unit`, `api/test/integration`, `api/test/helpers` | Vitest tests. Integration tests run against PostgreSQL `*_test`. `helpers/factories.ts` builds clubs, users, classes and bookings | TK-119; factories from US-120/US-122 |
| `api/test/integration/bookings.access.test.ts` | Route × actor **access matrix** for all member-owned and club-scoped resources. Every story that adds a booking/waitlist/payment/attendance route adds a row | US-123 (attendance rows US-129) |
| `web/src/` | React SPA: pages under `web/src/pages/`, shared components under `web/src/components/`, API client under `web/src/api/`, helpers under `web/src/lib/`. Tests under `web/test/` | TK-119 skeleton, feature stories |
| `web/src/pages/MyBookingsPage.tsx`, `web/src/components/BookButton.tsx`, `CancelBookingButton.tsx`, `ConfirmDialog.tsx` | Booking UI | US-122–US-124 |
| `web/src/pages/ClassAttendancePage.tsx` (`/classes/:classId/attendance`), `web/src/components/BookingBlockBanner.tsx` | Attendance roster (staff); block banner (members) | US-129, US-130 |

### Coding conventions
- Every request body, query and params object is validated with a zod schema in `routes.ts`. Services receive typed input only.
- Business errors are typed (`DomainError` with a `code` and a human-readable `message`). One Fastify error handler maps them to HTTP status codes and a flat body `{ "code", "message", "fieldErrors"? }` (ADR-008).
- Every multi-step write runs in one DB transaction inside the service (`db.transaction().execute(...)`).
- **Lock order:** when a transaction needs several row locks, it locks the `gym_class` row first, then `booking` / `waitlist_entry` / `payment` rows, then `app_user` rows (ADR-010, ADR-013). Several booking rows are locked in `member_id` order. This prevents deadlocks between booking, cancelling, promotion, attendance and block decisions.
- Ownership of member resources is part of the SQL `WHERE` clause (`member_id = :currentUserId`). Rows are never fetched first and filtered afterwards (ADR-011).
- Third-party clients (Stripe, mailer), the clock and the event bus are injected through `buildApp` deps. Tests use fakes, and CI never uses real keys.
- Background loops are plain exported functions (`runXxx(deps)`) that tests call directly; `server.ts` only schedules them. Each run is idempotent and uses `FOR UPDATE SKIP LOCKED` so several instances are safe.
- Enumerations are stored as `text` with a CHECK constraint, not as PostgreSQL enum types (ADR-008).

## 4. Data model (first cut, from brief §5)

Each story's tech spec fixes the detailed columns, constraints and migrations. **Table names are singular** and match the stories that create them (ADR-008). Status values are `text` + `CHECK`.

| Table | Key columns | Key constraints / indexes | Story |
|---|---|---|---|
| `club` | `id`, `code`, `name`, `timezone` (IANA) | `code` unique, `name` unique | US-117 |
| `app_user` | `id`, `email`, `full_name`, `role` (`member`\|`instructor`\|`club_manager`), `member_type` (`regular`\|`drop_in`, null for staff), `club_id`, `legacy_member_id` | `lower(email)` unique, `legacy_member_id` unique | US-118, US-135 |
| `gym_class` | `id`, `club_id`, `name` varchar(100), `start_at`, `duration_minutes`, `capacity`, `status` (`scheduled`\|`cancelled`), `instructor_id`, `created_by`, `created_at`, `updated_at` | CHECK `capacity >= 1`, `duration_minutes > 0`, `length(btrim(name)) > 0`. Index `gym_class_club_start_idx (club_id, start_at)`, `gym_class_instructor_idx` | US-120 (cancel columns: US-126) |
| `booking` | `id`, `class_id`, `member_id`, `status` (`pending_payment`\|`confirmed`\|`cancelled`), `attendance` (`unknown`\|`attended`\|`no_show`), `source` (`direct`\|`waitlist`), `booked_at`, `cancelled_at`, `created_at`, `updated_at` | partial unique `booking_active_member_class_uq (class_id, member_id) WHERE status IN ('pending_payment','confirmed')`; `booking_class_status_idx`; `booking_member_idx` | US-122 |
| `waitlist_entry` | `id`, `class_id`, `member_id`, `queue_seq` (bigint identity), `status` (`waiting`\|`promoted`\|`removed`\|`expired`), `joined_at`, `ended_at`, `promoted_booking_id` → `booking.id`, `created_at`, `updated_at` | `queue_seq` unique; partial unique `waitlist_entry_waiting_class_member_uq (class_id, member_id) WHERE status = 'waiting'`; CHECK `(status='waiting') = (ended_at IS NULL)`; CHECK `promoted_booking_id IS NULL OR status='promoted'`; index `(class_id, status, queue_seq)`, `(member_id, status)` | US-127 |
| `payment` | `id`, `booking_id`, `stripe_payment_intent_id`, `amount`, `currency`, `status`, `attempts`, `next_retry_at`, `idempotency_key` | `idempotency_key` unique | US-132, US-133 |
| `credit_transaction` (+ balance view) | `member_id`, `delta`, `reason`, `booking_id` | | US-125, US-136 |
| `booking_block` | `member_id`, `starts_at`, `ends_at`, `reason` | | US-130 |

### Derived values (not stored)
- **Free places** = `capacity − count(booking WHERE status IN ('confirmed','pending_payment'))`, floored at 0. It is computed on read and under the class lock (ADR-009).
- **Waiting-list position** = count of `waiting` entries on the class with `queue_seq <=` own `queue_seq` (US-127). Order uses `queue_seq`, not `joined_at`, so ties under a fixed clock are impossible.

### Waiting-list lifecycle (US-127, US-128)
```
waiting ──leave (member)────────────► removed
   │   ──direct booking of same class► removed
   │   ──class cancelled (US-126)────► removed
   │   ──promotion, already booked───► removed
   ├──promotion (place freed)────────► promoted (+ booking source = waitlist)
   └──cut-off / class start (job)────► expired
```
Terminal states set `ended_at`. Re-joining after leaving creates a new row at the end of the queue.

### Schedule read path (US-121, extended by US-122/US-127)
`GET /api/classes` runs one query: `gym_class` ⋈ `club` ⟕ `app_user` (instructor) ⟕ the aggregated active-booking count ⟕ the caller's active booking ⟕ LATERAL the caller's `waiting` entry with its position. It filters on `start_at > now AND start_at <= now + 14 d` and orders by `start_at, name, id`. It reads at most ~560 rows.

Migrations: Kysely Migrator, `api/migrations/NNNN_snake_case.ts`. Each migration has a working `down`. `npm run db:migrate` runs in CI against the test DB on every change.

## 5. API inventory (planned)

All business routes are registered under the prefix **`/api`**. Only `/health` and `/webhooks/stripe` are unprefixed (ADR-008).

| Method & route | Roles | Story |
|---|---|---|
| `GET /health` | public | TK-119 |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me` | public / authenticated | US-118 |
| `GET /api/clubs` | authenticated | US-117 |
| `GET /api/clubs/:clubId/instructors` | instructor, club_manager (own club) | US-120 |
| `POST /api/classes` | instructor, club_manager (own club) | US-120 |
| `GET /api/classes?clubId=&from=&to=` | authenticated. `myBooking`/`myBookingStatus`/`myWaitlist` only for the caller | US-121 (+US-122, US-127) |
| `POST /api/classes/:id/cancel` | instructor, club_manager | US-126 |
| `POST /api/classes/:classId/bookings` | member | US-122 (refined) |
| `GET /api/me/bookings` | member (own only; bookings + waiting entries) | US-123 |
| `POST /api/bookings/:id/cancel` | member (own only); triggers promotion | US-124, US-128 |
| `POST /api/classes/:classId/waitlist` | member | **US-127 (refined)** |
| `DELETE /api/waitlist/:entryId` | member (own only) | **US-127 (refined)** |
| `PUT /api/classes/:id/attendance` | instructor, club_manager | US-129 |
| `POST /webhooks/stripe` | Stripe (signature-verified) | US-132 |
| `GET /api/reports/weekly-attendance?clubId=&week=` | club_manager (own club) | US-137 |

### `GET /api/classes` contract (US-121)
- Query: `clubId` (UUID, optional), `from`/`to` (ISO 8601 with offset, optional; they can only narrow the window `(now, now + 14 d]`).
- 200: `{ from, to, items: [{ id, clubId, clubName, clubTimezone, name, startAt, durationMinutes, capacity, freePlaces, status, instructorName, myBookingStatus, myBooking, myWaitlist }] }`. `myBookingStatus` ∈ `none | confirmed | pending_payment | waiting`. `myBooking` = `{ id, status } | null` (US-122). `myWaitlist` = `{ entryId, position } | null` (US-127). Header `Cache-Control: no-store`.
- Errors: 400 `VALIDATION_ERROR`, 401 `UNAUTHENTICATED`, 404 `CLUB_NOT_FOUND`.

### Waiting-list contract (US-127)
- `POST /api/classes/:classId/waitlist` (no body) → 201 `WaitlistEntryDto` `{ id, type: "waitlist", classId, className, clubId, clubName, startAt, durationMinutes, classStatus, status, position, joinedAt, promotedBookingId }`.
- `DELETE /api/waitlist/:entryId` → 204.
- Errors: 400 `VALIDATION_ERROR`; 401 `UNAUTHENTICATED`; 403 `FORBIDDEN`, `BOOKING_BLOCKED` (US-130); 404 `CLASS_NOT_FOUND`, `WAITLIST_ENTRY_NOT_FOUND` (also for other members' entries); 409 `CLASS_NOT_BOOKABLE`, `WAITLIST_CLOSED`, `ALREADY_BOOKED`, `ALREADY_ON_WAITLIST`, `CLASS_NOT_FULL`, `WAITLIST_ENTRY_NOT_ACTIVE`.

### Internal service contract: promotion (US-128)
`promoteNext(trx, classId, ctx): Promise<Promotion[]>`. It must be called inside the transaction that frees a place: booking cancel (US-124), payment declined/expired (US-132/US-133), and a future capacity change. The caller then calls `notifyPromotions` after commit. The function is idempotent and returns `[]` when there is nothing to do.

### Error envelope
`{ "error": { "code": "<UPPER_SNAKE>", "message": "<plain language>", "fieldErrors"?: [{ "field", "message" }] } }`. `fieldErrors` appears only with `VALIDATION_ERROR`. Status codes: 400 validation, 401 unauthenticated, 403 forbidden or blocked, 404 not found (also non-owned resources), 409 business conflict, 422 cancellation window closed (US-124), 503 dependency unavailable.

## 6. Security model

- Role-based authorisation on every route (Fastify `preHandler` `requireRole`). Authentication method: open question (US-118).
- **Member-owned resources** (bookings, waiting-list entries, payments): ownership is enforced in SQL by the helpers in `api/src/modules/bookings/access.ts` (`getReadableBooking`, `getOwnBookingForUpdate`). A foreign resource returns the same 404 body as a non-existent one (ADR-011).
- **Club scope:** staff may only manage or read classes and bookings of their own club (`app_user.club_id = gym_class.club_id`). They get 403 on another club's class, and 404 on a single booking of another club. Rosters (booking roster and attendance roster) return member names only, never e-mail addresses.
- **Attendance (US-129):** any instructor or the club manager of the class's club may record attendance during the window; after it only the club manager may correct. Booking ids in the payload are accepted only when they belong to the class in the URL (`WHERE class_id = :classId`). The recorder id comes from the session.
- **No-show blocks (US-130):** block data is visible only to the member themself (`GET /api/me`); the block check uses the session member id.
- The member id for booking and cancelling always comes from the session, never from the request.
- `bookings.access.test.ts` is the regression net: one row per route × actor (owner, other member, staff own club, staff other club, anonymous).
- Secrets (Stripe keys, webhook secret, session secret) come only from environment variables or the host's secret store. They never appear in code, tests, logs or CI. `.env` is git-ignored and `.env.example` lists variable names only.
- CI: `permissions: contents: read`. It runs on the `pull_request` trigger (never `pull_request_target`) and has no repository secrets.
- Integration tests refuse to run against any database whose name does not end in `_test`.

## 7. Integration inventory
| System | Direction | Mechanism | Status |
|---|---|---|---|
| Stripe Payments API | outbound | PaymentIntents via official `stripe` SDK, idempotency keys per payment attempt | EP-104, open questions (price, retry policy, refunds) |
| Stripe webhooks | inbound | `POST /webhooks/stripe`, signature verification | EP-104 |
| Legacy member data | inbound, one-off | CLI import script, idempotent upsert by dedup key | EP-105, format and dedup key open |
| Email/notifications | outbound | `Notifier` port (ADR-012). `LogNotifier` until a channel is decided. Events: `waitlist_promoted` (US-128); class cancellation (US-126) later | channel open question |
| GitHub Actions | CI | `.github/workflows/ci.yml` | TK-119 |

## 8. Delivery pipeline and quality checks (FT-108)

- **Workflow `CI` / job `checks`** (`.github/workflows/ci.yml`, TK-119) runs on every pull request (opened, synchronize, reopened) and on every push to `main`. Steps: `npm ci` → `format:check` → `lint` (0 warnings) → `typecheck` → `db:migrate` (PostgreSQL 16 service container, DB `fithub_test`) → `test` (Vitest unit + integration, coverage artifact) → `build`. A failing step stops the job. Timeout: 15 min (target < 5 min). `permissions: contents: read`, `pull_request` trigger only (never `pull_request_target`), `concurrency` cancels superseded runs.
- `npm run ci` runs the same chain locally. All steps are npm scripts, so porting to another CI host is one file.
- `main` is protected: the `CI / checks` status is required (post-deploy manual step in TK-119).
- **Test environment:** `TZ=UTC`, `NODE_ENV=test`, `JOBS_ENABLED=false`, `DATABASE_URL=…/fithub_test`. No secrets and no `STRIPE_*` variables. Jobs are tested by calling their run function directly. There are no real third-party calls.
- **Test layout:** `api/vitest.workspace.ts` defines projects `unit` (`test/unit/**`, no I/O) and `integration` (`test/integration/**`, serial files, real PostgreSQL). `web` uses jsdom + Testing Library.
- **Test-DB lifecycle (ADR-014):** the integration global setup (1) refuses any database whose name does not end in `_test`, (2) migrates it to latest, before any test runs. Each integration test calls `resetDb()` in `beforeEach`. Locally the test DB `fithub_test` is created by `docker/initdb/01-create-test-db.sql` next to the dev DB `fithub`.
- **Env loading:** Node's native `--env-file-if-exists=../.env` in the `api` scripts; no `dotenv`. CI sets env in the workflow, no `.env` file.
- Not yet in place: coverage gate (report only), E2E browser tests, CD/deployment, dependency scanning. Before TK-119 the repository has no checks at all.

### Configuration inventory (selected)
| Variable | Default | Story |
|---|---|---|
| `DATABASE_URL` | none (required); integration tests default to `postgres://fithub:fithub@localhost:5432/fithub_test` | TK-119 |
| `PORT` | `3000` | TK-119 |
| `NODE_ENV` | `development` (`test` in CI) | TK-119 |
| `LOG_LEVEL` | `info` | TK-119 |
| `TZ` | system (`UTC` in CI and Vitest) | TK-119 |
| `BOOKING_CANCEL_CUTOFF_MINUTES` | `120` | US-124 |
| `WAITLIST_PROMOTION_CUTOFF_MINUTES` | `0` (assumption, PO to confirm) | US-128 (read by US-127) |
| `WAITLIST_JOB_INTERVAL_SECONDS` | `60` | US-128 |
| `JOBS_ENABLED` | `true` (`false` in tests; set in CI by TK-119, parsed from US-128/US-129) | US-128 / US-133 |

## 9. Key decisions (ADR)

**ADR-001 – Node.js 22 + TypeScript (strict, ESM)**
· Reason: the repo's `.gitignore` already targets Node (`node_modules/`). One language for the SPA and the API. Stripe has a first-class Node SDK. Strict types catch status/enum mistakes in booking logic.
· Alternatives: Python/Django (strong admin, but two languages with a React SPA), Java/Spring (heavier for a small team).
· Consequences: all tooling is npm-based, and Node 22 LTS is pinned via `.nvmrc` (`engines` `>=22.9 <23`).

**ADR-002 – Single repo, npm workspaces `api` and `web`**
· Reason: one PR changes the API and the UI together, there is one CI pipeline, and no extra tool (Nx/Turbo/pnpm) is needed.
· Alternatives: separate repos (cross-repo coordination for every story), Turborepo (unneeded at this size).
· Consequences: root scripts fan out with `--workspaces`. Shared types are added later as a third workspace only if needed.

**ADR-003 – Fastify 5 + zod for the API**
· Reason: TypeScript-first, schema validation at the boundary, and `app.inject()` gives fast HTTP-level tests without opening a port.
· Alternatives: Express (no built-in validation or typing), NestJS (more ceremony than needed), Next.js API routes (couples the API to the UI framework; the brief asks for an API).
· Consequences: every route declares zod schemas, and `buildApp` stays a pure factory for tests.

**ADR-004 – PostgreSQL 16 with Kysely (query builder) and Kysely Migrator**
· Reason: capacity must never be exceeded under concurrency (brief §7). That needs explicit transactions and row locks (`SELECT … FOR UPDATE` on the class row) plus partial unique indexes, and Kysely expresses these directly with full typing.
· Alternatives: Prisma (row locks need raw SQL; heavier engine), TypeORM (weaker typing), raw `pg` (no typing, hand-written migrations).
· Consequences: table types are kept in `api/src/db/schema.ts` and updated with each migration.

**ADR-005 – React + Vite SPA**
· Reason: a simple client-rendered web app talking to the API, with fast builds and the same test runner (Vitest).
· Alternatives: Next.js (SSR not needed), server-rendered templates (weaker interactivity for booking and waiting-list flows).
· Consequences: the API must handle CORS or same-origin hosting (decided with deployment). In dev, Vite proxies `/api`.

**ADR-006 – Vitest, ESLint, Prettier and GitHub Actions with a Postgres service container**
· Reason: one test runner for both workspaces. Integration tests against a real PostgreSQL prove the locking and constraint behaviour that mocks cannot. GitHub Actions is assumed because no hosting is specified (open question), and all steps are npm scripts so they are portable.
· Alternatives: Jest (slower with ESM/TS), Testcontainers (needs Docker-in-runner; the service container is simpler), SQLite for tests (different locking semantics, so the tests would prove nothing).
· Consequences: integration test files run serially and reset tables before each test. A guard prevents running them against non-test databases (ADR-014).

**ADR-007 – In-process DB-backed job polling for background work (proposed)**
· Reason: low volume (four clubs). It avoids extra infrastructure such as Redis or a queue. The same table serves as the transactional outbox for side effects that call third parties (ADR-009).
· Alternatives: BullMQ + Redis, a cloud scheduler.
· Consequences: to be confirmed when US-133 (payment retry) is refined. Jobs must be idempotent and use `FOR UPDATE SKIP LOCKED`. The US-129 auto no-show sweep starts as a `setInterval` loop in `server.ts` and moves onto the job runner once it exists.

**ADR-008 – API and schema conventions: `/api` prefix, flat error body, singular table names, text + CHECK enums**
· Reason: the stories refined before this one (US-117, US-118, US-120) already use `/api/...` routes, `{ code, message, fieldErrors? }` errors and the tables `club`, `app_user`, `gym_class`. The Vite dev proxy forwards `/api`. `user` is a reserved word in PostgreSQL and `class` clashes with the TypeScript keyword, which explains `app_user` and `gym_class`. `text` + CHECK is simpler to extend and roll back than PostgreSQL enum types.
· Alternatives: the nested `{ error: { code, message } }` body and plural table names from the first draft of this document (would have meant rework in three stories); PostgreSQL enums (`ALTER TYPE` cannot run inside a transaction on older versions and cannot remove values).
· Consequences: business-rule rejections use 409 (including the cancellation window and `BOOKING_BLOCKED`, so not 422 or 403). 403 is used only for role or club scope. Infrastructure routes (`GET /health`) stay outside `/api`.

**ADR-009 – Side effects through in-transaction domain events**
· Reason: cancelling a booking must free the place and then hand it to the waiting list (US-128), return credits (US-125) and trigger a refund (US-134). Without that, a direct booker could take the freed place between the commit and the promotion. Running the DB-only handlers inside the same transaction makes "cancel + promote + credit" atomic. Handlers that need I/O only enqueue a `job` row (outbox), so no network call happens inside a transaction.
· Alternatives: direct calls from the bookings service to the waitlist, credit and payment services (cyclic module dependencies, harder to test); after-commit events (lose atomicity, so places can be grabbed or credits lost when a crash happens); an external message broker (overkill).
· Consequences: `DomainEventBus` is injected through `buildApp`. A handler failure rolls back the triggering write (consistency over availability). Events so far: `BookingCancelled` (US-124), `AttendanceRecorded` (US-129). Handlers must be fast and idempotent.

**ADR-010 – Derived free places with a class row lock and a fixed lock order**
· Reason: free places = capacity − active bookings, counted while the `gym_class` row is held with `FOR UPDATE`. There is no counter that can drift, and at this volume (≤ ~40 places per class) the count is cheap. Locking `gym_class` first and child rows second avoids deadlocks between book, cancel, waitlist and promotion.
· Alternatives: a stored `booked_count` column (faster reads, but it must be kept in sync by every write path); SERIALIZABLE isolation with retries (more complex error handling); advisory locks (less visible).
· Consequences: the partial unique index stays as a second line of defence against double booking. The schedule computes `freePlaces` with a grouped count (US-121). Order extended by ADR-013: `gym_class` → child rows (by `member_id`) → `app_user`.

**ADR-011 – Ownership enforced in SQL; foreign resources return 404**
· Reason: brief §7 says members can only access their own bookings. Putting `member_id = :me` (or `club_id = :myClub` for staff) in the query makes it impossible to leak data through a forgotten check after the fetch. Returning 404 instead of 403 does not reveal that the resource exists.
· Alternatives: fetch-then-check in each route (easy to forget), row-level security in PostgreSQL (strong, but it needs per-request DB session settings, which adds complexity with pooled connections).
· Consequences: all access goes through `bookings/access.ts`. The route × actor matrix test (`bookings.access.test.ts`) must be extended by every new member-owned or club-scoped route.

**ADR-012 – Attendance captured by club staff on a roster, stored on `booking`, with a time window and opt-in auto no-show**
· Reason: the requirements need attendance per booking but do not say how it is captured. A staff roster in the existing app needs no hardware and reuses the club-scope rules. Storing `attendance` + `attendance_recorded_by/_at` on `booking` keeps one row per member and class (no join for the report). A window (start → end + 24 h) limits late edits by instructors; managers can still correct. Auto no-show is built but off by default, because a forgotten roster would otherwise block innocent members.
· Alternatives: a separate `attendance` table (extra join, no extra value with one record per booking); member self check-in or QR scan (not requested, needs devices); auto no-show always on (unsafe until confirmed).
· Consequences: only `confirmed` bookings carry attendance. Every change publishes `AttendanceRecorded` in the same transaction. The sweep is idempotent and multi-instance safe (`SKIP LOCKED`). Product-owner confirmation pending (US-129 open question).

**ADR-013 – No-show block counted from uncounted no-shows, decided per member under a row lock**
· Reason: "no-shows that led to a block are not counted again" needs an exact record of which no-shows were used; `booking.no_show_block_id` gives that without a link table. Locking the `app_user` row inside the attendance transaction serialises decisions per member, so two parallel saves cannot both miss or both create a block. Threshold, window type (`rolling_days` \| `calendar_month`) and block length are configuration because the business values are still open.
· Alternatives: count since the end of the latest block (loses no-shows recorded during a block and breaks on late corrections); a stored counter on `app_user` (drifts on corrections); a nightly batch (block arrives late, members can book in between).
· Consequences: `BookingBlockService.assertNotBlocked` is called by booking (US-122) and waiting-list join (US-127) with 409 `BOOKING_BLOCKED`. Correcting a linked no-show can lift an active block (assumed). Changing configuration affects only future decisions.

**ADR-014 – Test databases guard and migrate themselves; env files loaded by Node natively**
· Reason: locally `DATABASE_URL` in `.env` points to the dev DB `fithub`, so a manual `db:migrate` would not prepare `fithub_test`; tests would fail on a clean clone or, worse, could hit the dev DB. A Vitest `globalSetup` that first enforces the `_test` name guard and then runs `migrateToLatest()` makes the integration suite self-contained, identical in CI and locally. Node 22's `--env-file-if-exists` covers `.env` loading without a dependency, and CI simply has no `.env`.
· Alternatives: a separate `db:migrate:test` script the developer must remember (easy to forget, stale schema); `dotenv` (extra dependency for a built-in feature); Testcontainers per run (slower, needs Docker in the runner).
· Consequences: Node ≥ 22.9 is required. The CI `db:migrate` step still runs on its own so a broken migration is reported as a migration failure, not as a test failure. Migrations must be re-runnable against an already migrated DB (Kysely tracks them in `kysely_migration`).

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| US-120 tech spec still names Express/Knex/`apps/` (stale), which could lead to code that does not fit the TK-119 skeleton | Med | Med | Note in §2. Planner told to have US-120 aligned before development starts |
| US-118 (auth) is blocked by open questions, and US-122 to US-124 need `request.user` and a test sign-in helper | High | High | Build the role guard and a test auth helper with a stub session first. Only the sign-in method waits for the answer |
| Drop-in bookings stay `pending_payment` and hold places if US-122 is released before US-132/US-133 | Med | Med | Release constraint on US-122. Hold expiry is defined in US-133 |
| Repository is not on GitHub, so the workflow file does not run | Low–Med | Low | All steps are npm scripts (`npm run ci`). Porting is one file. Open question recorded on TK-119 |
| Branch protection not enabled, so red builds get merged | Med | High | Post-deploy manual step on TK-119. Verified with a deliberately failing PR |
| Concurrent bookings exceed capacity | Med | High | Class row lock plus partial unique index (ADR-010), proven by parallel integration tests (US-122 AC 4) |
| Deadlocks between book, cancel, promotion, attendance and block decisions | Low | Med | Fixed lock order `gym_class` → child rows by `member_id` → `app_user` (ADR-010, ADR-013) |
| A slow or failing event handler blocks cancellations or attendance saves | Low | Med | Handlers do DB work only; I/O goes to the job outbox (ADR-009). Tests cover rollback |
| A new member-owned or club-scoped route is added without an access check | Med | High | Central `access.ts` and a mandatory row in the access matrix test (ADR-011) |
| Flaky integration tests caused by shared DB state | Med | Med | Serial integration files, `resetDb()` before each test, `TZ=UTC`, injected clock |
| Integration tests accidentally run against a real database | Low | High | `_test` name guard runs before connecting |
| Duplicate Stripe charges on retry | Med | High | Stripe idempotency keys plus a unique `payment.idempotency_key` (US-133) |
| Instructors forget to record attendance → no-show rule and report are blind; if auto no-show were on, innocent members would be blocked | Med | High | Auto no-show off by default (ADR-012); report shows "not recorded" (US-137); managers can correct after the window, and a correction can lift a block |
| No-show threshold/window go live with provisional values (3 / rolling 30 days) | Med | Med | Pre-deploy step on US-130 to set confirmed values; configuration only, no code change |
| Inconsistent `BOOKING_BLOCKED` status (US-127 draft says 403, design says 409) | Med | Low | US-130 spec and §5 fix 409; US-127 to be aligned when refined |
| Many open business questions (no-show threshold, credits, auth, migration source) | High | Med | Those stories stay in "Requires additional information" or ship with configurable values. Foundation work (TK-119, US-120 to US-124, US-127) can proceed |
| Time zone assumption (single zone) is wrong | Low | Med | Store UTC and keep the club time zone as a club attribute (US-117) |

## 11. Open questions (architecture-relevant)

- Repository hosting and repository admin for branch protection (TK-119).
- Authentication method and account creation (US-118).
- Notification channel (US-128, US-126; also block notifications for US-130).
- Hosting/deployment target (affects CORS, secrets store, and when to add CD).
- Can members book classes at any club, or only at their home club? US-122 assumes any club.
- How long a drop-in `pending_payment` hold lasts before the place is released (US-133).
- Attendance capture: staff roster, any instructor of the club, auto no-show on or off (US-129). Built as roster with auto no-show off.
- No-show threshold and window (rolling 30 days vs calendar month); existing bookings/waiting-list places of blocked members; skip blocked members in promotion (US-128); correction lifts block (US-130). Built configurable with defaults 3 / rolling 30 / 7 days.

## 4. Data model

Tables use singular snake_case names. Detailed columns, constraints and migrations are fixed in each story's tech spec.

| Table | Key columns | Key constraints / indexes | Story |
|---|---|---|---|
| `club` | `id`, `code`, `name`, `timezone` | `code` unique, `name` unique | US-117 |
| `app_user` | `id`, `email`, `full_name`, `role` (`member`\|`instructor`\|`club_manager`), `member_type` (`regular`\|`drop_in`, null for staff), `club_id`, `legacy_member_id` | `lower(email)` unique, `legacy_member_id` unique | US-118, US-135 |
| `gym_class` | `id`, `club_id`, `name`, `start_at` timestamptz, `duration_minutes`, `capacity`, `status` (`scheduled`\|`cancelled`), `instructor_id`, `created_by` | CHECK `capacity >= 1`, `duration_minutes > 0`, `length(btrim(name)) > 0`; index `(club_id, start_at)` | US-120 |
| `booking` | `id`, `class_id`, `member_id`, `status` (`pending_payment`\|`confirmed`\|`cancelled`), `attendance` (`unknown`\|`attended`\|`no_show`), `attendance_recorded_by` (FK `app_user`, null = system), `attendance_recorded_at`, `no_show_block_id` (FK `booking_block`), `source` (`direct`\|`waitlist`), `booked_at`, `cancelled_at` | partial unique `booking_active_member_class_uq (class_id, member_id) WHERE status IN ('pending_payment','confirmed')`; CHECK `(status='cancelled') = (cancelled_at IS NOT NULL)`; CHECK `booking_attendance_recorded_ck (attendance='unknown') = (attendance_recorded_at IS NULL)`; indexes `(class_id, status)`, `(member_id)`, partial `booking_uncounted_no_show_idx (member_id) WHERE attendance='no_show' AND no_show_block_id IS NULL` | US-122, US-129, US-130 |
| `waitlist_entry` | `id`, `class_id`, `member_id`, `joined_at`, `status` (`waiting`\|`promoted`\|`removed`\|`expired`), `promoted_booking_id` | partial unique `(class_id, member_id) WHERE status = 'waiting'`; index `(class_id, status, joined_at)` | US-127 |
| `payment` | `id`, `booking_id`, `stripe_payment_intent_id`, `amount`, `currency`, `status`, `attempts`, `next_retry_at`, `idempotency_key` | `idempotency_key` unique | US-132, US-133 |
| `credit_transaction` (+ balance view) | `member_id`, `delta`, `reason`, `booking_id` | | US-125, US-136 |
| `booking_block` | `id`, `member_id`, `reason` (`no_show`\|`manual`), `starts_at`, `ends_at`, `no_show_count`, `lifted_at`, `created_at` | CHECK `ends_at >= starts_at`; CHECK `reason <> 'no_show' OR no_show_count >= 1`; index `(member_id, ends_at)`. Active = `starts_at <= now < ends_at` | US-130 |
| `job` (outbox / background jobs) | `id`, `type`, `payload` jsonb, `run_at`, `attempts`, `status` | polled with `FOR UPDATE SKIP LOCKED` | US-133 (ADR-007) |

**Derived values (ADR-010):** free places = `gym_class.capacity` − count of `booking` rows with status `pending_payment` or `confirmed`. This value is not stored. Every write that changes it holds the `gym_class` row lock.

**Attendance (ADR-012):** only `confirmed` bookings carry attendance. A recorded value always has `attendance_recorded_at`; `attendance_recorded_by IS NULL` with a timestamp means the auto no-show sweep set it. The weekly report (US-137) reads these columns; "not recorded" = `confirmed` and `unknown`.

**No-show blocks (ADR-013):** a no-show counts towards a block only while `no_show_block_id IS NULL`; creating a block links the counted bookings.

Migrations: Kysely Migrator. Each migration has a working `down`. `npm run db:migrate` runs in CI against the test DB on every change.

## 5. API inventory

All business routes have the prefix `/api`.

| Method & route | Roles | Story |
|---|---|---|
| `GET /health` (no prefix) | public | TK-119 |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me` | public / authenticated (`/api/me` adds `bookingBlock` for members — US-130) | US-118 |
| `GET /api/clubs` | authenticated | US-117 |
| `GET /api/clubs/:clubId/instructors` | instructor, club_manager (own club) | US-120 |
| `POST /api/classes` | instructor, club_manager (own club) | US-120 |
| `POST /api/classes/:id/cancel` | instructor, club_manager (own club) | US-126 |
| `GET /api/classes?clubId=&from=&to=` | authenticated | US-121 |
| `POST /api/classes/:classId/bookings` | member (self) — 201 regular / 202 drop-in | US-122 |
| `GET /api/classes/:classId/bookings` | instructor, club_manager (own club) — roster | US-123 |
| `GET /api/me/bookings?period=upcoming\|past&limit=&offset=` | member (own only) | US-123 (waitlist items: US-127) |
| `GET /api/bookings/:id` | owner member; staff of the class's club | US-123 |
| `POST /api/bookings/:id/cancel` | member (own only) | US-124 |
| `POST /api/classes/:id/waitlist`, `DELETE /api/waitlist/:entryId` | member | US-127 |
| `GET /api/classes/:classId/attendance` | instructor, club_manager (own club) — confirmed roster + window state | US-129 |
| `PUT /api/classes/:classId/attendance` | instructor, club_manager (own club); after the window only club_manager | US-129 |
| `POST /api/webhooks/stripe` | Stripe (signature-verified) | US-132 |
| `GET /api/reports/weekly-attendance?clubId=&week=` | club_manager (own club) | US-137 |

Error body (ADR-008): `{ "code": "<UPPER_SNAKE>", "message": "<plain language>", "fieldErrors"?: [{ "field", "message" }] }`.

Status codes: 400 `VALIDATION_ERROR` · 401 `UNAUTHENTICATED` · 403 `FORBIDDEN` (role or club scope only) · 404 not found, **including resources owned by someone else** · 409 business-rule conflict · 500 unexpected · 503 dependency unavailable.

Booking error codes (FT-111, FT-113):
| Code | Status | Message |
|---|---|---|
| `CLASS_NOT_FOUND` | 404 | "This class does not exist." |
| `CLASS_NOT_BOOKABLE` | 409 | "This class can no longer be booked." |
| `ALREADY_BOOKED` | 409 | "You have already booked this class." |
| `CLASS_FULL` | 409 | "This class is full. You can join the waiting list." |
| `BOOKING_NOT_FOUND` | 404 | "This booking does not exist." |
| `BOOKING_ALREADY_CANCELLED` | 409 | "This booking is already cancelled." |
| `CLASS_CANCELLED` | 409 | "This class has been cancelled." |
| `CANCELLATION_WINDOW_CLOSED` | 409 | "Bookings can only be cancelled up to {2 hours} before the class starts." |
| `BOOKING_BLOCKED` | 409 (not 403) | "You can't book classes until {date} because of {N} missed classes." (US-130; also on waiting-list join) |
| `ATTENDANCE_NOT_OPEN` | 409 | "Attendance can be recorded once the class has started." (US-129) |
| `ATTENDANCE_CLOSED` | 409 | "Attendance for this class can no longer be changed. Ask your club manager to correct it." (US-129) |

`BookingDto` (shared by US-122 to US-124): `id, type: "booking", memberId, classId, className, clubId, clubName, startAt, durationMinutes, classStatus, status, attendance, source, bookedAt, cancelledAt, cancelDeadline, canCancel`. Staff viewers also get `memberName`. US-127 adds items with `type: "waitlist"` to `GET /api/me/bookings`.

Domain events (ADR-009): `BookingCancelled` (US-124 → waitlist US-128, credits US-125, refunds US-134); `AttendanceRecorded { bookingId, memberId, classId, classStartAt, previousAttendance, attendance, recordedBy|null, recordedAt }` (US-129 → no-show block US-130).

## Error envelope

Flat body (ADR-008): `{ "code": "<UPPER_SNAKE>", "message": "<plain language>", "fieldErrors"?: [{ "field", "message" }] }`. `fieldErrors` appears only with `VALIDATION_ERROR`. Status codes: 400 validation, 401 unauthenticated, 403 role or club scope only, 404 not found (also non-owned resources, ADR-011), 409 business conflict (including the cancellation window and `BOOKING_BLOCKED`), 503 dependency unavailable. `DomainError` and the Fastify error handler live in `api/src/shared/errors.ts` (US-118). The TK-119 skeleton has no error handler yet; `GET /health` returns its own fixed body.
