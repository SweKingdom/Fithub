# TK-131 — Test report (iteration 1)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

Static review only. `run_checks` found no checks, and the branch has no package.json, zod or vitest, so no test has been executed.

## Summary
| Check | Result | Evidence |
|---|---|---|
| AC 1 Settings documented | ✅ | README.md, .env.example list all 8 variables |
| AC 2 Fails fast | ✅ (static) | config.ts superRefine, config.test.ts |
| AC 3 Live-mode guard | ✅ (static) | config.ts rules 4–5, config.test.ts |
| AC 4 Disabled by default | ❌ | STRIPE_LIVE_MODE_ALLOWED validated while payments are off |
| AC 5 Webhook registered | ⛔ | Manual, needs Stripe access |
| AC 6 No secrets | ✅ (static) | No keys found in the 6 changed files |
| Checks gate | ⛔ | No checks configured |

## What to do
- **AC 4 / Tech Spec rule 1:** in `api/src/config.ts` the `STRIPE_LIVE_MODE_ALLOWED` check runs before the `paymentsEnabled !== true` return. `PAYMENTS_ENABLED=false` with `STRIPE_LIVE_MODE_ALLOWED=yes` throws at startup. Expected: when payments are off, all Stripe variables are ignored, as the README says. Move the `STRIPE_LIVE_MODE_ALLOWED` validation after the early return, and add a test in the AC 4 block.

## Not tested
- AC 5: Stripe dashboard webhook (manual, no access).
- Tests, typecheck, lint and build have not run. After TK-119 merges, run `npm test -w api -- config`.
