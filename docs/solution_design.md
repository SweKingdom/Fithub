# FitHub – Solution Design

Status: living document. Last update: refinement of FT-111 (US-122 booking, US-123 my bookings / ownership, US-124 cancellation). This update added ADR-008 to ADR-011 and aligned table names, route prefix and error body with the stories already refined. Earlier updates: FT-108 / TK-119 (tech stack, repository layout, CI).

## 1. Architecture overview
FitHub is a **web app backed by a JSON API** (brief §1), built as a single repository with two npm workspaces:

```
Browser (React SPA, web/)  ──HTTP/JSON /api/*──►  API (Fastify, api/)  ──SQL──►  PostgreSQL 16
                                              │
                                              ├──► Stripe Payments API (PaymentIntents)  [EP-104]
                                              ◄── Stripe webhooks (/api/webhooks/stripe)  [EP-104]
                                              └──► Email/notification provider (TBD)      [open question]
One-off CLI (api/scripts/import-*) ──► PostgreSQL                                         [EP-105]
```

- The API is the only component that talks to the database and to Stripe. The SPA holds no business rules. All checks (capacity, double booking, windows, roles, ownership) are enforced on the server. Where the UI needs a rule result, the API returns it as a field (e.g. `canCancel`, `cancelDeadline` on bookings).
- Business routes live under `/api`. `GET /health` stays at the root (ADR-008).
- Side effects of state changes (credit return, waiting-list promotion, refunds) are triggered by **in-transaction domain events** (ADR-009). Background work that calls third parties runs through a DB-backed job table that is polled in-process (ADR-007).
- Times are stored as `timestamptz` in UTC and shown in the club's local time (brief §7). "Now" always comes from an injected `clock`.

## 2. Technology stack
| Concern | Choice | ADR |
|---|---|---|
| Runtime | Node.js 22 LTS, TypeScript 5 (strict, ESM) | ADR-001 |
| Repo layout | npm workspaces `api`, `web` | ADR-002 |
| API framework | Fastify 5 + zod (`fastify-type-provider-zod`) | ADR-003 |
| Database / access | PostgreSQL 16, Kysely + `pg`, Kysely Migrator | ADR-004 |
| Web | React 18 + Vite 5 SPA | ADR-005 |
| Tests / quality | Vitest 2, ESLint 9 + typescript-eslint, Prettier 3; GitHub Actions CI | ADR-006 |

> Note: the US-120 tech spec still refers to `apps/api`, Express, Knex and Node 20. That is superseded by ADR-001…004 and TK-119: read it as `api/`, Fastify, Kysely and Node 22. Its table, column and message definitions are still valid (see Risks).

