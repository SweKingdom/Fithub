# FitHub – Solution Design

Status: living document. Last update: 2026-10-30 (refinement of FT-109 / US-120).
Source: project brief, fithub-requirements.pdf §1–7.

## 1. Architecture overview
The repository is greenfield (only `docs/` and a Node-style `.gitignore`). The solution is a single-page web app talking to a JSON REST API backed by PostgreSQL.

```
Browser (React SPA, apps/web)
   │  HTTPS, JSON, session cookie
   ▼
API (Node 20 + Express + TypeScript, apps/api)
   ├── modules: auth, clubs, classes, bookings, waitlist, attendance, payments, reports, import
   ├── shared: errors, clock, db (Knex), auth middleware
   ▼
PostgreSQL 16  ◄── Knex migrations (up/down)
   ▲
Stripe (PaymentIntents + webhook)  — EP-104
```
- All times stored as `timestamptz` in UTC; displayed/entered in `club.timezone` (IANA).
- Business rules live in the API service layer; the UI mirrors validation only for UX.
- Capacity-critical operations (booking, cancellation, promotion) run in a DB transaction with row lock on the `gym_class` row (`SELECT … FOR UPDATE`).

## 2. Repository layout and conventions
| Path | Purpose |
|---|---|
| `package.json` | npm workspaces root (`apps/*`), scripts `lint`, `test`, `build` |
| `apps/api/src/app.ts` | Express app factory (routes, error middleware); `server.ts` starts it |
| `apps/api/src/modules/<module>/` | `<module>.routes.ts` (HTTP), `.schema.ts` (Zod), `.service.ts` (rules), `.repository.ts` (Knex), `.dto.ts` |
| `apps/api/src/shared/` | `errors.ts` (AppError types + middleware), `clock.ts` (injectable now), `db.ts` (Knex instance) |
| `apps/api/migrations/` | Knex migrations, `<timestamp>_<name>.ts`, every migration has `down` |
| `apps/api/test/` | Vitest + Supertest integration tests against a test DB |
| `apps/web/src/pages`, `api`, `lib`, `components` | React pages, API clients, helpers; tests next to files (`*.test.tsx`) |
| `scripts/` | One-off/ops scripts (club seed, import) |

Conventions: camelCase in JSON/TS, snake_case in DB; repository layer maps between them. Error JSON everywhere: `{ code, message, fieldErrors? }`.

## 3. Module map
| Module | Stories | Responsibility |
|---|---|---|
| auth | US-118 | Sign-in, session, `requireAuth`, `requireRole`, `GET /api/me` |
| clubs | US-117, US-120 | Club reference data, `GET /api/clubs`, `GET /api/clubs/:clubId/instructors` |
| classes | US-120, US-126, US-121 | Create / cancel classes, schedule query, class DTO with `freePlaces` |
| bookings | US-122, US-123, US-124, US-125 | Book, list own, cancel, credits |
| waitlist | US-127, US-128 | Join/leave, automatic promotion |
| attendance | US-129, US-130 | Attendance capture, no-show block |
| payments | US-132–134, TK-131 | Stripe PaymentIntents, webhook, retry, refunds |
| reports | US-137 | Weekly attendance/no-show report |
| import | US-135, US-136 | Legacy members and credits import |
| devops | TK-119 | CI pipeline |

## 4. Data model
| Table | Key fields | Story |
|---|---|---|
| `club` | `id` uuid PK, `code` unique, `name` unique, `timezone` IANA | US-117 |
| `app_user` | `id`, `email` unique ci, `full_name`, `role` (`member`/`instructor`/`club_manager`), `member_type` (`regular`/`drop_in`), `club_id` FK, `legacy_member_id` unique | US-118 |
| `gym_class` | see below | US-120 |
| `booking` | `id`, `class_id`, `member_id`, `status` (`pending_payment`/`confirmed`/`cancelled`), `attendance` (`unknown`/`attended`/`no_show`); partial unique (`class_id`,`member_id`) where status ≠ `cancelled` | US-122 (to refine) |
| `waiting_list_entry` | `id`, `class_id`, `member_id`, `joined_at`, `status` (`waiting`/`promoted`/`removed`) | US-127 (to refine) |
| `payment` | `id`, `booking_id`, `stripe_payment_intent_id` unique, `amount`, `currency`, `status`, `attempts`, `next_retry_at` | US-132 (to refine) |
| `credit_ledger` | member, delta, reason, booking | US-125 (open) |
| `booking_block` | member, `starts_at`, `ends_at`, reason | US-130 (open) |

### `gym_class` (US-120)
| Column | Type | Null | Default | Constraint |
|---|---|---|---|---|
| `id` | uuid PK | no | `gen_random_uuid()` | |
| `club_id` | uuid FK → `club.id` | no | | ON DELETE RESTRICT |
| `name` | varchar(100) | no | | CHECK `length(btrim(name)) > 0` |
| `start_at` | timestamptz | no | | UTC |
| `duration_minutes` | integer | no | | CHECK `> 0` |
| `capacity` | integer | no | | CHECK `>= 1` |
| `status` | text | no | `'scheduled'` | CHECK IN (`scheduled`,`cancelled`) |
| `instructor_id` | uuid FK → `app_user.id` | yes | null | ON DELETE SET NULL |
| `created_by` | uuid FK → `app_user.id` | no | | ON DELETE RESTRICT |
| `created_at`, `updated_at` | timestamptz | no | `now()` | |

