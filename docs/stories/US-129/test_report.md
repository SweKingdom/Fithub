# US-129 — Test report (iteration 1)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| Project checks (typecheck, lint, api unit, web, build) | ✅ | run_checks all exit 0 |
| AC 1–7 record/validation/window/access (static) | ✅ | service.ts, window.ts, repository.ts |
| AC 8 auto no-show (static) | ✅ | auto-no-show.ts |
| AC 9 UI page states | ✅ | ClassAttendancePage.tsx |
| AC 9 entry from started class | ❌ | schedule never lists started classes |
| Docs: technical overview | ❌ | not updated |

## Checks
- AC 1–7: logic matches the spec (lock order, 404→403→409 cancelled→window, all-or-nothing 400 with `entries[i].bookingId`, no write/event when value unchanged, manager correction after window, exactly `closesAt` = closed).
- AC 8: disabled returns {0,0}; enabled touches only confirmed `unknown` rows, recordedBy null, event each, SKIP LOCKED, idempotent.
- AC 9: page has loading/error/empty/not-open/closed/read-only states, Mark all attended, Save sends changed rows only, "Attendance saved." status.

## What to do
- AC 9: staff cannot open "Attendance" from a started class — the schedule API never returns started classes, so the SchedulePage link effectively never shows. Make the link reachable (e.g. have the schedule include started/recent classes for staff, or another entry point agreed with the architect) and add a test proving it.
- Docs: document the three `ATTENDANCE_*` variables in the technical overview (the story requires it).

## Not tested
- Integration tests (AC 1–8, DB CHECK, access matrix) need PostgreSQL and are not part of run_checks; they were never executed, so runtime behaviour is verified by static review only. Please run `npm run db:migrate` and `npm run test:integration -w api -- attendance bookings.access` where a DB is available and report the result.
