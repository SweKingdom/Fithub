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
| `api/src/config.ts` | Environment parsing and validation (zod) | TK-119 |
| `api/src/app.ts` | `buildApp({config, db, clock, notifier, ...deps})` Fastify factory. Dependencies are injected so tests can swap in fakes. Never starts jobs | TK-119 |
| `api/src/server.ts` | Process entry point (listen, start/stop jobs when `JOBS_ENABLED`, graceful shutdown) | TK-119, US-128 |
| `api/src/jobs/runner.ts` | `startIntervalJobs([...])`: one run at a time per job, errors logged | US-128 or US-133 (first to merge) |
| `api/src/notifications/notifier.ts` | `Notifier` port + `LogNotifier` default | US-128 |
| `api/src/db/` | `client.ts` (Kysely), `schema.ts` (table types), `migrate.ts` (CLI) | TK-119 |
| `api/migrations/` | `NNNN_snake_case.ts` migrations with `up`/`down` | TK-119 (empty), US-117 onward |
| `api/src/routes/health.ts` | `GET /health` | TK-119 |
| `api/src/modules/<domain>/` | Feature modules: `routes.ts` (HTTP + zod schemas), `service.ts` (business rules, transactions), `repository.ts` (Kysely queries), `dto.ts`, `errors.ts` | Feature stories |
| `api/src/modules/auth` | Sign-in, sessions, role guard | US-118 |
| `api/src/modules/clubs` | Club reference data | US-117 |
| `api/src/modules/classes` | Create/cancel class, schedule query (incl. `myBooking`, `myWaitlist`) | US-120, US-121, US-126, US-127 |
| `api/src/modules/bookings` | Book, cancel, my bookings, credits. Owns `lockClassForUpdate` and `countActiveBookings` | US-122–US-125 |
| `api/src/modules/waitlist` | `service.ts` join/leave (US-127); `promotion.ts` `promoteNext` + `notifyPromotions`, `maintenance.ts` expiry and sweep job (US-128) | US-127, US-128 |
| `api/src/modules/attendance` | Attendance capture, no-show blocks | US-129, US-130 |
| `api/src/modules/payments` | Stripe client wrapper, webhook, retries, refunds | TK-131, US-132–US-134 |
| `api/src/modules/reports` | Weekly attendance/no-show report | US-137 |
| `api/scripts/` | One-off import CLIs | US-135, US-136 |
| `api/test/unit`, `api/test/integration`, `api/test/helpers` | Vitest tests; integration tests run against PostgreSQL `*_test`. `helpers/fakes.ts` holds `FakeNotifier` and the fake clock | TK-119 |
| `web/src/` | React SPA (pages under `web/src/pages/`, components under `web/src/components/` e.g. `BookButton`, `WaitlistButton`, `ConfirmDialog`; API client under `web/src/api/`) | TK-119 skeleton, feature stories |

### Coding conventions
- Every request body, query and params object is validated with a zod schema in `routes.ts`. Services receive typed input only.
- Business errors are typed (`DomainError` with a `code` and a human-readable `message`). One Fastify error handler maps them to HTTP status codes plus `{ "error": { "code", "message" } }`.
- Every multi-step write runs in one DB transaction inside the service (`db.transaction().execute(...)`). Writes that affect places on a class lock the `gym_class` row first (ADR-010).
- Side effects outside the database (notifications) run **after commit**. The transaction returns what happened (e.g. `Promotion[]`), and the caller hands it to the port.
- Third-party clients (Stripe, notifier, clock) are injected through `buildApp` deps. Tests use fakes, and CI never uses real keys.

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
- Role-based authorisation on every route (Fastify `preHandler` role guard). Ownership checks for member resources are done in SQL in the service layer (`member_id = request.user.id`). Non-owned resources return 404 (brief §7, US-123).
- The member id always comes from the session, never from the request body or params.
- The schedule exposes only the caller's own booking and waiting-list position, never other members' identities.
- Secrets (Stripe keys, webhook secret, session secret) come only from environment variables or the host's secret store. They never appear in code, tests, logs or CI. `.env` is git-ignored and `.env.example` lists variable names only.
- Logs and notification payloads carry ids only, never emails or names.
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
- **Workflow `CI` / job `checks`** runs on every pull request and on every push to `main`. Steps: `npm ci` → `format:check` → `lint` (0 warnings) → `typecheck` → `db:migrate` (PostgreSQL 16 service container, DB `fithub_test`) → `test` (Vitest unit + integration, coverage artifact) → `build`. Timeout: 15 min.
- `npm run ci` runs the same chain locally.
- `main` is protected: the `CI / checks` status is required (post-deploy manual step in TK-119).
- Test environment: `TZ=UTC`, `NODE_ENV=test`, `JOBS_ENABLED=false`. Jobs are tested by calling their run function directly. There are no real third-party calls.
- Not yet in place: coverage gate, E2E browser tests, CD/deployment, dependency scanning. No checks are configured in the repository yet; TK-119 introduces them.

