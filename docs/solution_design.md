# FitHub – Solution Design

Status: living document. Last update: refinement of FT-108 / TK-119 (tech stack, repository layout, CI). The other sections give the target design from the project brief. Each one is refined further as its stories are refined.

## 1. Architecture overview
FitHub is a **web app backed by a JSON API** (brief §1), built as a single repository with two npm workspaces:

```
Browser (React SPA, web/)  ──HTTP/JSON──►  API (Fastify, api/)  ──SQL──►  PostgreSQL 16
                                              │
                                              ├──► Stripe Payments API (PaymentIntents)  [EP-104]
                                              ◄── Stripe webhooks (/webhooks/stripe)      [EP-104]
                                              └──► Email/notification provider (TBD)      [open question]
One-off CLI (api/scripts/import-*) ──► PostgreSQL                                         [EP-105]
```

- The API is the only component that talks to the database and to Stripe. The SPA holds no business rules; all checks (capacity, double booking, windows, roles) are enforced server-side.
- Background work (payment retries, waiting-list promotion side effects, no-show blocks) runs in-process in the API: a DB-backed job table polled on an interval. There is no separate queue for now (ADR-007, to be confirmed when EP-104 is refined).
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

## 3. Module map
| Path | Responsibility | Introduced by |
|---|---|---|
| `.github/workflows/ci.yml` | CI pipeline: install → format → lint → typecheck → migrate → test → build | TK-119 |
| `docker-compose.yml`, `docker/initdb/` | Local PostgreSQL (`fithub`, `fithub_test`) | TK-119 |
| `api/src/config.ts` | Environment parsing and validation (zod) | TK-119 |
| `api/src/app.ts` | `buildApp({config, db, ...deps})` Fastify factory; dependencies are injected so tests can swap in fakes | TK-119 |
| `api/src/server.ts` | Process entry point (listen, graceful shutdown) | TK-119 |
| `api/src/db/` | `client.ts` (Kysely), `schema.ts` (table types), `migrate.ts` (CLI) | TK-119 |
| `api/migrations/` | `NNNN_snake_case.ts` migrations with `up`/`down` | TK-119 (empty), US-117 onward |
| `api/src/routes/health.ts` | `GET /health` | TK-119 |
| `api/src/modules/<domain>/` | Feature modules: `routes.ts` (HTTP + zod schemas), `service.ts` (business rules, transactions), `repository.ts` (Kysely queries), `errors.ts` | Feature stories |
| `api/src/modules/auth` | Sign-in, sessions, role guard | US-118 |
| `api/src/modules/clubs` | Club reference data | US-117 |
| `api/src/modules/classes` | Create/cancel class, schedule query | US-120, US-121, US-126 |
| `api/src/modules/bookings` | Book, cancel, my bookings, credits | US-122–US-125 |
| `api/src/modules/waitlist` | Join/leave waiting list, promotion | US-127, US-128 |
| `api/src/modules/attendance` | Attendance capture, no-show blocks | US-129, US-130 |
| `api/src/modules/payments` | Stripe client wrapper, webhook, retries, refunds | TK-131, US-132–US-134 |
| `api/src/modules/reports` | Weekly attendance/no-show report | US-137 |
| `api/scripts/` | One-off import CLIs | US-135, US-136 |
| `api/test/unit`, `api/test/integration`, `api/test/helpers` | Vitest tests; integration tests run against PostgreSQL `*_test` | TK-119 |
| `web/src/` | React SPA (pages per feature under `web/src/pages/`, API client under `web/src/api/`) | TK-119 skeleton, feature stories |

### Coding conventions
- Every request body, query and params object is validated with a zod schema in `routes.ts`. Services receive typed input only.
- Business errors are typed (`DomainError` with a `code` and a human-readable `message`). One Fastify error handler maps them to HTTP status codes plus `{ "error": { "code", "message" } }`.
- Every multi-step write runs in one DB transaction inside the service (`db.transaction().execute(...)`).
- Third-party clients (Stripe, mailer, clock) are injected through `buildApp` deps. Tests use fakes, and CI never uses real keys.

