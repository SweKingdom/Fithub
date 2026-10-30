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
Detailed columns, constraints and migrations are fixed in each story's tech spec. Target shape:

| Table | Key columns | Key constraints | Story |
|---|---|---|---|
| `clubs` | `id`, `name` | `name` unique | US-117 |
| `users` | `id`, `email`, `full_name`, `role` (`member`\|`instructor`\|`club_manager`), `member_type` (`regular`\|`drop_in`, null for staff), `home_club_id` | `lower(email)` unique | US-118, US-135 |
| `classes` | `id`, `club_id`, `name`, `starts_at` timestamptz, `duration_min`, `capacity`, `status` (`scheduled`\|`cancelled`), `instructor_id`, `created_by` | `capacity > 0`, `duration_min > 0`, `name <> ''`; index `(club_id, starts_at)` | US-120 |
| `bookings` | `id`, `class_id`, `member_id`, `status` (`pending_payment`\|`confirmed`\|`cancelled`), `attendance` (`unknown`\|`attended`\|`no_show`) | partial unique `(class_id, member_id) WHERE status <> 'cancelled'` | US-122 |
| `waiting_list_entries` | `id`, `class_id`, `member_id`, `joined_at`, `status` (`waiting`\|`promoted`\|`removed`) | partial unique `(class_id, member_id) WHERE status = 'waiting'` | US-127 |
| `payments` | `id`, `booking_id`, `stripe_payment_intent_id`, `amount`, `currency`, `status`, `attempts`, `next_retry_at`, `idempotency_key` | `idempotency_key` unique | US-132, US-133 |
| `credit_transactions` (+ balance view) | `member_id`, `delta`, `reason`, `booking_id` | | US-125, US-136 |
| `booking_blocks` | `member_id`, `starts_at`, `ends_at`, `reason` | | US-130 |

Migrations: Kysely Migrator. Each migration has a working `down`. `npm run db:migrate` runs in CI against the test DB on every change.

## 5. API inventory (planned)
| Method & route | Roles | Story |
|---|---|---|
| `GET /health` | public | TK-119 |
| `POST /auth/...` (TBD) | public | US-118 |
| `GET /clubs` | authenticated | US-117 |
| `POST /classes` | instructor, club_manager | US-120 |
| `POST /classes/:id/cancel` | instructor, club_manager | US-126 |
| `GET /classes?clubId=&from=&to=` | authenticated | US-121 |
| `POST /classes/:id/bookings` | member | US-122 |
| `GET /me/bookings` | member (own only) | US-123 |
| `POST /bookings/:id/cancel` | member (own only) | US-124 |
| `POST /classes/:id/waitlist`, `DELETE /classes/:id/waitlist` | member | US-127 |
| `PUT /classes/:id/attendance` | instructor, club_manager | US-129 |
| `POST /webhooks/stripe` | Stripe (signature-verified) | US-132 |
| `GET /reports/weekly-attendance?clubId=&week=` | club_manager (own club) | US-137 |

Error envelope: `{ "error": { "code": "<UPPER_SNAKE>", "message": "<plain language>" } }`. Status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 business conflict (full, double booking, window closed, blocked), 503 dependency unavailable.

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

## 10. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Repository is not on GitHub, so the workflow file does not run | Low–Med | Low | All steps are npm scripts (`npm run ci`). Porting is one file. Open question recorded on TK-119 |
| Branch protection not enabled, so red builds get merged | Med | High | Post-deploy manual step on TK-119. Verified with a deliberately failing PR |
| Concurrent bookings exceed capacity | Med | High | Row lock on the class plus a partial unique index, proven by parallel integration tests (US-122) |
| Flaky integration tests caused by shared DB state | Med | Med | Serial integration files, `resetDb()` before each test, `TZ=UTC`, injected clock |
| Integration tests accidentally run against a real database | Low | High | `_test` name guard runs before connecting |
| Duplicate Stripe charges on retry | Med | High | Stripe idempotency keys plus a unique `payments.idempotency_key` (US-133) |
| Many open business questions (no-show threshold, credits, auth, migration source) | High | Med | Stories stay in "Requires additional information". Foundation work (TK-119, US-120–US-124, US-127) can proceed |
| Time zone assumption (single zone) is wrong | Low | Med | Store UTC and keep the club time zone as a club attribute if confirmed (US-117) |

## 11. Open questions (architecture-relevant)
- Repository hosting and repository admin for branch protection (TK-119).
- Authentication method and account creation (US-118).
- Notification channel (US-128, US-126).
- Hosting/deployment target (affects CORS, secrets store, and when to add CD).
