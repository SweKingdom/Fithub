# US-118 — Test report (iteration 2)
**Verdict:** ✅ Approved (with notes) · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| Project checks (5) | ✅ | `run_checks` all exit 0 |
| AC 1 Sign-in | ✅ | routes.ts, session.ts, auth.login.test.ts |
| AC 2 Invalid credentials | ✅ | routes.ts, errors.ts, auth.login.test.ts |
| AC 3 Unauthenticated blocked | ✅ | app.ts, hooks.ts, auth.protection.test.ts |
| AC 4/5 Roles | ✅ | hooks.ts `requireRole`, auth.roles.test.ts |
| AC 6 Sign-out | ✅ | routes.ts, auth.login.test.ts |
| AC 7 Rate limit | ✅ | routes.ts, auth.login.test.ts |
| AC 8 Origin guard | ✅ | hooks.ts, auth.protection.test.ts |
| AC 9 No secrets exposed | ✅ | app.ts redact, login test log capture |
| AC 10/11/12 | ✅ | delivered files and tests present; web and unit runs green |

## Findings from iteration 1
Both are fixed. Lint now exists and all five checks pass. The skeleton and wiring are present: `buildApp` accepts `config`, `clock` and `logger`, `routeTable` exists, and the `package.json` files, schema and factories are in place.

## Not tested
- The integration tests (`npm run test:integration -w api`) need Postgres and are not part of `run_checks`. I verified the ACs by static review of the code and tests. Please run them once locally or in CI before release.
- AC 10, 11 and 12 were checked by presence of the files and tests and by the green unit and web runs. I did not read them line by line.
- No screenshots were taken. This is a static review and there is no record page to capture.
