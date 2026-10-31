# US-125 — Test report (iteration 2)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| Project checks | ❌ | typecheck passes; `npm run lint` fails with exit 1 (Missing script "lint") |
| AC 1, 3, 8, 9 | ❌ | Hooks and `creditUsed` are not on the branch |
| AC 2, 5, 6, 7, 10 | ❌ | Module-only delivery. Not wired into the app, API or web buttons |
| AC 4, 11 | ⛔ | Ledger tests never executed |

## What to do
- Land TK-119 and the dependent stories (US-118, US-122, US-124, US-127, US-128), or get a human decision to widen the scope. No code changed this iteration and the branch is unchanged.
- Implement all the hooks: `bookClass`, `promoteNext`, `joinWaitlist`, `registerCreditHandlers` in `buildApp`, `GET /api/me` `creditBalance`, `BookingDto.creditUsed` and the web credit texts.
- Add integration tests for AC 1–11.
- Run `run_checks` to a full pass (typecheck, lint, unit, web, build) before hand-over.

## Not tested
- AC 4 and AC 11: the ledger tests have never run because the checks stop at lint.