Indexes: `(club_id, start_at)`, `(instructor_id)`. Cancellation columns are added by US-126.

## 5. API inventory
| Route | Roles | Story | Notes |
|---|---|---|---|
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me` | public / any | US-118 | |
| `GET /api/clubs` | any signed-in | US-117 | |
| `GET /api/clubs/:clubId/instructors` | instructor, club_manager (own club) | US-120 | `[{ id, fullName }]` |
| `POST /api/classes` | instructor, club_manager (own club) | US-120 | 201 class DTO; 400 `VALIDATION_ERROR` with `fieldErrors`; 401; 403 |
| `GET /api/classes?clubId&from&to` | any signed-in | US-121 | to refine |
| `POST /api/classes/:id/cancel` | instructor, club_manager | US-126 | open questions |
| Bookings, waitlist, attendance, payments, reports | | EP-103…106 | to refine |

Standard errors: `400 VALIDATION_ERROR` `{ code, message, fieldErrors: [{ field, message }] }` · `401 UNAUTHENTICATED` · `403 FORBIDDEN` (plain-language message) · `404 NOT_FOUND` · `409 CONFLICT` (booking rules) · `500 INTERNAL_ERROR` (no internals exposed).

Class DTO: `{ id, clubId, name, startAt, durationMinutes, capacity, freePlaces, status, instructorId, instructorName, createdBy, createdAt }`.

## 6. Security model
- Session-based authentication (US-118; method still open). Every route except login behind `requireAuth`.
- Authorisation in the API: `requireRole(...)` per route + resource scope in the service (staff → own `club_id`; members → own bookings only).
- Server-controlled fields (status, creator, ownership) are never taken from request bodies; Zod strips unknown fields.
- Knex parameterised queries only; React escapes output.
- Secrets (session secret, Stripe keys, webhook secret, `DATABASE_URL`) from environment variables only; never logged.

## 7. Integration inventory
| System | Direction | Mechanism | Story | Status |
|---|---|---|---|---|
| Stripe | out + webhook in | PaymentIntents API, idempotency keys, signed webhook | EP-104 | open questions (price, retry, refunds) |
| Legacy member data | in, one-off | script in `scripts/` | EP-105 | format unknown |
| Email/notifications | out | to be decided | US-126, US-128 | channel open |

## 8. Configuration
| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | none (required) |
| `SESSION_SECRET` | session signing | none (required) |
| `PORT` | API port | `3000` |
| Stripe keys | EP-104 | none |

Documented in `README.md` and `.env.example` (no real values committed).

## 9. Key decisions (ADR)
**ADR-001 Stack: TypeScript on Node 20, Express API + React (Vite) SPA, npm workspaces monorepo.** Reason: greenfield repo with a Node `.gitignore`; one language front and back; widely known. Alternatives: Next.js full-stack (couples UI and API, brief asks for an API), NestJS (heavier). Consequence: TK-119 CI uses Node 20 + npm.

**ADR-002 PostgreSQL 16.** Reason: transactions and row locks needed to never exceed capacity; CHECK and partial unique constraints back up rules. Alternatives: MySQL (weaker partial indexes), SQLite (concurrency). Consequence: CI needs a Postgres service container.

**ADR-003 Knex for queries and migrations.** Reason: explicit SQL control for `FOR UPDATE` locks and CHECK constraints; migrations with `down`. Alternatives: Prisma (raw SQL needed for locks/CHECKs), TypeORM. Consequence: hand-written row mapping in repositories.

**ADR-004 Zod for input validation, collecting all field errors.** Reason: one schema gives types and plain-language per-field messages (brief §7 usability). Alternatives: express-validator, Joi. Consequence: messages defined once per module and reused by the UI.

**ADR-005 Status columns as `text` + CHECK instead of Postgres enums.** Reason: simpler to extend and roll back in migrations. Alternative: native enum. Consequence: allowed values are kept in a TS const and the CHECK.

**ADR-006 Staff scoped to own club; club in request validated against session.** Reason: brief §6 role-based access; assumption in US-120. Alternative: trust clubId from UI. Consequence: 403 "You can only manage classes for your own club."

**ADR-007 Time entry in club local time, transport and storage in UTC.** Reason: brief §7. API only accepts ISO 8601 with offset; UI converts with `date-fns-tz` using `club.timezone`. Alternative: naive local times in API (ambiguous). Consequence: DST tested in `time.test.ts`.

**ADR-008 Injectable clock (`shared/clock.ts`).** Reason: rules depend on "now" (future start, 2 h cancellation window, no-show month); tests must be deterministic.

## 10. Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| No CI/automated checks yet (TK-119) | High | Medium | Write tests with each story; prioritise TK-119 early |
| Auth method undecided (US-118) blocks every protected story | Medium | High | Keep `requireAuth` interface stable; stories depend only on `req.user` `{ id, role, clubId, memberType }` |
| Club time zones not confirmed (US-117) | Medium | Medium | `club.timezone` per club; conversions in one helper |
| Overbooking under concurrency (US-122, US-128) | Medium | High | Row lock on `gym_class` + transaction; concurrency tests |
| Duplicate Stripe charges on retry (US-133) | Medium | High | Stripe idempotency keys per booking; unique PaymentIntent id |
| Assumptions in US-120 (own-club scope, instructor assignment) not confirmed | Low | Low | Isolated in service rules; easy to change |
