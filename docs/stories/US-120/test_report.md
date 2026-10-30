# US-120 — Test report (iteration 1)
**Verdict:** ❌ Changes requested (checks gate not met) · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| AC 1 Valid class created | ✅ (static) | service.ts, routes.ts, dto.ts |
| AC 2–4 Validation | ✅ (static) | routes.ts `createClassBodySchema`; zod→fieldErrors mapping unverified (not on branch) |
| AC 5–7 Roles, club scope, instructor | ✅ (static) | routes.ts preValidation, service.ts, instructors.ts; 401 relies on authHook (not on branch) |
| AC 8 UI form | ⛔ | NewClassPage.tsx reads correctly, but its dependencies are missing and no web test ran |
| Checks gate | ⛔ | `run_checks`: no checks configured; nothing compiled or run |

Static review only. No test was executed, so the AC results above are not runtime evidence. Screenshot evidence is not applicable (no running app).

## What to do
- Gate: the delivery cannot be approved without a passing `run_checks`. Once TK-119, US-117 and US-118 are merged and checks are configured, wire in the items listed in the story's manual steps (schema registration, app.ts, error mapping, `createClass` factory, route, dependencies) and run typecheck and tests (`classes`, `clubs.instructors`, `NewClassPage`, `time`). Then resubmit for peer testing.

## Not tested
- AC 8 at runtime, the 401 path, and the zod-to-`fieldErrors` mapping (depend on code outside this branch).
- All of the integration, unit and web tests (never run).
