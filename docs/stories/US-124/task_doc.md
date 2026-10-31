# US-124: Cancel my booking up to 2 hours before the class
**Status:** Ready for UAT · **Category:** development · **Points:** 3 · **Sprint:** —

## Summary
Members can cancel their own booking until 2 hours before the class starts. The cancelled place is freed immediately, and a `BookingCancelled` event is raised once per cancellation. The cut-off is configurable with `BOOKING_CANCEL_CUTOFF_MINUTES` (default 120).

## What was built
- `POST /api/bookings/:id/cancel` — member cancel endpoint (`api/src/modules/bookings/routes.ts`); staff get `403 FORBIDDEN`.
- `cancelBooking` in `api/src/modules/bookings/service.ts` — checks ownership, status, class status and window, marks the booking cancelled, publishes the event in the same transaction.
- `markCancelled(trx, id, at)` in `api/src/modules/bookings/repository.ts` — writes `status` and `cancelled_at`.
- `cancel-window.ts` — `cancelDeadline`, `isWithinCancelWindow`, `formatCutoff`.
- `BookingDto` gains `cancelDeadline` and `cancelledAt`.
- `BookingCancelled` event added to the `DomainEvent` union in `api/src/shared/domain-events.ts`.
- `bookingCancelCutoffMinutes` in `api/src/config.ts` (env `BOOKING_CANCEL_CUTOFF_MINUTES`, integer 0–1440, default 120).
- Migration `api/migrations/0022_booking_cancelled_at.ts` — adds `booking.cancelled_at timestamptz NULL`.
- `CancelBookingButton` (`web/src/components/CancelBookingButton.tsx`) — button, disabled hint, confirmation dialog.
- `MyBookingsPage` — cancel button per Upcoming row, success and error notices, list refresh.
- `cancelBooking(id)` in `web/src/api/bookings.ts`.

## How it works
- **AC 1 — Cancel in time:** owner cancels more than the cut-off before start → `200`, `status` = `cancelled`, `cancelledAt` = server time, `canCancel` = `false`, free places +1.
- **AC 2 — Boundary:** exactly 120 minutes before start → accepted. 119 min 59 s → `409 CANCELLATION_WINDOW_CLOSED`.
- **AC 3 — Too late:** inside the window → `409 CANCELLATION_WINDOW_CLOSED`, row unchanged, no event.
- **AC 4 — Already cancelled:** `409 BOOKING_ALREADY_CANCELLED`, `cancelled_at` unchanged, no event.
- **AC 5 — Not owner / staff:** another member's or unknown booking → `404 BOOKING_NOT_FOUND`. Instructor or club manager → `403 FORBIDDEN`.
- **AC 6 — Cancelled class:** `409 CLASS_CANCELLED`, row unchanged.
- **AC 7 — Event once:** one `BookingCancelled` event `{ bookingId, classId, memberId, previousStatus, cancelledAt, cause: 'member_cancelled' }` inside the transaction. Parallel cancels: one `200`, one `409`. A failing handler rolls back the cancel and returns `500`.
- **AC 8 — Configurable window:** with `BOOKING_CANCEL_CUTOFF_MINUTES=90`, a class in 100 minutes is accepted and the message reads "…90 minutes…". Invalid values stop startup with `Invalid configuration: BOOKING_CANCEL_CUTOFF_MINUTES: …`.
- **AC 9 — UI:** active rows with `canCancel = true` show "Cancel booking" → confirmation → toast "Your booking has been cancelled." Rows with `canCancel = false` show a disabled button with the hint "Cancellation closed (less than 2 hours to start)". API errors show in an alert and the list refreshes.

## How to test
**Checks:** `npm run typecheck`, `npm run lint`, `npm run test:unit -w api`, `npm test -w web`, `npm run build`.
**Integration (needs `_test` database):** `npm run test:integration -w api -- bookings.cancel bookings.access`.

- AC 1 — **Verify:** `POST /api/bookings/:id/cancel` as owner, class in 3 h → `200`, free places +1.
- AC 2 — **Verify:** class in exactly 120 min → `200`; 119 min 59 s → `409 CANCELLATION_WINDOW_CLOSED`.
- AC 3 — **Verify:** class in 1 h → 409 with the window message; no event.
- AC 4 — **Verify:** cancel a cancelled booking → `409 BOOKING_ALREADY_CANCELLED`.
- AC 5 — **Verify:** other member's booking → `404`; instructor/club manager → `403`.
- AC 6 — **Verify:** booking on a cancelled class → `409 CLASS_CANCELLED`.
- AC 7 — **Verify:** one event with `cause: 'member_cancelled'`; parallel cancels → one 200, one 409.
- AC 8 — **Verify:** `BOOKING_CANCEL_CUTOFF_MINUTES=90`, class in 100 min accepted; `abc`, `-1`, `1441` stop startup.
- AC 9 — **Verify:** "Cancel booking" flow on "My bookings"; disabled hint on `canCancel=false`; error alert and refresh on API error.

## Deployment notes
- **Pre-deploy:** run `npm run db:migrate` (migration `0022_booking_cancelled_at` adds `booking.cancelled_at`; uses `IF NOT EXISTS`).
- **Configuration (optional):** `BOOKING_CANCEL_CUTOFF_MINUTES` (default 120). Documented in `.env.example` and `README.md`.
- **Post-deploy:** none.
- **Verification:** cancel a test booking more than 2 h before start (accepted) and one less than 2 h before start (rejected).

## Known limitations
- Integration tests (`bookings.cancel`, `bookings.access`) were not run by the developer or QA; they must be run against the `_test` database before release.
- `formatCutoff` is duplicated in API and web (style only).
- Out of scope: late-cancellation fees, staff cancelling a member's booking, waiting-list promotion logic (US-128), credit return (US-125), refunds (US-134), notifications.
