# US-133 — Test report (iteration 1)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| AC 1 Pending on outage | ❌ | No service/DTO changes |
| AC 2 Successful retry | ❌ | No maintenance job, no notifier events |
| AC 3 No duplicate charges | ❌ | No retry path |
| AC 4 Backoff and give up | ❌ | Only pure helpers exist (correct); no job/give-up flow |
| AC 5 Hold expires | ❌ | Only `holdDeadline` exists; no expiry flow |
| AC 6 Status visible | ❌ | No web pages or test |
| AC 7 Decline not retried | ❌ | No job |
| AC 8 Cancelled bookings leave no live intent | ❌ | No handlers |
| AC 9 Parallel runs and races | ❌ | No lease/locking |
| AC 10 Disabled and quiet | ❌ | No job registered |
| Checks gate | ⛔ | No checks configured; unit tests could not be run |

## What was reviewed
Delivered: config variables, `retry-policy.ts` (formulas match the spec: base×2^(n-1), `attempt_count >= max`, hold capped at class start), unit tests, `.env.example` and README. These are correct on reading but not executed. They are building blocks and satisfy no AC end to end.

## What to do
- Implement AC 1–10 as specified (service `recordCreateFailure`, `maintenance.ts`, repository, `handlers.ts`, notifier events, job registration, DTO, web pages, integration and web tests). This needs US-132 (Blocked), US-128 and US-124 on the branch first.
- Provide a way to run the checks (TK-119) so the tests can be executed.

## Not tested
- Checks gate: no checks configured, so retry-policy and config unit tests were not run.