## 3. Module map
| Path | Responsibility | Introduced by |
|---|---|---|
| `.github/workflows/ci.yml` | CI pipeline: install → format → lint → typecheck → migrate → test → build | TK-119 |
| `docker-compose.yml`, `docker/initdb/` | Local PostgreSQL (`fithub`, `fithub_test`) | TK-119 |
| `api/src/config.ts` | Environment parsing and validation (zod) | TK-119; `BOOKING_CANCEL_CUTOFF_MINUTES` added by US-124 |
| `api/src/app.ts` | `buildApp({config, db, clock?, events?, ...deps})` Fastify factory. Dependencies are injected so tests can swap in fakes. Registers business routes under prefix `/api` | TK-119 |
| `api/src/server.ts` | Process entry point (listen, graceful shutdown) | TK-119 |
| `api/src/db/` | `client.ts` (Kysely), `schema.ts` (table types), `migrate.ts` (CLI) | TK-119 |
| `api/migrations/` | `NNNN_snake_case.ts` migrations with `up`/`down` | TK-119 (empty), US-117 onward |
| `api/src/routes/health.ts` | `GET /health` | TK-119 |
| `api/src/shared/errors.ts` | `DomainError(code, message, httpStatus, fieldErrors?)` + Fastify error handler | US-118 |
| `api/src/shared/clock.ts` | `Clock { now(): Date }`, `systemClock` | US-120 (first user) |
| `api/src/shared/domain-events.ts` | `DomainEvent` union, `DomainEventBus` (`subscribe`, `publish(trx, event)`) | US-124 |
| `api/src/modules/<domain>/` | Feature modules: `routes.ts` (HTTP + zod schemas), `service.ts` (business rules, transactions), `repository.ts` (Kysely queries), `errors.ts`, optional `dto.ts` | Feature stories |
| `api/src/modules/auth` | Sign-in, sessions, `requireAuth`, `requireRole` | US-118 |
| `api/src/modules/clubs` | Club reference data | US-117 |
| `api/src/modules/classes` | Create/cancel class, schedule query, class DTO (`freePlaces`, `myBooking`) | US-120, US-121, US-126 |
| `api/src/modules/bookings` | `service.ts` (`bookClass`, `listMyBookings`, `getBooking`, `getClassRoster`, `cancelBooking`), `access.ts` (ownership / club-scope helpers), `dto.ts` (`BookingDto`), `cancel-window.ts` (pure window rules), credits | US-122–US-125 |
| `api/src/modules/waitlist` | Join/leave waiting list, promotion (subscribes to `BookingCancelled`) | US-127, US-128 |
| `api/src/modules/attendance` | Attendance capture, no-show blocks | US-129, US-130 |
| `api/src/modules/payments` | Stripe client wrapper, webhook, retries, refunds | TK-131, US-132–US-134 |
| `api/src/modules/reports` | Weekly attendance/no-show report | US-137 |
| `api/scripts/` | One-off import CLIs | US-135, US-136 |
| `api/test/unit`, `api/test/integration`, `api/test/helpers` | Vitest tests. Integration tests run against PostgreSQL `*_test`. `helpers/factories.ts` builds clubs, users, classes and bookings | TK-119; factories from US-120/US-122 |
| `api/test/integration/bookings.access.test.ts` | Route × actor **access matrix** for all member-owned resources. Every story that adds a booking/waitlist/payment route adds a row | US-123 |
| `web/src/` | React SPA: pages under `web/src/pages/`, shared components under `web/src/components/`, API client under `web/src/api/`, helpers under `web/src/lib/`. Tests under `web/test/` | TK-119 skeleton, feature stories |
| `web/src/pages/MyBookingsPage.tsx`, `web/src/components/BookButton.tsx`, `CancelBookingButton.tsx`, `ConfirmDialog.tsx` | Booking UI | US-122–US-124 |

### Coding conventions
- Every request body, query and params object is validated with a zod schema in `routes.ts`. Services receive typed input only.
- Business errors are typed (`DomainError` with a `code` and a human-readable `message`). One Fastify error handler maps them to HTTP status codes and a flat body `{ "code", "message", "fieldErrors"? }` (ADR-008).
- Every multi-step write runs in one DB transaction inside the service (`db.transaction().execute(...)`).
- **Lock order:** when a transaction needs several row locks, it locks the `gym_class` row first, then `booking` / `waitlist_entry` / `payment` rows (ADR-010). This prevents deadlocks between booking, cancelling and promotion.
- Ownership of member resources is part of the SQL `WHERE` clause (`member_id = :currentUserId`). Rows are never fetched first and filtered afterwards (ADR-011).
- Third-party clients (Stripe, mailer), the clock and the event bus are injected through `buildApp` deps. Tests use fakes, and CI never uses real keys.
- Enumerations are stored as `text` with a CHECK constraint, not as PostgreSQL enum types (ADR-008).

## 4. Data model
Tables use singular snake_case names. Detailed columns, constraints and migrations are fixed in each story's tech spec.

