# US-117 — Test report (iteration 1)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| Checks gate | ❌ | lint exit 1 (Missing script "lint"); typecheck exit 0 but unreliable (no package.json on branch) |
| AC 1–2 Seed create / idempotent | ⛔ | seed.ts reads correctly; tests never run (no DB or skeleton) |
| AC 3–5 Invalid file / missing file / never delete | ⛔ | seed.ts messages match spec; no run; no `db:seed:clubs` script |
| AC 6 GET /api/clubs | ❌ | no app.ts, route not registered |
| AC 7 Migration reversible | ⛔ | migration matches spec; no db:migrate scripts, test not run |

## What to do
- Checks gate: run_checks must pass (typecheck, lint, unit tests, web tests, build). The branch needs the TK-119 skeleton (root and api package.json with `lint`, tsconfig, eslint config). Merge or rebase TK-119 into this branch, then apply the pending edits.
- AC 6: register `clubRoutes({ db })` in the `/api` scope of `api/src/app.ts`, so `GET /api/clubs` is reachable. Run `clubs.routes.test.ts`.
- AC 1–5, 7: add the `db:seed:clubs`, `db:migrate` and `db:migrate:down` scripts and add `Club` to `db/schema.ts`. Run the integration tests against a real database and attach the output.

## Not tested
- AC 1, 2, 3, 4, 5, 7: static review only. Execution is blocked by the missing skeleton and database. These are not failures of the code itself.
