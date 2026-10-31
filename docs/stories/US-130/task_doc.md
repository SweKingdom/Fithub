# US-130: Block members with repeated no-shows from booking for a week
**Status:** Ready for UAT · **Category:** development · **Points:** 3 · **Sprint:** not recorded

## Summary
A member who misses a set number of booked classes within a rolling window is blocked from booking classes and joining waiting lists for a set number of days. The block starts when the threshold is reached and ends automatically. A club manager can correct a mistaken no-show, which ends the block early when the count falls below the threshold. The member sees the block on the schedule page and in `GET /api/me`.

Defaults are provisional until the product owner confirms them: 3 no-shows, rolling 30 days, 7-day block.

## What was built
- `api/migrations/0021_create_booking_block.ts`: creates `booking_block`, adds `booking.no_show_block_id` and two partial/normal indexes. `down` reverses them.
- `api/src/db/schema.ts`: `BookingBlockTable`, `BookingTable.no_show_block_id`.
- `api/src/config.ts`, `.env.example`: `NO_SHOW_THRESHOLD`, `NO_SHOW_WINDOW`, `NO_SHOW_WINDOW_DAYS`, `NO_SHOW_BLOCK_DAYS`.
- `api/src/modules/attendance/no-show-window.ts`: `noShowWindowStart(now, config, timezone)` returns the start of the counting window.
- `api/src/modules/attendance/block-repository.ts`: `lockMember`, `findActiveBlock`, `listUncountedNoShows`, `insertBlock`, `linkBookings`, `unlinkBooking`, `countLinked`, `liftBlock`.
- `api/src/modules/attendance/block-service.ts`: `onAttendanceRecorded(trx, event)`, `getActiveBlock(db, memberId)`, `assertNotBlocked(trx, memberId)`.
- `api/src/modules/attendance/errors.ts`: `BOOKING_BLOCKED` (HTTP 409).
- `api/src/shared/domain-events.ts`: `AttendanceRecorded` event type.
- `api/src/app.ts`: event bus option, `AttendanceRecorded` subscription, `app.events` and `app.blockService` decorators.
- `api/src/modules/auth/routes.ts`, `service.ts`: `bookingBlock` in `GET /api/me` and in the sign-in response (`null` for staff).
- `web/src/components/BookingBlockBanner.tsx`: status banner from `me.bookingBlock`, shown on the schedule page.
- `web/src/pages/SchedulePage.tsx`, `web/src/api/auth.ts`: banner wiring and `BookingBlock` type.
- Tests: `api/test/unit/no-show-window.test.ts`, `api/test/unit/config.noshow.test.ts`, `api/test/integration/no-show-block.test.ts`, `api/test/integration/auth.login.test.ts`, `web/test/BookingBlockBanner.test.tsx`, `web/test/RequireAuth.test.tsx`, `web/test/SignInPage.test.tsx`.

## How it works

| AC | Behaviour |
|---|---|
| AC 1 | When an attendance save sets a booking to `no_show` and the uncounted no-shows in the window reach the threshold, one `booking_block` row is created in the same transaction. Its `reason` is `no_show`, `starts_at` is now, `ends_at` is now + block days, and `no_show_count` is the count. The counted bookings get `no_show_block_id`. |
| AC 2 | Below the threshold, no block is created. |
| AC 3 | A blocked member calling `assertNotBlocked` gets `409 BOOKING_BLOCKED` with "You can't book classes until {date} because of {N} missed classes." The date is in the club's time zone. Nothing is stored. Class checks run first. |
| AC 4 | A block is active while `starts_at <= now < ends_at`. At `ends_at` the member can book again. |
| AC 5 | Threshold and block length come from configuration. |
| AC 6 | Linked no-shows are never counted again. No second block is created while a block is active. |
| AC 7 | Rolling window: a no-show counts when the class start is after now minus `NO_SHOW_WINDOW_DAYS`. Calendar month: counts from the 1st of the current month 00:00 in the club time zone. |
| AC 8 | Correcting a linked no-show to `attended` unlinks it. If the block is active and the remaining linked count is below the threshold, the block ends now (`ends_at` and `lifted_at` set to now). |
| AC 9 | Blocking does not touch existing bookings. |
| AC 10 | `GET /api/me` returns `bookingBlock` (`endsAt`, `reason`, `noShowCount`, `message`) or `null`. The schedule page shows the banner with `role="status"`. |

