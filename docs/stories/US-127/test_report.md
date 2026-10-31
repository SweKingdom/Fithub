# US-127 — Test report (iteration 1)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| AC 1–6 (API) | ⛔ Blocked | `service.ts` and `routes.ts` read correctly against the spec, but nothing compiled or ran |
| AC 7 Direct booking removes entry | ❌ Fail | `bookClass` hook not delivered |
| AC 8 Schedule position | ❌ Fail | Schedule join, `BookButton` rules not delivered |
| Checks gate | ⛔ Blocked | `run_checks`: no checks configured |

## What to do
- AC 7: call `removeWaitingForMember(trx, classId, user.id, now)` in `bookClass` after the booking insert (201 and 202 paths), in the same transaction.
- AC 8: add the lateral join and the `myWaitlist` / `myBookingStatus` fields to the schedule query and DTO. Apply the `BookButton` render rules. Extend `classes.schedule.test.ts`.
- Wire `waitlistRoutes` in `app.ts` and add `waitlist_entry` to `schema.ts`. Add the access-matrix rows.
- Merge or rebase onto the prerequisites (TK-119, US-118, US-120, US-121, US-122) so the checks and tests actually run, then resubmit.

## Not tested
- AC 1–6 at runtime: no runnable project on the branch.
- The unit, integration and web tests were never executed.
