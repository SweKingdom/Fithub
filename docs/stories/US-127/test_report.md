# US-127 — Test report (iteration 2)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| AC 1–6 | ⛔ Blocked | No code changed since iteration 1. Nothing compiled or run, and the interface assumptions are unverified. |
| AC 7 | ❌ | `bookings/service.ts` is not on the branch, so `bookClass` does not call `removeWaitingForMember`. |
| AC 8 | ❌ | The schedule lateral join, `myWaitlist` and `BookButton` render rules are missing. `WaitlistButton` is wired into no screen. |
| Checks gate | ❌ | `run_checks` reports "No checks configured". |

## What to do
- AC 7: in `bookClass`, call `removeWaitingForMember(trx, classId, user.id, now)` after the booking insert (201 and 202 paths), in the same transaction. The entry must stay `waiting` if the booking fails.
- AC 8: add the schedule lateral join, fill `myWaitlist` and `myBookingStatus = 'waiting'`, and apply the `BookButton` render rules with `WaitlistButton` wired in.
- Checks: merge the prerequisites (TK-119, US-118, US-120, US-121, US-122), do the wiring in `app.ts` and `schema.ts`, and get `npm test -w api` and `npm test -w web` passing.

## Not tested
- AC 1–6: the earlier static review of `service.ts` and `routes.ts` found no defects. They are unproven until the prerequisites land and the tests run.
