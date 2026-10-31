# US-122 — Test report (iteration 3)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| Project checks | ❌ | typecheck passes; lint fails: "Missing script: lint" (exit 1) |
| AC 1–8 | ❌ | `api/src/app.ts` and `api/src/db/schema.ts` are missing from the branch; the route is not registered and the integration tests cannot run |
| AC 9 | ⛔ | web tests not reached |

## What to do
- Checks: the foundation (TK-119: root scripts, lint) must be merged and the branch rebased. Then all five checks must pass.
- AC 1–8: register `bookingRoutes({ db, clock })` under `/api` in `api/src/app.ts`, and add `booking: BookingTable` to `Database` in `api/src/db/schema.ts`.
- AC 1–8: extend the factories, then make `bookings.book.test.ts` pass, including the concurrency tests and the 23505 guard.
- Verify the guessed interfaces (`DomainError`, `currentUser`, `Clock`, `apiFetch`) against the real files.

## Not tested
- AC 9: the web tests were not run, because the checks gate stops at lint.
