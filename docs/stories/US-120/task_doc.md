# US-120: Create a class with validation
**Status:** Ready for UAT · **Category:** development · **Points:** 5 · **Sprint:** not set

## Summary
Instructors and club managers can now publish a class (name, start time, duration, max places) for their own club in the app. Invalid input is rejected with a message next to each field, and new classes start as `scheduled` with free places equal to capacity.

## What was built
- `POST /api/classes`: creates a class. Role guard runs before body validation; club scope and instructor rules are enforced in the service.
- `GET /api/clubs/:clubId/instructors`: lists the instructors of the caller's club (id and full name only).
- Migration `0003_create_gym_class`: `gym_class` table with CHECK constraints (`gym_class_name_ck`, `gym_class_duration_ck`, `gym_class_capacity_ck`, `gym_class_status_ck`) and indexes `gym_class_club_start_idx`, `gym_class_instructor_idx`.
- `api/src/modules/classes/*` (`routes.ts`, `service.ts`, `repository.ts`, `dto.ts`, `errors.ts`, `table.ts`): create flow, `ClassDto`, message table.
- `api/src/shared/errors.ts`: one `fieldErrors` entry per field (first zod issue wins), top-level message "Please correct the highlighted fields.", and a "not valid JSON" message for malformed bodies.
- `api/test/helpers/factories.ts`: `createClass` (takes `createdBy`, defaults to a new club manager).
- Web: `NewClassPage` at `/classes/new`, "New class" link on the schedule page for staff, `clubLocalToUtc` in `web/src/lib/time.ts`, `createClass` and `getInstructors` API helpers.

## How it works
- **AC 1 – Valid class:** a valid request returns `201` with `Location: /api/classes/{id}`. The row has `status = scheduled`, `start_at` in UTC, and `instructor_id = created_by` = the instructor. `freePlaces` equals capacity.
- **AC 2–4 – Validation:** each invalid field returns one message: name missing/blank, name over 100 characters, capacity 0 or not a whole number, start time missing/invalid/not in the future, duration not a whole number ≥ 1. All errors of one request are returned together.
- **AC 5 – Roles:** members get `403 FORBIDDEN` before validation. Anonymous callers get `401 UNAUTHENTICATED`.
- **AC 6 – Club scope:** a request for another club (or an unknown club) returns `403`. Nothing is stored.
- **AC 7 – Instructor:** an instructor always becomes the instructor of the class they create; another user's id returns `400`. A club manager may pick an instructor of the same club or leave it empty; other ids return `400`.
- **AC 8 – Form:** the form shows field messages next to each field and moves focus to the first invalid field. A valid submit redirects to `/schedule?clubId=…` with "Class created." Members do not see the link and get "You are not allowed to create classes." on the URL.

## How to test
**Automated:** `npm run typecheck && npm run lint && npm run test:unit -w api && npm test -w web && npm run build`.
**Integration (not yet run):** `npm run test:integration -w api -- classes.create clubs.instructors` against `fithub_test`.

- **AC 1:** Sign in as an instructor, create "Spinning 45" tomorrow 18:00, 45 min, 20 places. **Verify:** 201, `Location` header, `freePlaces` = 20, row with `status = scheduled`.
- **AC 2:** Submit name "   ". **Verify:** 400, "A class must have a name."; no new row.
- **AC 3:** Submit max places 0. **Verify:** 400, "A class must have at least one place."
- **AC 4:** Submit a past start time, duration 0 and places 2.5. **Verify:** 400 with three field errors.
- **AC 5:** Call as a member, then without a session. **Verify:** 403 "Only instructors and club managers can manage classes."; 401 "Please sign in to continue."
- **AC 6:** As club A staff, post club B's id. **Verify:** 403 "You can only manage classes for your own club."
- **AC 7:** As club manager, pick an instructor of your club (201), then a member's id (400 "Choose an instructor from this club."). As instructor, send another user's id. **Verify:** 400 "You can only create classes that you lead yourself."
- **AC 8:** Open "New class" as staff, submit empty, then valid. **Verify:** messages next to fields, focus on first error; after success, redirect with "Class created."

## Deployment notes
- **Migration:** run `npm run db:migrate -w api` (creates `gym_class` in migration 0003).
- **Earlier draft of 0003:** if a database already ran the earlier minimal 0003, drop `gym_class` or migrate down/up first (the shape changed).
- **Verification:** `\d gym_class` shows the four CHECK constraints and both indexes.
- **Configuration:** none new (uses `DATABASE_URL` and session settings).

## Known limitations
- Integration tests were not run before hand-over. The error-handler changes (one `fieldErrors` entry per field, malformed JSON message, new top-level message) are unverified against a real database and must be run before release.
- Recurring classes, editing after creation, room clashes and instructor double-booking checks are out of scope.
- `freePlaces` is computed with 0 bookings until the booking table (US-122) exists.
- No idempotency key; the UI prevents double submits.
