# FitHub – Solution Design

Status: living document. Last update: refinement of FT-111 (US-123 view my bookings, US-124 cancel my booking, US-125 class credits). Changes in this update: new `credits` module and credit ledger tables (`credit_balance`, `credit_transaction`), `NO_CREDITS` error, `GET /api/me.creditBalance`, `BookingDto.creditUsed`, the first production event subscriber (credit return), `BookingCancelled.cause` defined by US-124 from the start, lock order extended with `credit_balance`, and ADR-017. Earlier updates: FT-109 (US-120, US-126), FT-112 (US-127, US-128), FT-108/TK-119, US-121, US-122.

## 1. Architecture overview
FitHub is a **web app backed by a JSON API** (brief §1), built as a single repository with two npm workspaces:

```
Browser (React SPA, web/)  ──HTTP/JSON──►  API (Fastify, api/)  ──SQL──►  PostgreSQL 16
                                              │
                                              ├──► Stripe Payments API (PaymentIntents)  [EP-104]
                                              ◄── Stripe webhooks (/webhooks/stripe)      [EP-104]
                                              ├──► Notifier port (LogNotifier now; email/SMS TBD)  [US-128, US-126]
                                              └── in-process interval jobs (waitlist-maintenance, payment-retry)  [ADR-007]
One-off CLI (api/scripts/import-*) ──► PostgreSQL                                         [EP-105]
```

- The API is the only component that talks to the database and to Stripe. The SPA holds no business rules; all checks (capacity, double booking, windows, roles, credits) are enforced server-side.
- **Place allocation is serialised per class** by a row lock on `gym_class` (ADR-010). Booking, booking cancellation, class cancellation, waiting-list join and promotion all take this lock first.
- **Class credits** (US-125) are debited inside the booking or promotion transaction and returned by an in-transaction `BookingCancelled` subscriber. The balance and its ledger change together (ADR-017).
- **Waiting-list promotion runs synchronously** inside the transaction that frees the place (US-128). An interval job is the safety net and expires entries.
- Side effects of a cancellation (credits, refunds) react to in-transaction domain events (ADR-009); notifications run after commit through the `Notifier` port.
- Background work runs in-process through `api/src/jobs/runner.ts` interval jobs (ADR-007). Jobs are idempotent and safe on several instances.
- Times are stored as `timestamptz` in UTC and shown in the club's local time (brief §7).

## 2. Technology stack
| Concern | Choice | ADR |
|---|---|---|
| Runtime | Node.js 22 LTS, TypeScript 5 (strict, ESM) | ADR-001 |
| Repo layout | npm workspaces `api`, `web` | ADR-002 |
| API framework | Fastify 5 + zod (`fastify-type-provider-zod`) | ADR-003 |
| Database / access | PostgreSQL 16, Kysely + `pg`, Kysely Migrator | ADR-004 |
| Web | React 18 + Vite 5 SPA; `date-fns-tz` for club-local → UTC input conversion | ADR-005, ADR-015 |
| Tests / quality | Vitest 2, ESLint 9 + typescript-eslint, Prettier 3; GitHub Actions CI | ADR-006 |
| Background jobs | In-process interval jobs (`api/src/jobs/runner.ts`) | ADR-007 |

## 3. Module map

