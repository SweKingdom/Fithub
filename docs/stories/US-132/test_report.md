# US-132 — Test report (iteration 2)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| AC 1–3, 5–11 | ❌ | Not delivered; branch unchanged since iteration 1 |
| AC 4 | ❌ | Only gateway-level signature check; no webhook endpoint |
| Checks gate | ⛔ | No checks configured, no package.json |

## What to do
- AC 1–3, 5–11: implement the payments repository, service, webhook and routes. Also the bookClass drop-in branch, BookingDto.paymentStatus, the promotion skip, app.ts wiring, the `stripe` dependency, FakeGateway, integration tests and the web pay page.
- AC 4: implement `POST /webhooks/stripe` returning 400 INVALID_SIGNATURE with tables unchanged, plus tests.
- Process: the story is Blocked on TK-119, US-118, US-122, US-123 and US-128. Rebase after they land, then re-submit via `complete_development` with a passing `run_checks`.

## Not tested
- Checks gate: no checks configured, so the unit tests (config, payment-dto, stripe-gateway) are unrun and the pinned `STRIPE_API_VERSION` is unverified.