## 4. Data model (first cut, from brief §5)

Each story's tech spec fixes the detailed columns, constraints and migrations. **Table names are singular** and match the stories that create them (ADR-008). Status values are `text` + `CHECK`.

| Table | Key columns | Key constraints / indexes | Story |
|---|---|---|---|
| `club` | `id`, `code`, `name`, `timezone` (IANA) | `code` unique, `name` unique | US-117 |
| `app_user` | `id`, `email`, `full_name`, `role` (`member`\|`instructor`\|`club_manager`), `member_type` (`regular`\|`drop_in`, null for staff), `club_id` (staff club / member home club), `legacy_member_id` | `lower(email)` unique, `legacy_member_id` unique | US-118, US-135 |
| `gym_class` | `id`, `club_id`, `name` varchar(100), `start_at` timestamptz, `duration_minutes`, `capacity`, `status` (`scheduled`\|`cancelled`), `instructor_id` (nullable), `created_by`, `created_at`, `updated_at` | CHECK `capacity >= 1`, `duration_minutes > 0`, `length(btrim(name)) > 0`. Index `gym_class_club_start_idx (club_id, start_at)`, `gym_class_instructor_idx (instructor_id)` | US-120 (cancel columns: US-126) |
| `booking` | `id`, `class_id`, `member_id`, `status` (`pending_payment`\|`confirmed`\|`cancelled`), `attendance` (`unknown`\|`attended`\|`no_show`), `source` (`direct`\|`waitlist`), `booked_at`, `cancelled_at` | partial unique `(class_id, member_id) WHERE status IN ('pending_payment','confirmed')` | US-122 |
| `waitlist_entry` | `id`, `class_id`, `member_id`, `joined_at`, `status` (`waiting`\|`promoted`\|`removed`\|`expired`), `promoted_booking_id` | partial unique `(class_id, member_id) WHERE status = 'waiting'`. Index `(class_id, status, joined_at)` | US-127 |
| `payment` | `id`, `booking_id`, `stripe_payment_intent_id`, `amount`, `currency`, `status`, `attempts`, `next_retry_at`, `idempotency_key` | `idempotency_key` unique | US-132, US-133 |
| `credit_transaction` (+ balance view) | `member_id`, `delta`, `reason`, `booking_id` | | US-125, US-136 |
| `booking_block` | `member_id`, `starts_at`, `ends_at`, `reason` | | US-130 |

### Derived values (not stored)
- **Free places** = `capacity − count(booking WHERE status IN ('confirmed','pending_payment'))`, floored at 0. US-121 computes it in the schedule query and US-122 computes it under the class row lock. It is never stored, so it cannot drift.
- **Waiting-list position** = count of `waiting` entries with an earlier `joined_at` + 1 (US-127).

### Schedule read path (US-121)
`GET /api/classes` runs one query: `gym_class` ⋈ `club` ⟕ `app_user` (instructor) ⟕ an aggregated active-booking count per class ⟕ the caller's own active booking. It filters on `start_at > now AND start_at <= now + 14 d` (optionally `club_id`) and orders by `start_at, name, id`. It reads at most ~560 rows. No migration is needed: it uses `gym_class_club_start_idx` and the `booking` partial unique index.

Migrations: Kysely Migrator, `api/migrations/NNNN_snake_case.ts`. Each migration has a working `down`. `npm run db:migrate` runs in CI against the test DB on every change.

## 5. API inventory (planned)

All business routes are registered under the prefix **`/api`** (Fastify `register(..., { prefix: '/api' })`). This matches the Vite dev proxy `/api → :3000`. Only `/health` and `/webhooks/stripe` are unprefixed (ADR-008).