| Path | Responsibility | Introduced by |
|---|---|---|
| `.github/workflows/ci.yml` | CI pipeline: install → format → lint → typecheck → migrate → test → build | TK-119 |
| `docker-compose.yml`, `docker/initdb/` | Local PostgreSQL (`fithub`, `fithub_test`) | TK-119 |
| `api/src/config.ts` | Environment parsing and validation (zod) | TK-119; `BOOKING_CANCEL_CUTOFF_MINUTES` (US-124); `WAITLIST_*` (US-128); `ATTENDANCE_*` (US-129); `NO_SHOW_*` (US-130) |
| `api/src/app.ts` | `buildApp({config, db, clock?, events?, notifier?, ...deps})` Fastify factory. Dependencies are injected so tests can swap in fakes. Registers business routes under `/api` and the domain-event subscriptions (`registerCreditHandlers`, US-125) | TK-119 |
| `api/src/server.ts` | Process entry point (listen, graceful shutdown). Starts/stops background loops — never `buildApp` | TK-119 |
| `api/src/db/` | `client.ts` (Kysely), `schema.ts` (table types), `migrate.ts` (CLI) | TK-119 |
| `api/migrations/` | `NNNN_snake_case.ts` migrations with `up`/`down` | TK-119 (empty), US-117 onward |
| `api/src/routes/health.ts` | `GET /health` | TK-119 |
| `api/src/shared/errors.ts` | `DomainError(code, message, httpStatus, fieldErrors?)` + Fastify error handler (incl. zod → `fieldErrors`, first issue per field) | US-118 (zod mapping completed by US-120 if missing) |
| `api/src/shared/clock.ts` | `Clock { now(): Date }`, `systemClock` | US-120 |
| `api/src/shared/domain-events.ts` | `DomainEvent` union (`BookingCancelled` incl. `cause` — US-124; `AttendanceRecorded` US-129), `DomainEventBus` (`subscribe`, `publish(trx, event)`) | US-124 |
| `api/src/notifications/notifier.ts` | `Notifier` port, `LogNotifier`; events `waitlist_promoted` (US-128), `class_cancelled` (US-126) | US-128 |
| `api/src/jobs/runner.ts` | Interval job runner | US-128 / US-133 |
| `api/src/modules/<domain>/` | Feature modules: `routes.ts` (HTTP + zod schemas), `service.ts` (business rules, transactions), `repository.ts` (Kysely queries), `errors.ts`, optional `dto.ts`, `policy.ts`, `handlers.ts` (event subscribers) | Feature stories |
| `api/src/modules/auth` | Sign-in, sessions, `requireAuth`, `requireRole`; `GET /api/me` (incl. `bookingBlock` US-130, `creditBalance` US-125) | US-118 |
| `api/src/modules/clubs` | Club reference data; `GET /api/clubs/:clubId/instructors` | US-117, US-120 |
| `api/src/modules/classes` | `routes.ts` (create, cancel, schedule), `service.ts` (`createClass`, `cancelClass`, `getSchedule`), `repository.ts`, `dto.ts` (`ClassDto`, `ClassCancellationDto`), `policy.ts` (`canCancelClass`), `notify.ts` (`notifyClassCancelled`), `schedule-window.ts`, `errors.ts` | US-120, US-121, US-126 |
| `api/src/modules/bookings` | `service.ts` (`bookClass`, `listMyBookings`, `getBooking`, `getClassRoster`, `cancelBooking`), `access.ts` (ownership / club-scope helpers), `dto.ts` (`BookingDto`), `cancel-window.ts` | US-122–US-124 |
| `api/src/modules/credits` | `policy.ts` (`usesCredits`, `refundReasonFor`), `repository.ts` (`debitOne`, `creditOne`, `lockBalance`, …), `service.ts` (`consumeCreditForBooking`, `hasCreditForUpdate`, `assertHasCredit`, `returnCreditForCancelledBooking`), `handlers.ts` (`registerCreditHandlers`), `errors.ts` (`NO_CREDITS`). Used by bookings, waitlist and the credit import CLI | US-125 (ADR-017), US-136 |
| `api/src/modules/waitlist` | Join/leave waiting list, `promotion.ts` (`promoteNext`), `maintenance.ts` | US-127, US-128 |
| `api/src/modules/attendance` | Attendance window, roster, auto no-show sweep, no-show block service | US-129, US-130 |
| `api/src/modules/payments` | Stripe client wrapper, webhook, retries, refunds | TK-131, US-132–US-134 |
| `api/src/modules/reports` | Weekly attendance/no-show report | US-137 |
| `api/scripts/` | One-off import CLIs | US-135, US-136 |
| `api/test/unit`, `api/test/integration`, `api/test/helpers` | Vitest tests. Integration tests run against PostgreSQL `*_test`. `helpers/factories.ts` (clubs, users, classes, bookings, `setCredits`), `helpers/fakes.ts` (`FakeNotifier`, spy bus), `helpers/credits.ts` (`expectLedgerConsistent`) | TK-119; factories US-120/US-122/US-125; fakes US-128 |
| `api/test/integration/bookings.access.test.ts` | Route × actor **access matrix** for all member-owned and club-scoped routes. Every story that adds such a route adds rows | US-123 (+US-126, US-129) |
| `web/src/` | React SPA: pages `web/src/pages/`, components `web/src/components/`, API client `web/src/api/`, helpers `web/src/lib/`. Tests under `web/test/` | TK-119, feature stories |
| `web/src/pages/NewClassPage.tsx` (`/classes/new`), `web/src/lib/time.ts` | Class creation form; club-time helpers (`clubLocalToUtc`, `formatClubTime`, `formatClubDay`, `clubDateKey`) | US-120, US-121 |
| `web/src/pages/SchedulePage.tsx`, `web/src/components/ClassCard.tsx`, `CancelClassButton.tsx` | Schedule; staff class cancellation | US-121, US-126 |
| `web/src/pages/MyBookingsPage.tsx` (`/my-bookings`), `web/src/components/BookButton.tsx`, `CancelBookingButton.tsx`, `ConfirmDialog.tsx`, `CreditBalance.tsx` | Booking UI; credit balance badge in the navigation | US-122–US-125 |
| `web/src/pages/ClassAttendancePage.tsx`, `web/src/components/BookingBlockBanner.tsx` | Attendance roster (staff); block banner (members) | US-129, US-130 |

### Coding conventions
- Every request body, query and params object is validated with a zod schema in `routes.ts`. Services receive typed input only. Validation collects all field errors; the error handler returns **one entry per field** (the first zod issue for that path).
- **Auth guards run before validation:** `requireAuth` and `requireRole` are attached as `preValidation` (or `onRequest`) hooks, so unauthenticated or wrong-role callers get 401/403 and never learn the body rules (US-120).
- Business errors are typed (`DomainError` with a `code` and a human-readable `message`). One Fastify error handler maps them to HTTP status codes and a flat body (ADR-008).
- Every multi-step write runs in one DB transaction inside the service (`db.transaction().execute(...)`).
- **Lock order:** `gym_class` row first → `booking` / `waitlist_entry` / `payment` rows (several rows in `member_id` order) → `credit_balance` rows (in `member_id` order) → `app_user` rows (ADR-010, ADR-013, ADR-017). One exception: promotion locks the candidate's `credit_balance` row before claiming its `waitlist_entry`. This is safe because no transaction waits for a `credit_balance` row while holding a `waitlist_entry` lock.
- Ownership of member resources is part of the SQL `WHERE` clause (`member_id = :currentUserId`) (ADR-011).
- Authorisation and business rules that may change (who may cancel a class, who uses credits) live in one pure `policy.ts` function per module. The endpoint and flags such as `canCancel` share that function.
- Third-party clients (Stripe, mailer), the clock, the notifier and the event bus are injected through `buildApp` deps. Tests use fakes; CI never uses real keys.
- Event subscribers live in `<module>/handlers.ts` and are registered in `buildApp` on the injected bus. Tests add spy subscribers to the same bus.
- Background loops are plain exported functions (`runXxx(deps)`) that tests call directly; `server.ts` only schedules them. Runs are idempotent and use `FOR UPDATE SKIP LOCKED`.
- Enumerations are stored as `text` with a named CHECK constraint, not as PostgreSQL enum types (ADR-008).

## 4. Data model

Tables use singular snake_case names (ADR-008). Detailed columns, constraints and migrations are fixed in each story's tech spec.