| Table | Key columns | Key constraints / indexes | Story |
|---|---|---|---|
| `club` | `id`, `code`, `name`, `timezone` | `code` unique, `name` unique | US-117 |
| `app_user` | `id`, `email`, `full_name`, `role` (`member`\|`instructor`\|`club_manager`), `member_type` (`regular`\|`drop_in`, null for staff), `club_id`, `legacy_member_id` | `lower(email)` unique, `legacy_member_id` unique | US-118, US-135 |
| `gym_class` | `id`, `club_id`, `name`, `start_at` timestamptz, `duration_minutes`, `capacity`, `status` (`scheduled`\|`cancelled`), `instructor_id`, `created_by` | CHECK `capacity >= 1`, `duration_minutes > 0`, `length(btrim(name)) > 0`; index `(club_id, start_at)` | US-120 |
| `booking` | `id`, `class_id`, `member_id`, `status` (`pending_payment`\|`confirmed`\|`cancelled`), `attendance` (`unknown`\|`attended`\|`no_show`), `source` (`direct`\|`waitlist`), `booked_at`, `cancelled_at` | partial unique `booking_active_member_class_uq (class_id, member_id) WHERE status IN ('pending_payment','confirmed')`; CHECK `(status='cancelled') = (cancelled_at IS NOT NULL)`; indexes `(class_id, status)`, `(member_id)` | US-122 |
| `waitlist_entry` | `id`, `class_id`, `member_id`, `joined_at`, `status` (`waiting`\|`promoted`\|`removed`\|`expired`), `promoted_booking_id` | partial unique `(class_id, member_id) WHERE status = 'waiting'`; index `(class_id, status, joined_at)` | US-127 |
| `payment` | `id`, `booking_id`, `stripe_payment_intent_id`, `amount`, `currency`, `status`, `attempts`, `next_retry_at`, `idempotency_key` | `idempotency_key` unique | US-132, US-133 |
| `credit_transaction` (+ balance view) | `member_id`, `delta`, `reason`, `booking_id` | | US-125, US-136 |
| `booking_block` | `member_id`, `starts_at`, `ends_at`, `reason` | | US-130 |
| `job` (outbox / background jobs) | `id`, `type`, `payload` jsonb, `run_at`, `attempts`, `status` | polled with `FOR UPDATE SKIP LOCKED` | US-133 (ADR-007) |

**Derived values (ADR-010):** free places = `gym_class.capacity` − count of `booking` rows with status `pending_payment` or `confirmed`. This value is not stored. Every write that changes it holds the `gym_class` row lock.

Migrations: Kysely Migrator. Each migration has a working `down`. `npm run db:migrate` runs in CI against the test DB on every change.

## 5. API inventory
All business routes have the prefix `/api`.

