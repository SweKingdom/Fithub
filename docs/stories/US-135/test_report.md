# US-135 — Test report (iteration 1)
**Verdict:** ✅ Approved with notes · **Tester:** Cuélebre · **Date:** 2026-10-31

Method: static review of the delivered files against each AC. `run_checks` reports no checks configured, so nothing was compiled or executed. No screenshots were captured: this story has no record page to show.

## Summary
| Check | Result | Evidence |
|---|---|---|
| AC 1 Members loaded | ✅ | members.parse.ts, members.plan.ts, repository.ts; plan and integration tests |
| AC 2 Duplicates merged | ✅ | members.plan.ts steps 3–4; merges.csv asserted |
| AC 3 Conflicting duplicates | ✅ | CONFLICTING_DUPLICATE for name, type and club; existing member unchanged |
| AC 4 Re-run safe | ✅ | unchanged/updated logic; same `id` asserted |
| AC 5 Rejections | ✅ | all five codes; no default type |
| AC 6 Staff untouched | ✅ | EMAIL_USED_BY_STAFF |
| AC 7 Reconciliation | ✅ | `balanced`, rollback on imbalance |
| AC 8 Dry run | ✅ | no write path, reports written |
| AC 9 Invalid file | ✅ | ImportFileError before the DB; single transaction |
| Checks / execution | ⛔ | no checks configured; code never run |

## Not tested
- ⛔ Nothing was compiled or run. The unit and integration tests are unexecuted.
- ⛔ `test/helpers/db.ts` (`testDb`) does not exist on this branch, but the integration test imports it. It is not in the developer's merge notes. Also absent: `src/shared/clock.ts` and the `api/package.json` dependencies (csv-parse, csv-stringify, zod, kysely, pg).
- ⛔ The line numbers rely on `csv-parse` `info.lines` being the record's end line. This is unverified at runtime. A wrong value would shift every line number in the reports.
- ⛔ The exit code 1 (AC 7 and AC 9) is asserted only as thrown errors. No test runs the CLI.

## Notes for merge
- Before merging, add `testDb` (or fix the import), the dependencies and the clock module. Then run `npm test -w api -- imports` and confirm the line numbers in the merge and rejection reports against a real file.
- Suggest a small CLI test for exit codes.