| Table | Key columns | Key constraints / indexes | Story |
|---|---|---|---|
| `club` | `id`, `code`, `name`, `timezone` (IANA) | `code` unique, `name` unique | US-117 |
| `app_user` | `id`, `email`, `full_name`, `role` (`member`\|`instructor`\|`club_manager`), `member_type` (`regular`\|`drop_in`, null for staff), `club_id`, `legacy_member_id` | `lower(email)` unique, `legacy_member_id` unique | US-118, US-135 |
| `gym_class` | `id`, `club_id`, `name` varchar(100), `start_at`, `duration_minutes`, `capacity`, `status` (`scheduled`\|`cancelled`), `instructor_id` (null allowed), `created_by`, `created_at`, `updated_at`; `cancelled_at`, `cancelled_by` (FK `app_user`), `cancellation_reason` varchar(500) | CHECK `gym_class_capacity_ck capacity >= 1`, `gym_class_duration_ck duration_minutes > 0`, `gym_class_name_ck length(btrim(name)) > 0`, `gym_class_status_ck`, `gym_class_cancelled_ck (status='cancelled') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)`. Index `gym_class_club_start_idx (club_id, start_at)`, `gym_class_instructor_idx` | US-120, US-126 |
| `booking` | `id`, `class_id`, `member_id`, `status` (`pending_payment`\|`confirmed`\|`cancelled`), `attendance` (`unknown`\|`attended`\|`no_show`), `attendance_recorded_by`, `attendance_recorded_at`, `no_show_block_id`, `source` (`direct`\|`waitlist`), `booked_at`, `cancelled_at`, `created_at`, `updated_at` | partial unique `booking_active_member_class_uq (class_id, member_id) WHERE status IN ('pending_payment','confirmed')`; CHECK `(status='cancelled') = (cancelled_at IS NOT NULL)`; CHECK `booking_attendance_recorded_ck`; indexes `booking_class_status_idx`, `booking_member_idx`, partial `booking_uncounted_no_show_idx` | US-122, US-129, US-130 |
| `waitlist_entry` | `id`, `class_id`, `member_id`, `queue_seq` (bigint identity), `status` (`waiting`\|`promoted`\|`removed`\|`expired`), `joined_at`, `ended_at`, `promoted_booking_id`, `created_at`, `updated_at` | `queue_seq` unique; partial unique `waitlist_entry_waiting_class_member_uq (class_id, member_id) WHERE status = 'waiting'`; CHECK `(status='waiting') = (ended_at IS NULL)`; CHECK `promoted_booking_id IS NULL OR status='promoted'`; indexes `(class_id, status, queue_seq)`, `(member_id, status)` | US-127 |
| `payment` | `id`, `booking_id`, `stripe_payment_intent_id`, `amount`, `currency`, `status`, `attempts`, `next_retry_at`, `idempotency_key` (+ `refund_status`, `stripe_refund_id` US-134) | `idempotency_key` unique | US-132–US-134 |
| `credit_balance` | `member_id` (PK, FK `app_user`), `balance` int default 0, `created_at`, `updated_at` | CHECK `credit_balance_non_negative_ck balance >= 0`. A missing row means balance 0 | US-125 |
| `credit_transaction` | `id`, `member_id` (FK `app_user`), `delta` int, `reason` (`migration`\|`booking`\|`cancellation_refund`\|`class_cancelled_refund`\|`manual_adjustment`), `booking_id` (FK `booking`, nullable), `balance_after` int, `created_at` | CHECK `credit_transaction_reason_ck`, `credit_transaction_delta_ck` (booking −1, refunds +1, migration > 0, manual ≠ 0), `credit_transaction_booking_ck` (booking reasons ⇔ `booking_id` set), `credit_transaction_balance_after_ck ≥ 0`; partial unique `credit_transaction_booking_debit_uq (booking_id) WHERE reason='booking'`, `credit_transaction_booking_refund_uq (booking_id) WHERE reason IN (refunds)`, `credit_transaction_migration_uq (member_id) WHERE reason='migration'`; index `credit_transaction_member_idx (member_id, created_at)` | US-125, US-136 |
| `booking_block` | `id`, `member_id`, `reason` (`no_show`\|`manual`), `starts_at`, `ends_at`, `no_show_count`, `lifted_at`, `created_at` | CHECK `ends_at >= starts_at`; index `(member_id, ends_at)` | US-130 |
| `job` (outbox / background jobs) | `id`, `type`, `payload` jsonb, `run_at`, `attempts`, `status` | polled with `FOR UPDATE SKIP LOCKED` | US-133 (ADR-007) |

### Derived values (not stored)
- **Free places** = `capacity − count(booking WHERE status IN ('confirmed','pending_payment'))`, floored at 0; computed on read and under the class lock (ADR-010).
- **Waiting-list position** = count of `waiting` entries on the class with `queue_seq <=` own `queue_seq` (US-127).
- **`canCancel`** on schedule items = `status = 'scheduled' AND start_at > now AND canCancelClass(user, class) = 'ok'` (US-126).
- **`creditUsed`** on `BookingDto` = a `credit_transaction` row with `reason = 'booking'` exists for the booking (US-125).

### Class lifecycle (US-120, US-126)
```
(create, staff) ──► scheduled ──cancel (staff, before start)──► cancelled   (final; no reinstating)
```
Cancelling a class, in one transaction under the class lock: active bookings → `cancelled` (one `BookingCancelled { cause: 'class_cancelled' }` each), `waiting` entries → `removed`, no promotion. Members are notified after commit.

### Booking lifecycle (US-122, US-124, US-132)
```
book (regular) ─────► confirmed ──cancel (owner, ≥ cut-off before start)──► cancelled
book (drop-in) ─────► pending_payment ──payment succeeded (US-132)──► confirmed
                              └──cancel / payment failed or expired (US-132/US-133)──► cancelled
any active ──class cancelled (US-126)──► cancelled
```
Every transition to `cancelled` publishes exactly one `BookingCancelled` inside its transaction.

### Waiting-list lifecycle (US-127, US-128)
```
waiting ──leave (member)────────────► removed
   │   ──direct booking of same class► removed
   │   ──class cancelled (US-126)────► removed
   │   ──promotion, already booked───► removed
   ├──promotion (place freed)────────► promoted (+ booking source = waitlist)
   └──cut-off / class start (job)────► expired
```
Terminal states set `ended_at`. Re-joining creates a new row at the end of the queue. A member who has no credits when their promotion is due is skipped and stays `waiting` (US-125).

