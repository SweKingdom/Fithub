# US-124 — Test report (iteration 7)
**Verdict:** ✅ Approved (with notes) · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| AC 1 Cancel in time | ✅ | service.ts `cancelBooking`, `markCancelled`; integration test |
| AC 2 Boundary | ✅ | cancel-window.ts inclusive `<=`; 120 min / 119m59s tests |
| AC 3 Too late | ✅ | 409 CANCELLATION_WINDOW_CLOSED, exact message, row unchanged, no event |
| AC 4 Already cancelled | ✅ | 409 BOOKING_ALREADY_CANCELLED, cancelled_at kept |
| AC 5 Not owner / staff | ✅ | `requireRole` 403 message; owner-scoped lookup → 404 |
| AC 6 Cancelled class | ✅ | 409 CLASS_CANCELLED |
| AC 7 Event once | ✅ | publish inside trx; class→booking lock; rollback on subscriber failure |
| AC 8 Configurable window | ✅ | config.ts 0–1440, default 120; `formatCutoff` |
| AC 9 UI | ✅ | CancelBookingButton, MyBookingsPage notices and refresh |
| run_checks | ✅ | typecheck, lint, api unit, web tests, build all exit 0 |

## Notes / Not tested
- The integration tests (`bookings.cancel.test.ts`, `bookings.access.test.ts`) need the `_test` database. Neither the developer nor QA ran them. The API ACs were verified by static review only. Run them in CI or a DB environment before release: `npm run test:integration -w api -- bookings.cancel bookings.access`.
- `formatCutoff` is duplicated in api and web. This is a style note only, because the two workspaces share no module.