| Method & route | Roles | Story |
|---|---|---|
| `GET /health` | public | TK-119 |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me` | public / authenticated | US-118 |
| `GET /api/clubs` | authenticated | US-117 |
| `GET /api/clubs/:clubId/instructors` | instructor, club_manager (own club) | US-120 |
| `POST /api/classes` | instructor, club_manager (own club) | US-120 |
| `GET /api/classes?clubId=&from=&to=` | authenticated (any role). Two-week window, clamped server-side. `myBookingStatus` only for the caller | **US-121 (refined)** |
| `POST /api/classes/:id/cancel` | instructor, club_manager | US-126 |
| `POST /api/classes/:id/bookings` | member | US-122 |
| `GET /api/me/bookings` | member (own only) | US-123 |
| `POST /api/bookings/:id/cancel` | member (own only) | US-124 |
| `POST /api/classes/:id/waitlist`, `DELETE /api/waitlist/:entryId` | member (own only) | US-127 |
| `PUT /api/classes/:id/attendance` | instructor, club_manager | US-129 |
| `POST /webhooks/stripe` | Stripe (signature-verified) | US-132 |
| `GET /api/reports/weekly-attendance?clubId=&week=` | club_manager (own club) | US-137 |

### `GET /api/classes` contract (US-121)
- Query: `clubId` (UUID, optional; all clubs if omitted), `from`/`to` (ISO 8601 with offset, optional; they can only narrow the window `(now, now + 14 d]`).
- 200: `{ from, to, items: [{ id, clubId, clubName, clubTimezone, name, startAt, durationMinutes, capacity, freePlaces, status, instructorName, myBookingStatus }] }`. `myBookingStatus` ∈ `none | confirmed | pending_payment | waiting` (`waiting` is filled in by US-127). Header `Cache-Control: no-store`.
- Errors: 400 `VALIDATION_ERROR`, 401 `UNAUTHENTICATED`, 404 `CLUB_NOT_FOUND`.

### Error envelope
`{ "error": { "code": "<UPPER_SNAKE>", "message": "<plain language>", "fieldErrors"?: [{ "field", "message" }] } }`. `fieldErrors` appears only with `VALIDATION_ERROR` (generic message "Please correct the highlighted fields."). Status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 business conflict (full, double booking, window closed, blocked), 503 dependency unavailable.

## 6. Security model
- Role-based authorisation on every route (Fastify `preHandler` role guard). Ownership checks for member resources are done in the service layer, not only in the UI (brief §7). Details in US-118 (authentication method is an open question).
- Secrets (Stripe keys, webhook secret, session secret) come only from environment variables or the host's secret store. They never appear in code, tests, logs or CI. `.env` is git-ignored and `.env.example` lists variable names only.
- CI: `permissions: contents: read`. It runs on the `pull_request` trigger (never `pull_request_target`) and has no repository secrets.
- Integration tests refuse to run against any database whose name does not end in `_test`.

## 7. Integration inventory
| System | Direction | Mechanism | Status |
|---|---|---|---|
| Stripe Payments API | outbound | PaymentIntents via official `stripe` SDK, idempotency keys per payment attempt | EP-104, open questions (price, retry policy, refunds) |
| Stripe webhooks | inbound | `POST /webhooks/stripe`, signature verification with webhook secret | EP-104 |
| Legacy member data | inbound, one-off | CLI import script, idempotent upsert by dedup key | EP-105, format and dedup key open |
| Email/notifications | outbound | TBD | open question |
| GitHub Actions | CI | `.github/workflows/ci.yml` | TK-119 (hosting assumed GitHub, to be confirmed) |

## 8. Delivery pipeline and quality checks (FT-108)
- **Workflow `CI` / job `checks`** runs on every pull request and on every push to `main`. Steps: `npm ci` → `format:check` → `lint` (0 warnings) → `typecheck` → `db:migrate` (PostgreSQL 16 service container, DB `fithub_test`) → `test` (Vitest unit + integration, coverage artifact) → `build`. Timeout: 15 min. Target duration: under 5 min.
- `npm run ci` runs the same chain locally, so the pipeline can be moved to another CI host.
- `main` is protected: the `CI / checks` status is required (post-deploy manual step in TK-119).
- Test environment: `TZ=UTC`, `NODE_ENV=test`. There are no real third-party calls.
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
· Reason: low volume (four clubs). It avoids extra infrastructure such as Redis or a queue.
· Alternatives: BullMQ + Redis, a cloud scheduler.
· Consequences: to be confirmed when US-133 (payment retry) is refined. Jobs must be idempotent and use `FOR UPDATE SKIP LOCKED`.

**ADR-008 – Naming and HTTP conventions: singular tables, `/api` prefix, nested error envelope**
· Reason: the stories refined so far (US-117, US-118, US-120, US-122, US-127) already use singular table names (`club`, `app_user`, `gym_class`, `booking`, `waitlist_entry`) and `/api/...` routes. `class` is a reserved word in many contexts, hence `gym_class`. The `/api` prefix lets the Vite dev proxy and a later same-origin deployment route API calls without rewriting. One error envelope keeps the SPA's error handling uniform.
· Alternatives: plural table names and unprefixed routes (the earlier first cut of this document; it would force rework of five refined stories). A flat error body `{ code, message }` (as written in US-120/US-118, superseded by this ADR).
· Consequences: business routes are registered under `/api`, and `/health` and `/webhooks/stripe` stay unprefixed. Errors use `{ error: { code, message, fieldErrors? } }`. Stories whose tech spec predates TK-119 (US-120: Express/Knex/`apps/` paths, flat error body) are implemented with the stack of ADR-001…006 and these conventions. Their names for tables, columns, codes and messages stay valid.

**ADR-009 – Schedule computes free places on read; no denormalised counter**
· Reason: the volume is tiny (≤ 560 classes in the window, ≤ ~30 bookings each), so one aggregated query is cheap. A stored counter on `gym_class` would have to be kept in sync by booking, cancellation, promotion and payment-failure paths, and drift would show wrong availability.
· Alternatives: a `booked_count` column maintained in the booking transaction or by a trigger, or a materialised view.
· Consequences: the schedule (US-121) and the booking check (US-122, under row lock) both derive free places from `booking`. Revisit only if the schedule p95 exceeds 300 ms.

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Repository is not on GitHub, so the workflow file does not run | Low–Med | Low | All steps are npm scripts (`npm run ci`). Porting is one file. Open question recorded on TK-119 |
| Branch protection not enabled, so red builds get merged | Med | High | Post-deploy manual step on TK-119. Verified with a deliberately failing PR |
| Concurrent bookings exceed capacity | Med | High | Row lock on the class plus a partial unique index, proven by parallel integration tests (US-122) |
| US-120 tech spec still names Express/Knex/`apps/api` and a flat error body, conflicting with TK-119 and ADR-003/004/008 | High | Med | ADR-008 states the precedence. The planner was asked to have US-120's spec realigned before development |
| Story order: the schedule (US-121) needs the `booking` table (US-122) and the waiting-list status (US-127) | Med | Low | US-121 depends on the US-122 migration. `waiting` is reserved in the contract and filled in by US-127, and the action buttons are injected by US-122/US-127 |
| Wrong availability shown if free places were cached or stored | Low | Med | Computed on read (ADR-009). `Cache-Control: no-store` on the schedule |
| Flaky integration tests caused by shared DB state | Med | Med | Serial integration files, `resetDb()` before each test, `TZ=UTC`, injected clock |
| Integration tests accidentally run against a real database | Low | High | `_test` name guard runs before connecting |
| Duplicate Stripe charges on retry | Med | High | Stripe idempotency keys plus a unique `payment.idempotency_key` (US-133) |
| Many open business questions (no-show threshold, credits, auth, migration source) | High | Med | Stories stay in "Requires additional information". Foundation work (TK-119, US-120–US-124, US-127) can proceed |
| Time zone assumption (single zone) is wrong | Low | Med | Times are stored in UTC, with `club.timezone` per club (US-117). The UI formats per club time zone (US-120, US-121) |

## 11. Open questions (architecture-relevant)

- Repository hosting and repository admin for branch protection (TK-119).
- Authentication method and account creation (US-118).
- Notification channel (US-128, US-126).
- Hosting/deployment target (affects CORS, secrets store, and when to add CD).
- Club time zones (US-117). The design supports one time zone per club.
- Schedule visibility (US-121, non-blocking): are cancelled classes shown with a "Cancelled" badge, and may every signed-in user view every club? Both are assumed "yes".