### Credit ledger (US-125, ADR-017)
- `credit_balance.balance` always equals `SUM(credit_transaction.delta)` for the member. Both change in the same transaction. Tests assert this with `expectLedgerConsistent`, and operations use the reconciliation query in US-125.
- **Debit:** `UPDATE credit_balance SET balance = balance - 1 WHERE member_id = :m AND balance >= 1 RETURNING balance`. If it matches 0 rows → `409 NO_CREDITS` and the booking transaction rolls back. This runs in `bookClass` after the insert and in `promoteNext` after `insertBooking`, but only for members where `usesCredits(user)` is true (`role = member AND member_type = regular`, assumption).
- **Return:** the `BookingCancelled` subscriber returns 1 credit only if the booking has a `booking` debit row and no return row yet. `cause` decides the reason: `member_cancelled` → `cancellation_refund`, `class_cancelled` → `class_cancelled_refund`.
- **Import (US-136):** one `migration` row per member plus the balance row (`credit_transaction_migration_uq`).
- The ledger is append-only in code. Manual adjustments have a reason but no endpoint yet.

### Schedule read path (US-121, extended by US-122/US-126/US-127)
`GET /api/classes` runs one query: `gym_class` ⋈ `club` ⟕ `app_user` (instructor) ⟕ aggregated active-booking count ⟕ caller's active booking ⟕ LATERAL caller's `waiting` entry with position. Filters `start_at > now AND start_at <= now + 14 d`, orders by `start_at, name, id`; ≤ ~560 rows. `instructor_id` is selected for `canCancel` but not returned.

### "My bookings" read path (US-123)
`GET /api/me/bookings` runs one query on `booking` (`member_id = :me`, index `booking_member_idx`) ⋈ `gym_class` ⋈ `club` ⟕ the `booking` debit ledger row (US-125). `upcoming` = active bookings on classes not yet ended (start time ascending). `past` = every status on classes that have ended (start time descending). Paged with `limit` ≤ 100 / `offset`.

### Other data rules
- **Attendance (ADR-012):** only `confirmed` bookings carry attendance; `attendance_recorded_by IS NULL` with a timestamp = set by the auto no-show sweep. "Not recorded" in the report = `confirmed` and `unknown`.
- **No-show blocks (ADR-013):** a no-show counts towards a block only while `no_show_block_id IS NULL`.

Migrations: Kysely Migrator, `api/migrations/NNNN_snake_case.ts`, each with a working `down`. `npm run db:migrate` runs in CI against the test DB on every change.

## 5. API inventory

All business routes use the prefix **`/api`**. Only `/health` and `/webhooks/stripe` are unprefixed (ADR-008).