### Configuration inventory (selected)
| Variable | Default | Story |
|---|---|---|
| `BOOKING_CANCEL_CUTOFF_MINUTES` | `120` | US-124 |
| `WAITLIST_PROMOTION_CUTOFF_MINUTES` | `0` (assumption, PO to confirm) | US-128 (read by US-127) |
| `WAITLIST_JOB_INTERVAL_SECONDS` | `60` | US-128 |
| `JOBS_ENABLED` | `true` (`false` in tests) | US-128 / US-133 |

## 9. Key decisions (ADR)

**ADR-001 – Node.js 22 + TypeScript (strict, ESM)**
· Reason: the repo's `.gitignore` already targets Node. One language for the SPA and the API. Stripe has a first-class Node SDK. Strict types catch status/enum mistakes.
· Alternatives: Python/Django, Java/Spring.
· Consequences: npm-based tooling, Node 22 LTS pinned via `.nvmrc`.

**ADR-002 – Single repo, npm workspaces `api` and `web`**
· Reason: one PR changes the API and the UI together, there is one CI pipeline, and no extra tool is needed.
· Alternatives: separate repos, Turborepo.
· Consequences: root scripts fan out with `--workspaces`.

**ADR-003 – Fastify 5 + zod for the API**
· Reason: TypeScript-first, schema validation at the boundary, `app.inject()` for fast HTTP-level tests.
· Alternatives: Express, NestJS, Next.js API routes.
· Consequences: every route declares zod schemas, and `buildApp` stays a pure factory.

**ADR-004 – PostgreSQL 16 with Kysely and Kysely Migrator**
· Reason: capacity must never be exceeded under concurrency, which needs explicit transactions, row locks and partial unique indexes, with typing.
· Alternatives: Prisma, TypeORM, raw `pg`.
· Consequences: table types are kept in `api/src/db/schema.ts`.

**ADR-005 – React + Vite SPA**
· Reason: a simple client-rendered app, fast builds, same test runner.
· Alternatives: Next.js, server-rendered templates.
· Consequences: CORS or same-origin hosting is decided with deployment. In dev, Vite proxies `/api`.

**ADR-006 – Vitest, ESLint, Prettier, GitHub Actions with a Postgres service container**
· Reason: one test runner. Real PostgreSQL proves the locking and constraint behaviour.
· Alternatives: Jest, Testcontainers, SQLite.
· Consequences: serial integration files, table reset per test, guard against non-test DBs.

**ADR-007 – In-process interval jobs for background work (accepted with US-128)**
· Reason: low volume (four clubs). No Redis or queue to operate. The first consumers are `waitlist-maintenance` (US-128) and `payment-retry` (US-133).
· Alternatives: BullMQ + Redis, a cloud scheduler, a DB job table with workers.
· Consequences: `api/src/jobs/runner.ts` runs jobs in the API process when `JOBS_ENABLED=true`, one run at a time per job. Jobs must be idempotent and safe on several instances (row locks / `SKIP LOCKED` / idempotent updates). There is no persistence of job runs; a missed run is caught by the next one.

**ADR-008 – Naming and HTTP conventions: singular tables, `/api` prefix, nested error envelope**
· Reason: the refined stories use singular table names (`gym_class` because `class` is reserved) and `/api/...` routes. The prefix suits the Vite proxy and same-origin hosting. One error envelope keeps the SPA's error handling uniform.
· Alternatives: plural tables and unprefixed routes; flat error body `{ code, message }`.
· Consequences: errors use `{ error: { code, message, fieldErrors? } }`. Stories whose text still shows the flat body (US-118, US-120, US-122) are implemented with the nested envelope. Their codes and messages stay valid.

**ADR-009 – Schedule computes free places on read; no denormalised counter**
· Reason: tiny volume. A stored counter would need to be kept in sync by booking, cancellation, promotion and payment paths.
· Alternatives: a `booked_count` column or trigger, a materialised view.
· Consequences: the schedule and every allocation path derive free places from `booking`. Revisit if the schedule p95 exceeds 300 ms.

**ADR-010 – The `gym_class` row lock is the single serialisation point for place allocation**
· Reason: booking (US-122), cancellation (US-124), waiting-list join (US-127), promotion (US-128), payment expiry (US-133) and class cancellation (US-126) all read or change the free places of one class. If each of them takes `SELECT … FROM gym_class WHERE id = :id FOR UPDATE` first, they run one at a time per class, capacity cannot be exceeded, and the queue order cannot be broken. Partial unique indexes on `booking` and `waitlist_entry` are the second line of defence.
· Alternatives: `SERIALIZABLE` isolation with retries (more complex, retry storms on popular classes); advisory locks (invisible in the schema); `SKIP LOCKED` on queue rows (unnecessary under the class lock, and it can skip a row whose leave is later rolled back).
· Consequences: lock order is always `gym_class` → `booking`/`waitlist_entry`, so deadlocks are avoided. Only requests for the same class wait for each other. Each such transaction must stay short (no external calls such as Stripe inside it).

