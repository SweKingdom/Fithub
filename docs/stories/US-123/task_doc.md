# US-123: View my bookings – members only access their own bookings
**Status:** Ready for UAT · **Category:** security · **Points:** 3 · **Sprint:** not recorded in the item

## Summary
Members can open "My bookings" and see their own upcoming and past bookings. Nobody else's booking can be read or changed: a foreign booking gives the same "not found" answer as an unknown id. Club staff can read the roster of a class in their own club but cannot change bookings.

## What was built
- `api/src/modules/bookings/access.ts`: access rules (`getReadableBooking`, `getOwnBookingForUpdate`, `assertStaffOfClass`, `bookingNotFound`, `classNotFound`). Ownership and club scope are part of the SQL WHERE clause.
- `api/src/modules/bookings/repository.ts`: `listMemberBookings`, `findBookingForMember`, `findBookingForClub`, `findOwnBooking`, `markBookingCancelled`, `findClassForRoster`, `listClassRoster`.
- `api/src/modules/bookings/service.ts`: zod schemas, `toBookingDto` (the only place that computes `canCancel`), `listMyBookings`, `getBooking`, `getClassRoster`, `cancelBooking` (placeholder).
- `api/src/modules/bookings/routes.ts`: `GET /api/me/bookings`, `GET /api/bookings/:id`, `POST /api/bookings/:id/cancel`, `GET /api/classes/:classId/bookings`.
- `api/src/app.ts`: registers the booking routes.
- `api/test/integration/bookings.list.test.ts`: AC 1, 2, 5.
- `api/test/integration/bookings.access.test.ts`: AC 3, 4, 6 (table-driven route matrix).
- `web/src/api/bookings.ts`: `getMyBookings(period, offset)`.
- `web/src/pages/MyBookingsPage.tsx`: Upcoming and Past tabs, club-local times, empty, loading and error states, "Show more".
- `web/src/App.tsx`: route `/my-bookings`, members only.
- `web/src/components/AppHeader.tsx`: navigation with "Schedule" and, for members only, "My bookings".
- `web/src/lib/time.ts`: `formatClubDateTime`.
- `web/test/MyBookingsPage.test.tsx`: AC 7.

## How it works
- **AC 1 (upcoming):** `GET /api/me/bookings` returns the signed-in member's active bookings (`confirmed`, `pending_payment`) on classes that have not ended, soonest first. Each item has `className`, `clubName`, `startAt`, `status`, `canCancel`.
- **AC 2 (past):** `?period=past` returns bookings of any status on ended classes, most recent first. Any other `period` value gives `400 VALIDATION_ERROR`.
- **AC 3 (hidden):** `GET /api/bookings/{id}` for another member's booking gives `404 BOOKING_NOT_FOUND` "This booking does not exist.". The body is identical to the response for an unknown id.
- **AC 4 (no change):** `POST /api/bookings/{id}/cancel` on another member's booking gives the same 404. The booking row is not changed.
- **AC 5 (staff scope):**
  - Club A staff call the roster of a Club A class → `200` (names only).
  - Club A staff call the roster of a Club B class → `403 FORBIDDEN` "You can only manage classes for your own club.".
  - Club A staff read a Club A booking → `200`; a Club B booking → `404`.
  - A member calls the roster → `403 FORBIDDEN` "Only instructors and club managers can manage classes.".
- **AC 6 (matrix):** the access test covers one row per booking route and checks that foreign or other-club access is refused and nothing changes.
- **AC 7 (UI):** the "My bookings" menu entry and the page are visible to members only. Times are shown in club local time. Empty texts: "You have no upcoming bookings." and "You have no past bookings.".
- **`canCancel`:** true only when the viewer is the owning member, the status is `confirmed` or `pending_payment`, and the class has not started. Always false for staff.

## How to test
**Checks:** `npm run typecheck`, `npm run lint`, `npm run test:unit -w api`, `npm test -w web`, `npm run build`.
**Integration (needs the test database):** `npm run test:integration -w api -- bookings.list bookings.access`.
**Web:** `npm test -w web -- MyBookingsPage`.

- **AC 1:** As a member with bookings, call `GET /api/me/bookings`. **Verify:** only your active bookings on classes that have not ended, soonest first.
- **AC 2:** Call `GET /api/me/bookings?period=past`, then `?period=foo`. **Verify:** ended classes of any status, newest first; then `400 VALIDATION_ERROR`.
- **AC 3:** As member A, call `GET /api/bookings/{B's id}`. **Verify:** `404 BOOKING_NOT_FOUND`, the same body as for a random id.
- **AC 4:** As member A, call `POST /api/bookings/{B's id}/cancel`. **Verify:** `404`; B's booking is still `confirmed`.
- **AC 5:** As club manager of club A, call the roster for a Club A class and a Club B class; then as a member. **Verify:** `200` roster with names only / `403` own-club message / `403` staff-only message.
- **AC 6:** Run `bookings.access.test.ts`. **Verify:** every matrix row passes and the booking table is unchanged afterwards.
- **AC 7:** Sign in as a member and open "My bookings". Sign in as staff. **Verify:** Upcoming and Past tabs, rows in club local time, empty texts, error banner with Retry; staff have no menu entry.

## Deployment notes
- No migrations and no configuration are added by this story.
- The `booking` table and `BookingDto` come from US-122 and must exist before deployment (see Dependencies in the story).

## Known limitations
- `POST /api/bookings/:id/cancel` is a **placeholder**. It sets the status to `cancelled` under the class lock, promotes the waiting list and notifies after commit. It has no cut-off, credits or events. US-124 replaces the handler body and may rename `BOOKING_NOT_CANCELLABLE`.
- `BOOKING_CANCEL_CUTOFF_MINUTES` does not exist yet. US-124 adds the cancel-window rule in `toBookingDto`.
- The cancel button is not in the UI. US-124 adds it.
- Waiting-list items are not in "My bookings". US-127 adds them and must add its routes to the access matrix.
- Staff cannot edit or cancel members' bookings. Exporting booking history and attendance capture are out of scope.
- The integration tests need the test database. They were checked by reading only and were not run in `run_checks`.
- Error wording: the shared handler keeps `VALIDATION_ERROR` "Some fields are missing or invalid." and `UNAUTHENTICATED` "Please sign in to continue.". The codes and statuses match the spec.
- Assumption (from the story): cancelled bookings appear in Past with their status.