| Method & route | Roles | Story |
|---|---|---|
| `GET /health` | public | TK-119 |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me` | public / authenticated (`bookingBlock` for members US-130; `creditBalance` US-125) | US-118 |
| `GET /api/clubs` | authenticated | US-117 |
| `GET /api/clubs/:clubId/instructors` | instructor, club_manager (own club) | US-120 |
| `POST /api/classes` | instructor, club_manager (own club) | US-120 |
| `POST /api/classes/:id/cancel` | club_manager (own club); instructor (own club, classes they lead — assumption) | US-126 |
| `GET /api/classes?clubId=&from=&to=` | authenticated | US-121 (+US-122, US-126, US-127) |
| `POST /api/classes/:classId/bookings` | member (self) — 201 regular / 202 drop-in; debits 1 credit for regular members | US-122, US-125 |
| `GET /api/classes/:classId/bookings` | instructor, club_manager (own club) — roster | US-123 |
| `GET /api/me/bookings?period=upcoming\|past&limit=&offset=` | member (own only) | US-123 (+US-127) |
| `GET /api/bookings/:id` | owner member; staff of the class's club | US-123 |
| `POST /api/bookings/:id/cancel` | member (own only); returns the credit, triggers promotion | US-124, US-125, US-128 |
| `POST /api/classes/:classId/waitlist`, `DELETE /api/waitlist/:entryId` | member | US-127 (+US-125 credit check) |
| `GET /api/classes/:classId/attendance`, `PUT /api/classes/:classId/attendance` | instructor, club_manager (own club); after the window only club_manager | US-129 |
| `POST /webhooks/stripe` | Stripe (signature-verified) | US-132 |
| `GET /api/reports/weekly-attendance?clubId=&week=` | club_manager (own club) | US-137 |

### Class contracts (US-120, US-126)
- `POST /api/classes` body `{ clubId, name, startAt (ISO with offset), durationMinutes, capacity, instructorId? }` → 201 `ClassDto` + `Location`. Errors 400 `VALIDATION_ERROR` (per-field messages in US-120), 401, 403 (role, club scope).
- `ClassDto`: `{ id, clubId, name, startAt, durationMinutes, capacity, freePlaces, status, instructorId, instructorName, createdBy, createdAt, cancelledAt, cancellationReason }` (staff-facing).
- `POST /api/classes/:id/cancel` body `{ reason? (≤ 500) }` → 200 `ClassCancellationDto` = `ClassDto` + `{ bookingsCancelled, waitlistEntriesRemoved }`. Errors 400, 401, 403, 404 `CLASS_NOT_FOUND`, 409 `CLASS_ALREADY_CANCELLED`, 409 `CLASS_NOT_CANCELLABLE`.

### `GET /api/classes` contract (US-121)
- Query: `clubId` (UUID, optional), `from`/`to` (ISO 8601 with offset, optional; they only narrow `(now, now + 14 d]`).
- 200: `{ from, to, items: [{ id, clubId, clubName, clubTimezone, name, startAt, durationMinutes, capacity, freePlaces, status, instructorName, myBookingStatus, myBooking, myWaitlist, canCancel }] }`. `myBookingStatus` ∈ `none | confirmed | pending_payment | waiting`; `myBooking` = `{ id, status } | null` (US-122); `myWaitlist` = `{ entryId, position } | null` (US-127); `canCancel` (US-126, always false for members). Header `Cache-Control: no-store`.
- Errors: 400 `VALIDATION_ERROR`, 401 `UNAUTHENTICATED`, 404 `CLUB_NOT_FOUND`.

### Booking contracts (US-122–US-125)
- `POST /api/classes/:classId/bookings` (no body) → 201 `BookingDto` + `Location` (regular) / 202 `BookingDto` `pending_payment` (drop-in). Check order: 404 `CLASS_NOT_FOUND` → 409 `CLASS_NOT_BOOKABLE` → 409 `BOOKING_BLOCKED` (US-130) → 409 `ALREADY_BOOKED` → 409 `CLASS_FULL` → 409 `NO_CREDITS` (US-125).
- `GET /api/me/bookings` → `{ items: BookingDto[], total }`; `GET /api/bookings/:id` → `BookingDto` (+ `memberName` for staff); `GET /api/classes/:classId/bookings` → `{ classId, capacity, freePlaces, items: [{ bookingId, memberId, memberName, status, attendance, bookedAt }] }` (no e-mail).
- `POST /api/bookings/:id/cancel` (no body) → 200 `BookingDto`. Errors 404 `BOOKING_NOT_FOUND`, 409 `BOOKING_ALREADY_CANCELLED`, `CLASS_CANCELLED`, `CANCELLATION_WINDOW_CLOSED`; 403 for staff.
- `BookingDto`: `id, type: "booking", memberId, classId, className, clubId, clubName, startAt, durationMinutes, classStatus, status, attendance, source, bookedAt, cancelledAt, cancelDeadline, canCancel, creditUsed` (+ `memberName` for staff). `cancelDeadline = startAt − BOOKING_CANCEL_CUTOFF_MINUTES`; `canCancel` = viewer is the owner AND active AND `classStatus = scheduled` AND `now <= cancelDeadline`.
- `GET /api/me` adds `creditBalance: number | null` (regular member → balance, 0 if no row; drop-in and staff → `null`).

### Waiting-list contract (US-127)
- `POST /api/classes/:classId/waitlist` (no body) → 201 `WaitlistEntryDto` `{ id, type: "waitlist", classId, className, clubId, clubName, startAt, durationMinutes, classStatus, status, position, joinedAt, promotedBookingId }`.
- `DELETE /api/waitlist/:entryId` → 204.
- Errors: 400; 401; 403 `FORBIDDEN`; 404 `CLASS_NOT_FOUND`, `WAITLIST_ENTRY_NOT_FOUND`; 409 `CLASS_NOT_BOOKABLE`, `WAITLIST_CLOSED`, `ALREADY_BOOKED`, `ALREADY_ON_WAITLIST`, `CLASS_NOT_FULL`, `WAITLIST_ENTRY_NOT_ACTIVE`, `BOOKING_BLOCKED` (US-130), `NO_CREDITS` (US-125).

### Internal contracts
- **Promotion (US-128):** `promoteNext(trx, classId, ctx): Promise<Promotion[]>`, called inside the transaction that frees a place (booking cancel US-124, payment declined/expired US-132/US-133). The caller calls `notifyPromotions` after commit. Idempotent; returns `[]` when nothing to do (incl. non-`scheduled` classes). Class cancellation does **not** call it. Eligibility includes the credit check (US-125): a credit user with balance 0 is skipped and stays `waiting`.
- **Domain events (ADR-009):** `BookingCancelled { bookingId, classId, memberId, previousStatus, cancelledAt, cause: 'member_cancelled' | 'class_cancelled' }`. US-124 defines the type with both causes and publishes `member_cancelled`; US-126 publishes `class_cancelled`. Subscribers: credit return (US-125, registered in `buildApp`), refunds (US-134). `AttendanceRecorded { bookingId, memberId, classId, classStartAt, previousAttendance, attendance, recordedBy|null, recordedAt }` (US-129 → US-130).
- **Credits (US-125):** `consumeCreditForBooking(trx, { memberId, bookingId, now })` (throws `NO_CREDITS`), `hasCreditForUpdate(trx, memberId)`, `assertHasCredit(trx, memberId)`, `returnCreditForCancelledBooking(trx, event)`. The import CLI (US-136) writes `migration` rows through the same repository.
- **Notifications (after commit):** `waitlist_promoted { memberId, bookingId, classId }` (US-128); `class_cancelled { memberId, classId, bookingId|null, waitlistEntryId|null }` (US-126).

### Error envelope
Flat body (ADR-008): `{ "code": "<UPPER_SNAKE>", "message": "<plain language>", "fieldErrors"?: [{ "field", "message" }] }`. `fieldErrors` appears only with `VALIDATION_ERROR`. Status codes: 400 validation · 401 unauthenticated · 403 role or club scope only · 404 not found (also non-owned resources, ADR-011) · 409 business conflict (including the cancellation window, `BOOKING_BLOCKED` and `NO_CREDITS`) · 500 unexpected · 503 dependency unavailable. `DomainError` and the handler live in `api/src/shared/errors.ts` (US-118).

| Code | Status | Message | Story |
|---|---|---|---|
| `CLASS_NOT_FOUND` | 404 | "This class does not exist." | US-122, US-126 |
| `CLASS_NOT_BOOKABLE` | 409 | "This class can no longer be booked." | US-122, US-127 |
| `CLASS_ALREADY_CANCELLED` | 409 | "This class has already been cancelled." | US-126 |
| `CLASS_NOT_CANCELLABLE` | 409 | "This class has already started and can no longer be cancelled." | US-126 |
| `ALREADY_BOOKED` | 409 | "You have already booked this class." | US-122 |
| `CLASS_FULL` | 409 | "This class is full. You can join the waiting list." | US-122 |
| `NO_CREDITS` | 409 | "You have no class credits left." | US-125 |
| `BOOKING_NOT_FOUND` | 404 | "This booking does not exist." | US-123 |
| `BOOKING_ALREADY_CANCELLED` | 409 | "This booking is already cancelled." | US-124 |
| `CLASS_CANCELLED` | 409 | "This class has been cancelled." | US-124 |
| `CANCELLATION_WINDOW_CLOSED` | 409 | "Bookings can only be cancelled up to {2 hours} before the class starts." | US-124 |
| `BOOKING_BLOCKED` | 409 | "You can't book classes until {date} because of {N} missed classes." | US-130 |
| `ATTENDANCE_NOT_OPEN` | 409 | "Attendance can be recorded once the class has started." | US-129 |
| `ATTENDANCE_CLOSED` | 409 | "Attendance for this class can no longer be changed. Ask your club manager to correct it." | US-129 |
| `FORBIDDEN` | 403 | "Only instructors and club managers can manage classes." / "You can only manage classes for your own club." / "You can only cancel classes that you lead." / "Only members can book classes." / "Only members can view their bookings." / "Only members can cancel their own bookings." | US-120, US-122–US-124, US-126 |

## 6. Security model

- Role-based authorisation on every route (`requireAuth`, `requireRole` as `preValidation` hooks, before body validation). Authentication method: open question (US-118).
- **Member-owned resources** (bookings, waiting-list entries, payments, credit balance): ownership enforced in SQL by `api/src/modules/bookings/access.ts` (bookings, entries, payments) and by the session member id (credits). A foreign resource returns the same 404 as a non-existent one (ADR-011).
- **Club scope:** staff may only manage or read classes and bookings of their own club (`app_user.club_id = gym_class.club_id`). 403 on another club's class, 404 on a single booking of another club. Rosters return member names only, never e-mail addresses.
- **Class management (US-120, US-126):** creating requires `clubId = user.clubId`; instructors always lead the classes they create. Cancelling: club manager any class of own club; instructor only classes with `instructor_id = user.id` (assumption, `classes/policy.ts`). Server-set fields (`status`, `created_by`, `cancelled_by`) come from the session.
- **Bookings (US-122–US-124):** the member id for booking and cancelling always comes from the session. Staff cannot create, change or cancel members' bookings.
- **Credits (US-125):** the balance is visible only to the member themself (`GET /api/me`). No endpoint accepts a balance or a member id. Credits change only inside server transactions (booking, promotion, cancellation, import), and the ledger is append-only in code.
- **Attendance (US-129):** any instructor or the club manager of the class's club during the window; afterwards only the club manager.
- **No-show blocks (US-130):** visible only to the member themself.
- `bookings.access.test.ts` is the regression net: one row per route × actor (owner, other member, staff own club, staff other club, anonymous; for class cancel also instructor leading / not leading).
- Notification payloads and logs contain ids only, no personal data.
- Secrets come only from environment variables or the host's secret store; never in code, tests, logs or CI. `.env` is git-ignored and `.env.example` lists names only.
- CI: `permissions: contents: read`, `pull_request` trigger only, no repository secrets.
- Integration tests refuse to run against any database whose name does not end in `_test`.

## 7. Integration inventory
| System | Direction | Mechanism | Status |
|---|---|---|---|
| Stripe Payments API | outbound | PaymentIntents via official `stripe` SDK, idempotency keys per attempt; refunds `refund-{bookingId}` (US-134) | EP-104, open questions (price, retry policy, refunds) |
| Stripe webhooks | inbound | `POST /webhooks/stripe`, signature verification | EP-104 |
| Legacy member data | inbound, one-off | CLI import script, idempotent upsert by dedup key; credits as `migration` ledger rows (US-136) | EP-105, format and dedup key open |
| Email/notifications | outbound | `Notifier` port, `LogNotifier` until a channel is decided. Events: `waitlist_promoted` (US-128), `class_cancelled` (US-126) | channel open question |
| GitHub Actions | CI | `.github/workflows/ci.yml` | TK-119 |

## 8. Delivery pipeline and quality checks (FT-108)

- **Workflow `CI` / job `checks`** (TK-119) runs on every pull request and on every push to `main`: `npm ci` → `format:check` → `lint` (0 warnings) → `typecheck` → `db:migrate` (PostgreSQL 16 service, DB `fithub_test`) → `test` (unit + integration, coverage artifact) → `build`. Timeout 15 min (target < 5 min). `concurrency` cancels superseded runs.
- `npm run ci` runs the same chain locally.
- `main` is protected: `CI / checks` required (post-deploy step in TK-119).
- **Test environment:** `TZ=UTC`, `NODE_ENV=test`, `JOBS_ENABLED=false`, `DATABASE_URL=…/fithub_test`; no secrets, no `STRIPE_*`. Jobs are tested by calling their run function directly.
- **Test layout:** `api/vitest.workspace.ts` projects `unit` (`test/unit/**`) and `integration` (`test/integration/**`, serial, real PostgreSQL). `web` uses jsdom + Testing Library.
- **Test-DB lifecycle (ADR-014):** global setup enforces the `_test` name guard, then migrates to latest; `resetDb()` before each integration test.
- **Env loading:** Node's `--env-file-if-exists=../.env`; no `dotenv`.
- Not yet in place: coverage gate, E2E browser tests, CD, dependency scanning. **Until TK-119 is merged the repository has no checks at all** (today it contains only `docs/` and `.gitignore`).

### Configuration inventory (selected)
| Variable | Default | Story |
|---|---|---|
| `DATABASE_URL` | none (required); integration tests default to `postgres://fithub:fithub@localhost:5432/fithub_test` | TK-119 |
| `PORT` | `3000` | TK-119 |
| `NODE_ENV` | `development` (`test` in CI) | TK-119 |
| `LOG_LEVEL` | `info` | TK-119 |
| `TZ` | system (`UTC` in CI and Vitest) | TK-119 |
| `BOOKING_CANCEL_CUTOFF_MINUTES` | `120` (integer 0–1440; invalid → startup fails) | US-124 |
| `WAITLIST_PROMOTION_CUTOFF_MINUTES` | `0` (assumption) | US-128 (read by US-127) |
| `WAITLIST_JOB_INTERVAL_SECONDS` | `60` | US-128 |
| `JOBS_ENABLED` | `true` (`false` in tests) | US-128 / US-133 |
| `ATTENDANCE_*`, `NO_SHOW_*` | see US-129 / US-130 | US-129, US-130 |

FT-109 (US-120, US-126) adds no configuration, and neither do US-123 and US-125.

## 9. Key decisions (ADR)

**ADR-001 – Node.js 22 + TypeScript (strict, ESM)**
· Reason: the repo's `.gitignore` targets Node; one language for SPA and API; first-class Stripe SDK; strict types catch status/enum mistakes.
· Alternatives: Python/Django, Java/Spring.
· Consequences: npm-based tooling; Node 22 LTS pinned via `.nvmrc` (`engines` `>=22.9 <23`).

**ADR-002 – Single repo, npm workspaces `api` and `web`**
· Reason: one PR changes API and UI together; one CI pipeline; no extra tool.
· Alternatives: separate repos, Turborepo.
· Consequences: root scripts fan out with `--workspaces`; a shared-types workspace only if needed.

**ADR-003 – Fastify 5 + zod for the API**
· Reason: TypeScript-first, schema validation at the boundary, `app.inject()` for fast HTTP tests.
· Alternatives: Express, NestJS, Next.js API routes.
· Consequences: every route declares zod schemas; `buildApp` stays a pure factory. (US-120's first draft named Express/Knex/`apps/`; realigned.)

**ADR-004 – PostgreSQL 16 with Kysely and Kysely Migrator**
· Reason: capacity must never be exceeded under concurrency, which needs explicit transactions, row locks and partial unique indexes — Kysely expresses these with full typing.
· Alternatives: Prisma, TypeORM, raw `pg`.
· Consequences: table types in `api/src/db/schema.ts`, updated with each migration.

**ADR-005 – React + Vite SPA**
· Reason: simple client-rendered app, fast builds, same test runner.
· Alternatives: Next.js, server-rendered templates.
· Consequences: CORS or same-origin hosting decided with deployment; Vite proxies `/api` in dev.

**ADR-006 – Vitest, ESLint, Prettier and GitHub Actions with a Postgres service container**
· Reason: one test runner; real PostgreSQL proves locking and constraints; steps are portable npm scripts.
· Alternatives: Jest, Testcontainers, SQLite.
· Consequences: serial integration files, reset per test, `_test` guard (ADR-014).

**ADR-007 – In-process DB-backed job polling for background work (proposed)**
· Reason: low volume; no Redis/queue; the `job` table doubles as the outbox.
· Alternatives: BullMQ + Redis, cloud scheduler.
· Consequences: confirmed when US-133 is refined; jobs idempotent with `FOR UPDATE SKIP LOCKED`.

**ADR-008 – API and schema conventions: `/api` prefix, flat error body, singular table names, text + CHECK enums**
· Reason: US-117/US-118/US-120 already use `/api/...`, `{ code, message, fieldErrors? }`, `club`/`app_user`/`gym_class` (`user` is reserved in PostgreSQL, `class` is a TS keyword). `text` + CHECK is easier to extend and roll back.
· Alternatives: nested `{ error: {...} }` body and plural tables (first draft); PostgreSQL enums.
· Consequences: business-rule rejections use 409; 403 only for role or club scope; `/health` stays outside `/api`.

**ADR-009 – Side effects through in-transaction domain events**
· Reason: cancelling a booking must atomically free the place, promote, return credits and enqueue refunds; DB-only handlers run inside the transaction, I/O handlers only enqueue a `job` row.
· Alternatives: direct cross-module calls, after-commit events, a broker.
· Consequences: injected `DomainEventBus`; subscribers registered in `buildApp` from `<module>/handlers.ts`; a handler failure rolls back the write; handlers fast and idempotent.

**ADR-010 – Derived free places with a class row lock and a fixed lock order**
· Reason: no drifting counter; cheap count at ≤ ~40 places; `gym_class` first, child rows second avoids deadlocks.
· Alternatives: stored `booked_count`, SERIALIZABLE with retries, advisory locks.
· Consequences: partial unique index as second line of defence; order extended by ADR-013 (`app_user` last) and ADR-017 (`credit_balance` before `app_user`).

**ADR-011 – Ownership enforced in SQL; foreign resources return 404**
· Reason: no leaks through a forgotten post-fetch check; 404 does not reveal existence.
· Alternatives: fetch-then-check, PostgreSQL RLS.
· Consequences: all access through `bookings/access.ts`; the access matrix test must grow with every new route.

**ADR-012 – Attendance captured by staff on a roster, stored on `booking`, with a time window and opt-in auto no-show**
· Reason: no hardware; reuses club scope; one row per member and class; window limits late edits; auto no-show off by default.
· Alternatives: separate `attendance` table, member self check-in/QR, auto no-show always on.
· Consequences: only `confirmed` bookings carry attendance; `AttendanceRecorded` in the same transaction; PO confirmation pending (US-129).

**ADR-013 – No-show block counted from uncounted no-shows, decided per member under a row lock**
· Reason: `booking.no_show_block_id` records which no-shows were used; locking `app_user` serialises decisions per member; values configurable.
· Alternatives: count since last block, stored counter, nightly batch.
· Consequences: `assertNotBlocked` in booking and waiting-list join (409 `BOOKING_BLOCKED`).

**ADR-014 – Test databases guard and migrate themselves; env files loaded by Node natively**
· Reason: a clean clone must not hit the dev DB; `globalSetup` guards `_test` and migrates; `--env-file-if-exists` instead of `dotenv`.
· Alternatives: separate `db:migrate:test`, `dotenv`, Testcontainers.
· Consequences: Node ≥ 22.9; migrations re-runnable.

**ADR-015 – `date-fns-tz` for club-local → UTC conversion in the web form (US-120)**
· Reason: staff enter date and time in the club's time zone; converting to UTC correctly across DST changes needs a time-zone database lookup that `Intl.DateTimeFormat` can format but not parse. `fromZonedTime` does exactly this and is small and tree-shakeable.
· Alternatives: hand-written `Intl` offset trick (error-prone around DST), Luxon/Day.js (larger or plugin-based), sending local time + time zone to the API.
· Consequences: new web dependencies `date-fns` + `date-fns-tz`; the API keeps accepting only ISO 8601 with offset; `time.test.ts` covers a DST-change date.

**ADR-016 – Class cancellation in one transaction, cause carried on `BookingCancelled`, no promotion (US-126)**
· Reason: a cancelled class must not leave active bookings or waiting entries behind, and credit/refund handlers must know the booking was cancelled by the club (assumed full return, no penalty). Reusing `BookingCancelled` with a `cause` field lets US-125/US-134 handle both member and class cancellations with one subscriber; cancelling under the class lock makes concurrent bookings, joins and promotions see `cancelled`.
· Alternatives: a separate `ClassCancelled` event (two code paths in every consumer); a `cancellation_cause` column on `booking`; soft cancel with an async cleanup job.
· Consequences: `BookingCancelled.cause` is required and defined by US-124 with both values (US-124 publishes `member_cancelled`, US-126 `class_cancelled`; payment-failure causes may be added by US-132/US-133 and must be mapped explicitly by every subscriber). One event per booking (≤ ~40) inside the transaction. Permission rule isolated in `classes/policy.ts` pending PO confirmation.

**ADR-017 – Class credits as a balance row plus an append-only ledger, in their own `credits` module (US-125)**
· Reason: the balance must never go negative under concurrent bookings and must be auditable and reconcilable after the import (US-136). A conditional `UPDATE … WHERE balance >= 1` on one row per member is atomic without extra locks. The ledger records every movement with its reason and booking. The debit row itself answers "did this booking use a credit?", so the return handler needs no extra column on `booking`. Unique partial indexes make debit, return and import idempotent. A separate module is used because bookings, the waiting list and the import CLI all use it, and it owns its tables. This deviates from the earlier module map, which placed credits inside `bookings`.
· Alternatives: a balance column on `app_user` (mixes concerns, and `app_user` is last in the lock order and used for block decisions); balance derived only from `SUM(delta)` (needs an explicit per-member lock on every booking and is slower); a `credit_used` flag on `booking` (duplicates the ledger); credits inside the bookings module (import CLI and waitlist would depend on bookings internals).
· Consequences: two writes per credit movement in one transaction; a reconciliation query for tests and operations; lock order gains `credit_balance` before `app_user`; "who uses credits" is isolated in `credits/policy.ts` (`usesCredits`) so the open questions (unlimited memberships) change one function, or add a membership attribute later.

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| US-118 (auth) blocked by open questions; US-120…US-126 need `request.user` and a test sign-in helper | High | High | Build the role guard and a test auth helper with a stub session first; only the sign-in method waits |
| US-121 tech spec still shows the nested error envelope in its error section | Med | Low | ADR-008 and §5 are authoritative (flat body); planner informed to align during implementation |
| Drop-in bookings stay `pending_payment` and hold places if US-122 is released before US-132/US-133 | Med | Med | Release constraint on US-122; hold expiry defined in US-133 |
| Class cancelled while drop-in payments are live but refunds (US-134) are not → paid members not refunded | Med | High | Pre-deploy step on US-126: manual refunds in Stripe; deliver US-134 together with US-132 |
| Class cancellation assumptions (instructor scope, full refund/credit, no reinstating) are wrong | Med | Med | Rules isolated in `classes/policy.ts` and in the US-125/US-134 handlers; question recorded for the PO |
| Members of a cancelled class are not actually informed (log-only notifier) | High | Med | "Cancelled" badge in the schedule and `classStatus` in "My bookings"; channel question open; real notifier is a separate story |
| **Credit semantics wrong** (unlimited memberships exist, card fallback at 0 credits, waiting-list rules) | Med | High | US-125 kept out of sprint until the PO answers; rules isolated in `credits/policy.ts`; ledger design works for every answer |
| **No way to top up credits after go-live** → regular members eventually cannot book | High | High | Open question for the PO; a top-up story (front desk or online) is needed before go-live; the `manual_adjustment` reason is already in the ledger |
| Credit enforcement live before the credit import (US-136) → every regular member gets `NO_CREDITS` | Med | High | Post-deploy step on US-125: run the import at cutover before members get access |
| Deadlock when a cancellation returns member A's credit while promoting member B, and a parallel transaction does the opposite | Low | Low | PostgreSQL aborts one transaction (500, the member retries); if seen in logs, add one retry on SQLSTATE `40P01` around the cancel transaction |
| Repository is not on GitHub, so the workflow file does not run | Low–Med | Low | Steps are npm scripts (`npm run ci`); open question on TK-119 |
| Branch protection not enabled, so red builds get merged | Med | High | Post-deploy manual step on TK-119 |
| Concurrent bookings exceed capacity | Med | High | Class row lock + partial unique index (ADR-010), parallel integration tests |
| Deadlocks between book, cancel, class cancel, promotion, attendance and block decisions | Low | Med | Fixed lock order `gym_class` → child rows by `member_id` → `credit_balance` → `app_user` |
| A slow or failing event handler blocks cancellations | Low | Med | DB-only handlers, I/O to the outbox (ADR-009); rollback tests |
| A new member-owned or club-scoped route added without an access check | Med | High | Central `access.ts`/`policy.ts` and mandatory access-matrix rows (ADR-011) |
| Flaky integration tests from shared DB state | Med | Med | Serial files, `resetDb()`, `TZ=UTC`, injected clock |
| Integration tests run against a real database | Low | High | `_test` name guard |
| Duplicate Stripe charges or refunds on retry | Med | High | Idempotency keys + unique `payment.idempotency_key` (US-133), `refund-{bookingId}` (US-134) |
| Instructors forget to record attendance | Med | High | Auto no-show off by default; report shows "not recorded"; manager corrections |
| No-show threshold/window go live with provisional values | Med | Med | Pre-deploy step on US-130; configuration only |
| Many open business questions (no-show, credits, auth, migration source, cancellation effects) | High | Med | Stories stay in "Requires additional information" or ship with explicit, isolated assumptions |
| Time zone assumption wrong | Low | Med | UTC storage, club time zone as a club attribute (US-117), DST tests (ADR-015) |

## 11. Open questions (architecture-relevant)

- Repository hosting and admin for branch protection (TK-119).
- Authentication method and account creation (US-118).
- Notification channel (US-126, US-128; also block notifications for US-130).
- Hosting/deployment target (CORS, secrets store, CD).
- Can members book classes at any club, or only their home club? US-122 assumes any club.
- How long a drop-in `pending_payment` hold lasts (US-133).
- Attendance capture details (US-129); no-show threshold and window (US-130).
- **Class cancellation (US-126):** may instructors cancel any class of their club or only those they lead (built: only those they lead)? Full credit return/refund without penalty? Cancellation until start only? Final (no reinstating)?
- **Class credits (US-125, blocking):** does every regular booking cost 1 credit (no unlimited memberships)? Refuse at 0 credits or fall back to card payment? Return on in-time cancellation and class cancellation, never on no-show? Credit needed to join the waiting list? One balance valid at all clubs? Do credits expire?
- **Credit top-up after go-live (US-125, blocking for go-live):** front desk, online purchase or monthly allocation? No story exists yet.