**ADR-011 – Waiting-list promotion runs synchronously in the transaction that frees the place, with a periodic sweep as a safety net**
· Reason: the requirement says the first waiting member gets the place "automatically". Promoting in the same transaction means a direct booker can never take a freed place ahead of the queue, and there is no window where the class shows a free place. The sweep (every `WAITLIST_JOB_INTERVAL_SECONDS`) covers triggers from stories built later, members who become eligible again, and any missed call.
· Alternatives: in-process domain events (`BookingCancelled`) handled after commit (the place is briefly visible and bookable, and events are lost on a crash); a job-only approach (up to one interval of delay, and the place can be taken directly); offer/accept with a time limit (not asked for; open question).
· Consequences: `promoteNext(trx, classId, ctx)` is part of the bookings/payments transaction contract, and every place-freeing path must call it. Promotion confirms immediately (drop-in → `pending_payment`). The cut-off is configurable (`WAITLIST_PROMOTION_CUTOFF_MINUTES`, default 0).

**ADR-012 – Notifications through an injected `Notifier` port, called after commit**
· Reason: the channel (email/SMS/in-app) is still an open question, but promotion must already be able to inform members. A port lets US-128 ship with a `LogNotifier`, and a real channel can be added later without touching the promotion logic. Calling it after commit prevents notifying about rolled-back promotions.
· Alternatives: a transactional outbox table (guaranteed delivery, but more machinery before a channel exists); sending inside the transaction (holds the class lock during a network call, and could notify about rollbacks).
· Consequences: a crash between commit and notify can lose a notification. This is acceptable while the app also shows the booking in "My bookings". When a real channel is chosen, revisit with an outbox table if guaranteed delivery is required.

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Repository is not on GitHub, so the workflow file does not run | Low–Med | Low | All steps are npm scripts (`npm run ci`). Open question on TK-119 |
| Branch protection not enabled | Med | High | Post-deploy manual step on TK-119 |
| Concurrent bookings or promotions exceed capacity | Med | High | Class row lock (ADR-010) plus partial unique indexes, proven by parallel integration tests (US-122 AC 4, US-127 AC 3, US-128 AC 3) |
| A place-freeing path forgets to call `promoteNext` (US-124, US-132, US-133, future capacity edit) | Med | Med | The maintenance sweep promotes within one interval (US-128 AC 7). The contract is documented in §5. Code review checks every path that sets a booking to `cancelled` |
| Member promoted less than 2 h before start cannot cancel, which leads to no-shows and blocks | Med | Med | `WAITLIST_PROMOTION_CUTOFF_MINUTES` is configurable. PO question recorded on US-128 |
| Promoted drop-in members do not pay, so their places are held | Med | Med | The `pending_payment` hold expiry from US-133 frees the place and promotes again. Drop-in promotion does not go live before US-132 |
| Promotion notification lost (log-only, or crash after commit) | Med | Low | The booking is visible in the app. A real channel and outbox come once the channel is decided (ADR-012) |
| Jobs run on several API instances at the same time | Low | Low | Idempotent expiry. Promotion is serialised by the class lock |
| Story text inconsistencies: error body flat vs nested (US-118/US-120/US-122) and class DTO `myBooking` (US-122) vs `myBookingStatus` (US-121) | High | Low | ADR-008 states the precedence. The DTO carries both fields (§5). The planner was informed |
| US-123 ("My bookings") lists waiting entries, so it depends on US-127 | Med | Low | US-127 provides `listActiveEntriesForMember` and `WaitlistEntryDto`. Plan US-127 before US-123 |
| Flaky integration tests caused by shared DB state or time | Med | Med | Serial files, `resetDb()`, `TZ=UTC`, injected clock, `queue_seq` ordering |
| Duplicate Stripe charges on retry | Med | High | Idempotency keys plus a unique `payment.idempotency_key` (US-133) |
| Many open business questions | High | Med | Stories with defaults proceed. The others stay in refinement |
| Time zone assumption wrong | Low | Med | UTC storage, `club.timezone` per club |

## 11. Open questions (architecture-relevant)

- Repository hosting and repository admin for branch protection (TK-119).
- Authentication method and account creation (US-118).
- Notification channel and message texts (US-128, US-126). Until answered: `LogNotifier` plus in-app visibility.
- Waiting-list promotion (US-128, non-blocking, defaults configured): the cut-off before class start; drop-in promotion (pending payment vs skip vs saved card); whether blocked members are skipped or removed.
- Hosting/deployment target (affects CORS, secrets store, and when to add CD).
- Club time zones (US-117).
- Schedule visibility (US-121, non-blocking).
