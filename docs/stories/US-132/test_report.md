# US-132 — Test report (iteration 3)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| AC 1–3, 5–11 | ❌ | Not implemented. The branch is unchanged since iteration 1. |
| AC 4 | ❌ | Only gateway-level signature verification exists. There is no webhook route. |
| Checks gate | ⛔ | `run_checks`: "No checks configured". The unit tests were not run. |

## What to do
- AC 1–3 and 5–11: implement the payments repository, service, webhook and routes. Also implement the bookClass drop-in branch, BookingDto.paymentStatus, the promotion skip, app.ts wiring, the `stripe` dependency, FakeGateway, the integration tests and the web pay page.
- AC 4: add `POST /webhooks/stripe`. It must return 400 INVALID_SIGNATURE and leave `payment`, `booking` and `stripe_event` unchanged. Add tests.
- Prerequisites TK-119, US-118, US-122, US-123 and US-128 must land on the branch (rebase). Then re-submit.
- Configure project checks so `run_checks` can pass.

## Not tested
- Checks gate: no checks are configured. The unit tests and the pinned `STRIPE_API_VERSION` are unverified.
