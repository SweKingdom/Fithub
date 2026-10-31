# US-128 — Test report (iteration 1)
**Verdict:** ✅ Approved (with notes) · **Tester:** Cuélebre 🐉 · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| AC 1 First in line promoted | ✅ | promotion.ts; test asserts booking/entry fields, B position 1 |
| AC 2 Ineligible skipped | ✅ | checkPromotionEligibility → markRemoved |
| AC 3 No double allocation | ✅ | class lock + guarded claimEntry; parallel tests |
| AC 4 Member informed | ✅ | notifyPromotions after commit; rollback and failing-notifier tests |
| AC 5 Drop-in | ✅ | pending_payment, source waitlist |
| AC 6 Cut-off and expiry | ✅ | expireEntries SQL; cut-off 0 and 30 tests |
| AC 7 Safety net | ✅ | sweep; job run twice |
| AC 8 No-op | ✅ | early returns; tests |
| run_checks | ✅ | typecheck, lint, api unit, web, build all exit 0 |

Evidence is static review of the delivered files (no record page applies, so no screenshots).

## Not tested
- Integration tests (`waitlist.promotion`, `waitlist.maintenance`) need PostgreSQL and were not executed by QA. They were reviewed statically: real assertions, a failure path for each AC, concurrency cases.
- `cancelBooking` wiring (US-124) is not on this branch. It is documented for whichever story merges second.

## Notes
- Before merge, run the integration tests against `fithub_test`.
- Provisional migrations 0005 and 0006 must be de-duplicated when US-122 and US-127 merge.
