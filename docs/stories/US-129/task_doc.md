# US-129: Record attendance and no-shows for a class
**Status:** Ready for UAT · **Category:** development · **Points:** 3 · **Sprint:** not recorded

## Summary
Instructors and club managers can now mark each confirmed booking of a class as Attended or No-show from a roster in the app. Recording opens when the class starts and closes 24 hours after it ends; after that only the club manager can correct an entry. Staff reach the roster from a "Attendance" link on the schedule.

## What was built
- `migrations/0021_add_booking_attendance_audit`: adds the `booking` audit columns `attendance_recorded_by` and `attendance_recorded_at`, and the CHECK `booking_attendance_recorded_ck` (an `unknown` booking has no recorded timestamp, every other value has one).
- `db/schema.ts`: `BookingTable` gains `attendance_recorded_by` and `attendance_recorded_at`.
- `config.ts`, `.env.example`: `ATTENDANCE_EDIT_WINDOW_HOURS`, `ATTENDANCE_AUTO_NO_SHOW_ENABLED`, `ATTENDANCE_SWEEP_INTERVAL_MINUTES`.
- `shared/domain-events.ts`: `AttendanceRecorded` event added to the `DomainEvent` union.
- `modules/attendance/window.ts`: pure functions `attendanceWindow` and `canEditAttendance`.
- `modules/attendance/repository.ts`, `service.ts`, `dto.ts`, `errors.ts`, `routes.ts`: roster read and attendance save, `GET` and `PUT /api/classes/:classId/attendance`.
- `modules/attendance/auto-no-show.ts`: `runAutoNoShowSweep` and `startAutoNoShowSweeper`. Switched off by default.
- `modules/bookings/access.ts`: `assertStaffOfClass` (club scope check).
- `modules/classes/repository.ts`, `service.ts`, `errors.ts`: staff schedule also returns started classes of their own club until the attendance window closes.
- `app.ts`, `server.ts`: attendance routes under `/api`; sweeper started only when enabled.
- `web/src/pages/ClassAttendancePage.tsx`, `web/src/api/attendance.ts`, `web/src/App.tsx`: page at `/classes/:classId/attendance`.
- `web/src/pages/SchedulePage.tsx`: "Attendance" link on started, non-cancelled classes of the user's club.

## How it works
**AC 1: Mark attendance.** Staff of the class's club save the roster after class start. Each changed booking gets the new value, the user id and the server time, and one `AttendanceRecorded` event in the same transaction.

**AC 2: Before start.** Saving before `start_at` returns `409 ATTENDANCE_NOT_OPEN`. Nothing is written.

**AC 3: Only staff of the club.** Members get `403 FORBIDDEN`. Staff of another club get `403 FORBIDDEN`. No session gets `401`. Nothing is written.

**AC 4: Only confirmed bookings.** The roster lists `confirmed` bookings only. A save that contains a cancelled, `pending_payment` or foreign-class booking is rejected with `400 VALIDATION_ERROR` and a field error on that entry. The save is all-or-nothing.

**AC 5: Correction window.** The window runs from `start_at` to `start_at + duration + ATTENDANCE_EDIT_WINDOW_HOURS`. After it closes, instructors get `409 ATTENDANCE_CLOSED`. The club manager can still correct entries, and the event carries `previousAttendance`.

**AC 6: Repeated save.** Only rows whose value changes are written. Saving the same values again changes nothing and publishes no event.

**AC 7: Cancelled or unknown class.** A cancelled class returns `409 CLASS_CANCELLED`. An unknown class returns `404 CLASS_NOT_FOUND`.

**AC 8: Auto no-show.** Only when `ATTENDANCE_AUTO_NO_SHOW_ENABLED=true`, the sweep turns remaining `unknown` confirmed bookings into `no_show` after the window closes. Recorded-by is null. Running it again changes nothing.

**AC 9: UI.** The roster page shows the summary, Attended / No-show choices, "Mark all attended", Save, and the loading, empty, not-open, closed (read-only for instructors) and error states. Save sends only changed rows and shows the toast "Attendance saved.".

## How to test
**Automated:** `npm run typecheck`, `npm run lint`, `npm run test:unit -w api`, `npm test -w web`, `npm run build`.

**Integration** (needs PostgreSQL `fithub_test`): `npm run db:migrate`, then `npm run test:integration -w api -- attendance bookings.access classes.schedule`.

- AC 1: As an instructor of the club, after class start, mark 15 attended and 3 no-show and save. **Verify:** 200 with the roster; each booking row has `attendance`, `attendance_recorded_by` and `attendance_recorded_at`; one event per changed booking.
- AC 2: Save before the class starts. **Verify:** 409 `ATTENDANCE_NOT_OPEN`; no row changed.
- AC 3: Call the save as a member, as staff of another club and without a session. **Verify:** 403, 403, 401; no row changed.
- AC 4: Open a roster with a cancelled and an unpaid booking; save a cancelled, a pending and a foreign-class booking id. **Verify:** both missing from the list; 400 with `entries[i].bookingId` field errors; nothing saved.
- AC 5: Save as instructor at class end + 24 h, then correct as club manager. **Verify:** 409 `ATTENDANCE_CLOSED`; manager gets 200 and event `previousAttendance` = `no_show`.
- AC 6: Save the same values twice. **Verify:** `attendance_recorded_at` unchanged; no new event.
- AC 7: Save on a cancelled class and on a random id. **Verify:** 409 `CLASS_CANCELLED`; 404 `CLASS_NOT_FOUND`.
- AC 8: Run the sweep with the flag `true` and `false`. **Verify:** enabled: unknown rows become `no_show`, second run changes nothing; disabled: nothing changes.
- AC 9: As an instructor, open `/schedule`. **Verify:** a class started 10 minutes ago has an "Attendance" link; other clubs, cancelled classes and members show none. The link opens the roster and the save flow works.
- DB: `UPDATE booking SET attendance = 'attended'` without a timestamp. **Verify:** fails `booking_attendance_recorded_ck`.

## Deployment notes
- **Pre-deploy:** optionally set `ATTENDANCE_EDIT_WINDOW_HOURS` (default 24). Keep `ATTENDANCE_AUTO_NO_SHOW_ENABLED=false` until the product owner confirms auto no-show.
- **Post-deploy:** run `npm run db:migrate` (migration `0021_add_booking_attendance_audit`). Verify with `\d booking` that both audit columns and `booking_attendance_recorded_ck` exist. Open the attendance page of a started class as an instructor and save one row.
- **Configuration:** `ATTENDANCE_EDIT_WINDOW_HOURS` (int 1–168, default 24), `ATTENDANCE_AUTO_NO_SHOW_ENABLED` (boolean, default false), `ATTENDANCE_SWEEP_INTERVAL_MINUTES` (int 1–1440, default 15).
- **Rollback:** the migration `down` drops the constraint and both columns. Recorded attendance is lost, so roll back only before go-live.

## Known limitations
- Integration tests (AC 1–8 at runtime and the new staff-schedule SQL) have not been run yet. They must run before release.
- Attendance is captured by staff in the app only. Hardware check-in, member self check-in and walk-ins are out of scope.
- Auto no-show is built but off by default. Switching it on requires product owner confirmation (open question).
- A recorded attendance cannot be reset to `unknown`.
- Members are not notified about a recorded no-show.
- The no-show block rule (US-130) consumes `AttendanceRecorded` and is built separately.
