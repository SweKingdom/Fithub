# US-130 — Test report (iteration 2)
**Verdict:** ✅ Approved (with notes) · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| run_checks (typecheck, lint, unit, web, build) | ✅ | all exit 0 |
| AC 1 Block created | ✅ | block-service.ts, no-show-block.test.ts |
| AC 2 Below threshold | ✅ | repository filters, tests |
| AC 3 Refused | ✅ | assertNotBlocked message/409 (HTTP wiring belongs to US-122/127) |
| AC 4 Block ends | ✅ | ends_at > now |
| AC 5 Configurable | ✅ | config tests |
| AC 6 No double counting | ✅ | tests |
| AC 7 Window | ✅ | unit + integration |
| AC 8 Correction lifts | ✅ | tests |
| AC 9 Bookings kept | ✅ | test |
| AC 10 Member sees block | ⛔ partly | /api/me + banner ✅; disabled buttons not testable |

## Not tested
- Integration tests were not executed (no test DB); verified by static review only.
- Disabled Book / Join waiting list buttons and HTTP 409 on booking/waitlist routes: code does not exist until US-122/127/129 land. Those stories must call `app.blockService.assertNotBlocked(trx, user.id)` and use `BOOKING_BLOCK_BANNER_ID`.
- Migration 0021 also adds `booking.attendance` IF NOT EXISTS (overlap with US-129): check on merge.