Concurrency: the handler locks the `app_user` row of the member (`FOR UPDATE`), so two parallel saves for the same member cannot create two blocks. Lock order is `gym_class` → `booking` → `app_user`.

Re-delivery of the same event is safe: a booking already linked, or an active block, leads to no change.

## How to test
**Automated:** `npm run typecheck`, `npm run lint`, `npm run test:unit -w api`, `npm test -w web`, `npm run build`.
**Integration (needs the test database):** `npm run db:migrate && npm run test:integration -w api -- no-show-block auth.login`.

- **AC 1:** Record 3 no-shows for one member on classes from the last 30 days. **Verify:** one `booking_block` row (`reason` `no_show`, `no_show_count` 3, `ends_at` = now + 7 days) and the 3 bookings linked.
- **AC 2:** Record 2 no-shows, or cancelled/unpaid/attended ones. **Verify:** no block.
- **AC 3:** Call `blockService.assertNotBlocked` for a blocked member. **Verify:** `409 BOOKING_BLOCKED` with the exact message in club time. Booking and waiting-list HTTP checks follow when US-122 and US-127 land.
- **AC 4:** Set the clock to `ends_at`. **Verify:** no error; one millisecond earlier the member is still blocked.
- **AC 5:** Set `NO_SHOW_THRESHOLD=4` and `NO_SHOW_BLOCK_DAYS=3`. **Verify:** block only at the 4th no-show, `ends_at` = now + 3 days.
- **AC 6:** Record a no-show after the block ended, and one during the block. **Verify:** no new block.
- **AC 7:** Record a no-show on a class 31 days old. Set `NO_SHOW_WINDOW=calendar_month`. **Verify:** not counted; month boundary in club time (unit test).
- **AC 8:** Correct one linked no-show to `attended` while blocked. **Verify:** `ends_at` = `lifted_at` = now, booking unlinked, member not blocked.
- **AC 9:** Block a member with upcoming bookings. **Verify:** they stay `confirmed`.
- **AC 10:** `GET /api/me` as a blocked member, then open the schedule. **Verify:** `bookingBlock` with `endsAt`, `reason`, `noShowCount`, `message`; banner shows the same text. Disabled Book / Join waiting list buttons are verified when `BookButton` exists.

## Deployment notes
**Pre-deployment:** set `NO_SHOW_THRESHOLD`, `NO_SHOW_WINDOW`, `NO_SHOW_WINDOW_DAYS` and `NO_SHOW_BLOCK_DAYS` to the values confirmed by the product owner. Defaults (3 / `rolling_days` / 30 / 7) are provisional.

**Post-deployment:**
1. Run `npm run db:migrate` (creates `booking_block`, adds `booking.no_show_block_id`).
2. Check `\d booking_block` shows the CHECK constraints.
3. Check `GET /api/me` as a member returns `"bookingBlock": null`.

**Migration note:** migration 0021 also adds `booking.attendance` (`IF NOT EXISTS`) and re-creates its CHECK constraint. Compare it with the US-129 migration when merging.

**Rollback:** `down` drops the index, the column and the `booking_block` table. Blocks are lost and members are unblocked.

## Known limitations
- The booking route (US-122), waiting-list join (US-127) and attendance route (US-129) are not on this branch. Their call sites must call `app.blockService.assertNotBlocked(trx, user.id)`. Their buttons must set `aria-describedby` to `BOOKING_BLOCK_BANNER_ID`.
- HTTP tests for AC 3 and AC 4 on the booking route (`bookings.book.test.ts`) and the disabled-button part of AC 10 are pending those stories.
- Integration tests were written but not run in this environment (no test database available).
- Threshold, window and block length are provisional until the product owner confirms them.
- Waiting-list promotion does not skip blocked members (US-128 decides).
- Manual blocks (`reason = manual`) are reserved in the data model; no UI.
- Assumed, not confirmed: existing bookings and waiting-list places are kept while blocked; a correction ends the block at once.
- Notifications by e-mail and fines are out of scope.
