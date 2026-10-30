# US-124 — Test report (iteration 1)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

No checks are configured in the project, so `run_checks` ran nothing. No test run was available. Verification was by static review only.

## Summary
| Check | Result | Evidence |
|---|---|---|
| AC 1 Cancel in time | ❌ | No endpoint, service or DTO |
| AC 2 Boundary | ❌ | The helper logic is right, but no endpoint or integration test exists |
| AC 3–6 Too late / already cancelled / not owner / cancelled class | ❌ | Not implemented |
| AC 7 Event raised once | ❌ | The bus exists. The cancel transaction, concurrency and rollback do not |
| AC 8 Configurable window | ✅ (partial) | `config.ts` and `cancel-window.ts` are correct. `buildApp` wiring is not verifiable |
| AC 9 UI | ❌ | No web files |

## What to do
- AC 1–7: implement `POST /api/bookings/:id/cancel` (routes, service, repository, DTO, `buildApp` wiring) and `api/test/integration/bookings.cancel.test.ts`.
- AC 7: `domain-events.ts` imports `../db/schema.js`, which does not exist on this branch. It does not typecheck until the dependencies (US-122, US-123, US-118, TK-119) are merged.
- AC 9: implement `CancelBookingButton`, the `MyBookingsPage` slot, `cancelBooking(id)` and `web/test/CancelBookingButton.test.tsx`.

## Not tested
- The unit tests (`cancel-window`, `config`, `domain-events`) were not run. No checks are configured.
- Dependencies are not merged, so the story cannot be completed. Re-run it once they are.