| Method & route | Roles | Story |
|---|---|---|
| `GET /health` (no prefix) | public | TK-119 |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me` | public / authenticated | US-118 |
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
| `PUT /api/classes/:id/attendance` | instructor, club_manager | US-129 |
| `POST /api/webhooks/stripe` | Stripe (signature-verified) | US-132 |
| `GET /api/reports/weekly-attendance?clubId=&week=` | club_manager (own club) | US-137 |

Error body (ADR-008): `{ "code": "<UPPER_SNAKE>", "message": "<plain language>", "fieldErrors"?: [{ "field", "message" }] }`.

Status codes: 400 `VALIDATION_ERROR` · 401 `UNAUTHENTICATED` · 403 `FORBIDDEN` (role or club scope only) · 404 not found, **including resources owned by someone else** · 409 business-rule conflict · 500 unexpected · 503 dependency unavailable.

Booking error codes (FT-111):
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
| `BOOKING_BLOCKED` (US-130) | 409 | defined in US-130 |

`BookingDto` (shared by US-122 to US-124): `id, type: "booking", memberId, classId, className, clubId, clubName, startAt, durationMinutes, classStatus, status, attendance, source, bookedAt, cancelledAt, cancelDeadline, canCancel`. Staff viewers also get `memberName`. US-127 adds items with `type: "waitlist"` to `GET /api/me/bookings`.

## 6. Security model
- Role-based authorisation on every route (Fastify `preHandler` `requireRole`). Authentication method: open question (US-118).
- **Member-owned resources** (bookings, waiting-list entries, payments): ownership is enforced in SQL by the helpers in `api/src/modules/bookings/access.ts` (`getReadableBooking`, `getOwnBookingForUpdate`). A foreign resource returns the same 404 body as a non-existent one (ADR-011).
- **Club scope:** staff may only manage or read classes and bookings of their own club (`app_user.club_id = gym_class.club_id`). They get 403 on another club's class, and 404 on a single booking of another club. Rosters return member names only, never e-mail addresses.
- The member id for booking and cancelling always comes from the session, never from the request.
- `bookings.access.test.ts` is the regression net: one row per route × actor (owner, other member, staff own club, staff other club, anonymous).
- Secrets (Stripe keys, webhook secret, session secret) come only from environment variables or the host's secret store. They never appear in code, tests, logs or CI. `.env` is git-ignored and `.env.example` lists variable names only.
- CI: `permissions: contents: read`. It runs on the `pull_request` trigger (never `pull_request_target`) and has no repository secrets.
- Integration tests refuse to run against any database whose name does not end in `_test`.

## 7. Integration inventory
| System | Direction | Mechanism | Status |
|---|---|---|---|
| Stripe Payments API | outbound | PaymentIntents via official `stripe` SDK, idempotency keys per payment attempt. Triggered from the drop-in booking path (US-122 → US-132) and from `BookingCancelled` via the job outbox (US-134) | EP-104, open questions (price, retry policy, refunds) |
| Stripe webhooks | inbound | `POST /api/webhooks/stripe`, signature verification with webhook secret | EP-104 |
| Legacy member data | inbound, one-off | CLI import script, idempotent upsert by dedup key | EP-105, format and dedup key open |
| Email/notifications | outbound | TBD; triggered through the job outbox, never inside a request transaction | open question |
| GitHub Actions | CI | `.github/workflows/ci.yml` | TK-119 (hosting assumed GitHub, to be confirmed) |

## 8. Delivery pipeline and quality checks (FT-108)
- **Workflow `CI` / job `checks`** runs on every pull request and on every push to `main`. Steps: `npm ci` → `format:check` → `lint` (0 warnings) → `typecheck` → `db:migrate` (PostgreSQL 16 service container, DB `fithub_test`) → `test` (Vitest unit + integration, coverage artifact) → `build`. Timeout: 15 min. Target duration: under 5 min.
- `npm run ci` runs the same chain locally, so the pipeline can be moved to another CI host.
- `main` is protected: the `CI / checks` status is required (post-deploy manual step in TK-119).
- Test environment: `TZ=UTC`, `NODE_ENV=test`, a fixed clock injected through `buildApp`. There are no real third-party calls.
- Concurrency rules (capacity, double booking, double cancel) are proven by integration tests that fire parallel `app.inject` calls against real PostgreSQL.
- Status today: the pipeline is specified (TK-119) but not yet in the repository, so **no automated checks run yet**.
- Not yet in place: coverage gate, E2E browser tests, CD/deployment, dependency scanning.

## 9. Key decisions (ADR)
**ADR-001 – Node.js 22 + TypeScript (strict, ESM)**
· Reason: the repo's `.gitignore` already targets Node (`node_modules/`). One language for the SPA and the API. Stripe has a first-class Node SDK. Strict types catch status/enum mistakes in booking logic.
· Alternatives: Python/Django (strong admin, but two languages with a React SPA), Java/Spring (heavier for a small team).
· Consequences: all tooling is npm-based, and Node 22 LTS is pinned via `.nvmrc`.

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
· Consequences: integration test files run serially and reset tables before each test. A guard prevents running them against non-test databases.

**ADR-007 – In-process DB-backed job polling for background work (proposed)**
· Reason: low volume (four clubs). It avoids extra infrastructure such as Redis or a queue. The same table serves as the transactional outbox for side effects that call third parties (ADR-009).
· Alternatives: BullMQ + Redis, a cloud scheduler.
· Consequences: to be confirmed when US-133 (payment retry) is refined. Jobs must be idempotent and use `FOR UPDATE SKIP LOCKED`.

**ADR-008 – API and schema conventions: `/api` prefix, flat error body, singular table names, text + CHECK enums**
· Reason: the stories refined before this one (US-117, US-118, US-120) already use `/api/...` routes, `{ code, message, fieldErrors? }` errors and the tables `club`, `app_user`, `gym_class`. The Vite dev proxy forwards `/api`. `user` is a reserved word in PostgreSQL and `class` clashes with the TypeScript keyword, which explains `app_user` and `gym_class`. `text` + CHECK is simpler to extend and roll back than PostgreSQL enum types.
· Alternatives: the nested `{ error: { code, message } }` body and plural table names from the first draft of this document (would have meant rework in three stories); PostgreSQL enums (`ALTER TYPE` cannot run inside a transaction on older versions and cannot remove values).
· Consequences: business-rule rejections use 409 (including the cancellation window, so not 422). 403 is used only for role or club scope.

**ADR-009 – Side effects through in-transaction domain events**
· Reason: cancelling a booking must free the place and then hand it to the waiting list (US-128), return credits (US-125) and trigger a refund (US-134). Without that, a direct booker could take the freed place between the commit and the promotion. Running the DB-only handlers inside the same transaction makes "cancel + promote + credit" atomic. Handlers that need I/O only enqueue a `job` row (outbox), so no network call happens inside a transaction.
· Alternatives: direct calls from the bookings service to the waitlist, credit and payment services (cyclic module dependencies, harder to test); after-commit events (lose atomicity, so places can be grabbed or credits lost when a crash happens); an external message broker (overkill).
· Consequences: `DomainEventBus` is injected through `buildApp`. A handler failure rolls back the cancel (consistency over availability). The first event is `BookingCancelled` (US-124). Handlers must be fast and idempotent.

**ADR-010 – Derived free places with a class row lock and a fixed lock order**
· Reason: free places = capacity − active bookings, counted while the `gym_class` row is held with `FOR UPDATE`. There is no counter that can drift, and at this volume (≤ ~40 places per class) the count is cheap. Locking `gym_class` first and child rows second avoids deadlocks between book, cancel, waitlist and promotion.
· Alternatives: a stored `booked_count` column (faster reads, but it must be kept in sync by every write path); SERIALIZABLE isolation with retries (more complex error handling); advisory locks (less visible).
· Consequences: the partial unique index stays as a second line of defence against double booking. The schedule computes `freePlaces` with a grouped count (US-121).

**ADR-011 – Ownership enforced in SQL; foreign resources return 404**
· Reason: brief §7 says members can only access their own bookings. Putting `member_id = :me` (or `club_id = :myClub` for staff) in the query makes it impossible to leak data through a forgotten check after the fetch. Returning 404 instead of 403 does not reveal that the resource exists.
· Alternatives: fetch-then-check in each route (easy to forget), row-level security in PostgreSQL (strong, but it needs per-request DB session settings, which adds complexity with pooled connections).
· Consequences: all access goes through `bookings/access.ts`. The route × actor matrix test (`bookings.access.test.ts`) must be extended by every new member-owned route.

## 10. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| US-120 tech spec still names Express/Knex/`apps/` (stale), which could lead to code that does not fit the TK-119 skeleton | Med | Med | Note in §2. Planner told to have US-120 aligned before development starts |
| US-118 (auth) is blocked by open questions, and US-122 to US-124 need `request.user` and a test sign-in helper | High | High | Build the role guard and a test auth helper with a stub session first. Only the sign-in method waits for the answer |
| Drop-in bookings stay `pending_payment` and hold places if US-122 is released before US-132/US-133 | Med | Med | Release constraint on US-122. Hold expiry is defined in US-133 |
| Repository is not on GitHub, so the workflow file does not run | Low–Med | Low | All steps are npm scripts (`npm run ci`). Porting is one file. Open question recorded on TK-119 |
| Branch protection not enabled, so red builds get merged | Med | High | Post-deploy manual step on TK-119. Verified with a deliberately failing PR |
| Concurrent bookings exceed capacity | Med | High | Class row lock plus partial unique index (ADR-010), proven by parallel integration tests (US-122 AC 4) |
| Deadlocks between book, cancel and promotion | Low | Med | Fixed lock order `gym_class` → child rows (ADR-010) |
| A slow or failing event handler blocks cancellations | Low | Med | Handlers do DB work only; I/O goes to the job outbox (ADR-009). Tests cover rollback |
| A new member-owned route is added without an ownership check | Med | High | Central `access.ts` and a mandatory row in the access matrix test (ADR-011) |
| Flaky integration tests caused by shared DB state | Med | Med | Serial integration files, `resetDb()` before each test, `TZ=UTC`, injected clock |
| Integration tests accidentally run against a real database | Low | High | `_test` name guard runs before connecting |
| Duplicate Stripe charges on retry | Med | High | Stripe idempotency keys plus a unique `payment.idempotency_key` (US-133) |
| Many open business questions (no-show threshold, credits, auth, migration source) | High | Med | Those stories stay in "Requires additional information". Foundation work (TK-119, US-120 to US-124, US-127) can proceed |
| Time zone assumption (single zone) is wrong | Low | Med | Store UTC and keep the club time zone as a club attribute (US-117) |

## 11. Open questions (architecture-relevant)
- Repository hosting and repository admin for branch protection (TK-119).
- Authentication method and account creation (US-118).
- Notification channel (US-128, US-126).
- Hosting/deployment target (affects CORS, secrets store, and when to add CD).
- Can members book classes at any club, or only at their home club? US-122 assumes any club.
- How long a drop-in `pending_payment` hold lasts before the place is released (US-133).
