# US-121: View the two-week class schedule filtered by club
**Status:** Ready for UAT · **Category:** development · **Points:** 5 · **Sprint:** not recorded

## Summary
Members can see the classes of a club for the next 14 days, with free places and their own booking status. The schedule is read-only, shows cancelled classes with a "Cancelled" badge, and is shown in the club's local time zone. The `/schedule` route, the `/` redirect and the header link are not on this branch and must be added when US-118 and US-120 merge.

## What was built
- `api/src/modules/classes/routes.ts`: `classRoutes(deps)` plugin, `GET /classes` (mounted under `/api`), zod query and response validation, `Cache-Control: no-store`.
- `api/src/modules/classes/schedule.dto.ts`: `scheduleQuerySchema`, `scheduleItemSchema`, `scheduleResponseSchema`, `ScheduleRow`, `toScheduleItem`.
- `api/src/modules/classes/service.ts`: `getSchedule`, resolves the window and maps rows to items.
- `api/src/modules/classes/repository.ts`: `findSchedule`, one SQL statement that computes free places and the member's own booking.
- `api/src/modules/classes/schedule-window.ts`: `SCHEDULE_WINDOW_DAYS` (14), `computeWindow` (clamps `from`/`to` to the window).
- `api/src/modules/clubs/errors.ts`: `clubNotFound` (`CLUB_NOT_FOUND`, 404).
- `web/src/pages/SchedulePage.tsx`: club selector, URL sync (`?clubId`), loading, error with "Try again", empty and no-clubs states.
- `web/src/components/ClassCard.tsx`: card with time, free places, status badge and action slot (Book button is delivered by US-122).
- `web/src/api/classes.ts` (`getSchedule`), `web/src/api/clubs.ts` (`listClubs`).
- `web/src/lib/time.ts`: `formatClubTime`, `clubDateKey`, `formatClubDay`.
- Tests: `api/test/unit/schedule-window.test.ts`, `api/test/integration/classes.schedule.test.ts`, `web/test/SchedulePage.test.tsx`, `web/test/ClassCard.test.tsx`, `web/test/time.test.ts`.

## How it works
- **AC 1, window:** only classes with `startAt` later than now and no later than now + 14 days are returned.
- **AC 2, club filter:** `clubId` is optional. With it, only that club's classes are returned; without it, all clubs.
- **AC 3, free places:** `freePlaces` = max(0, capacity − bookings with status `confirmed` or `pending_payment`). Cancelled bookings are not counted. The card shows "Full – join waiting list" and no Book button at 0.
- **AC 4, own status:** members see `myBookingStatus`, `myBooking` for their own booking only. Instructors and club managers always get `none`, `myBooking` = `null`, `myWaitlist` = `null`. `myWaitlist` is `null` until US-127.
- **AC 5, invalid club:** unknown UUID → 404 `CLUB_NOT_FOUND`; non-UUID → 400 `VALIDATION_ERROR` on `clubId`.
- **AC 6, empty:** no classes in the window → 200 with `items: []`; the UI shows "No classes scheduled in the next two weeks."
- **AC 7, cancelled:** shown with `status` = `cancelled`, a "Cancelled" badge and no action button.
- **AC 8, order and time:** sorted by `startAt`, then name, then id. The UI groups by the club's local date and shows times in `club.timezone`.
- **AC 9, period:** optional `from`/`to` narrow the window; values outside are clamped and echoed. Empty result after clamping → 200 `items: []`. Invalid date-time → 400 on `from`/`to`. `from` ≥ `to` → 400 on `to`.
- **AC 10, access:** no session → 401 `UNAUTHENTICATED`, also for an invalid query (the auth hook runs first). Responses carry `Cache-Control: no-store` and never include `instructorId`, `createdBy`, `memberId` or other members' ids.
- **AC 11, UI:** club selector is preselected from `?clubId`, then the home club (`me.clubId`), then the first club by name. Changing the club updates the URL and reloads. States: "Loading schedule…", error with "Try again", and "There are no clubs to show a schedule for yet." when the club list is empty (selector disabled, no schedule request).

## How to test
Automated (no checks are configured yet; nothing has been executed):
- `docker compose up -d db && npm run db:migrate && npm test -w api -- schedule`
- `npm test -w web -- Schedule ClassCard time`

Manual checks:
- **AC 1:** Create classes at −1 day, −1 min, +0, +2 h, +10 d, +14 d, +20 d (fixed clock). **Verify:** `GET /api/classes` lists only +2 h, +10 d, +14 d.
- **AC 2:** Call with Club A's `clubId`, then without. **Verify:** only Club A, then all clubs.
- **AC 3:** 15 confirmed + 3 pending_payment + 4 cancelled on capacity 20, then fill it. **Verify:** `freePlaces` 2, then 0; card shows "Full – join waiting list", no Book button.
- **AC 4:** Sign in as a member with a confirmed booking, then as an instructor. **Verify:** member card "Booked" with own `myBooking.id`; staff get `none`/`null`/`null`.
- **AC 5:** Random UUID, then `clubId=abc`. **Verify:** 404 `CLUB_NOT_FOUND`; 400 `VALIDATION_ERROR` on `clubId`.
- **AC 6:** Club without classes. **Verify:** `items: []` and "No classes scheduled in the next two weeks."
- **AC 7:** Set a class to `cancelled`. **Verify:** "Cancelled" badge, no button.
- **AC 8:** Class at 00:30 club time. **Verify:** listed under that local day at 00:30.
- **AC 9:** `from`/`to` narrowing, `to` = +30 d, `from=xyz`, `from` = `to`. **Verify:** narrowed; `to` echoed as now + 14 d; 400 on `from`; 400 on `to`.
- **AC 10:** No session (also `clubId=abc`). **Verify:** 401 "Please sign in to continue."; signed-in response has `Cache-Control: no-store` and no member or instructor ids.
- **AC 11:** Open `/schedule` without `clubId`. **Verify:** home club preselected; changing club changes the URL; with the API stopped, the error and "Try again" appear. With an empty club list, "There are no clubs to show a schedule for yet." appears.

## Deployment notes
- **Pre-deploy:** none.
- **Post-deploy:** none for this story. No migration and no configuration. Tables and indexes come from US-117, US-118, US-120 and US-122.
- **At merge (required):** add the `/schedule` route inside `RequireAuth`, the `/` → `/schedule` redirect and the "Schedule" link in `AppHeader`. These files are not on this branch. Merge `repository.ts`, `service.ts`, `routes.ts` and `time.ts` with the US-120 additions. Register `classRoutes` in the `/api` scope of `buildApp` with `{ db, clock }`.

## Known limitations
- The `/schedule` route, the `/` redirect and the header link are not implemented on this branch (belong to US-118/US-120).
- Nothing has been compiled or tested. No project checks are configured (TK-119). The branch cannot build until US-117, US-118, US-120 and US-122 are merged. The new empty-club-list test is also unrun.
- Assumptions: all signed-in users may view any club's schedule; cancelled classes stay visible with a "Cancelled" badge (product owner: "use what you believe is appropriate"). Confirmation is still requested from the product owner.
- `myWaitlist` is always `null` until US-127. The waiting-list button comes with US-127.
- Out of scope: filters by type, instructor or time of day; iCal export; classes more than 14 days ahead; past classes; pagination; real-time updates of free places; waiting-list position on the card.
