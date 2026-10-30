# US-123 — Test report (iteration 1)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| AC 1 Own upcoming bookings | ❌ | No `api/src/modules/bookings/` on the branch |
| AC 2 Past bookings / invalid period | ❌ | No route or validation |
| AC 3 Other members' bookings hidden | ❌ | No `GET /api/bookings/:id` |
| AC 4 Other members' bookings cannot be changed | ❌ | No access helpers (`access.ts`) |
| AC 5 Staff scope | ❌ | No roster route |
| AC 6 Ownership test matrix | ❌ | `bookings.access.test.ts` does not exist |
| AC 7 UI | ❌ | `MyBookingsPage.tsx` does not exist |
| run_checks | ⚠️ | No checks configured, so nothing was compiled or tested |

## Checks
For every AC I listed the branch files and looked for the files named in the Technical Specification. None exist. The branch contains only `api/src/config.ts`, `api/src/server.ts`, `api/test/unit/config.test.ts` and docs. Evidence is the file listing; no screenshot applies because there is no record page to capture.

## What to do
- Implement US-123 (all ACs) once the branch is rebased onto a base containing TK-119, US-117, US-118, US-120 and US-122. The developer's hand-over states these are missing.
- Include the AC 6 ownership matrix test, and make sure checks are configured and run.

## Not tested
- Nothing could be run. The project has no checks configured, so there is no test output.
- The cause is missing dependencies, not the ticket. The ticket is clear enough to test.
