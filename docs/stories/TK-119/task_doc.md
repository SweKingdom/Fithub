# TK-119: Set up repository skeleton and CI pipeline with automated checks
**Status:** Ready for UAT · **Category:** devops · **Points:** 3 · **Sprint:** —

## Summary
The repository now has a working walking skeleton (API, web app and test database) and a CI pipeline. Every pull request and every push to `main` is formatted, linted, type-checked, migrated, tested and built automatically. Developers can run the same chain locally with `npm run ci`.

## What was built
- `package.json`, `package-lock.json`, `.nvmrc` (Node 22), `tsconfig.base.json`: npm workspaces `api` and `web`, pinned tooling.
- `eslint.config.js`, `.prettierrc.json`, `.prettierignore`: lint and format configuration.
- `.github/workflows/ci.yml`: workflow `CI`, job `checks` (status check `CI / checks`).
- `api/src/config.ts` (`loadConfig`): validates `DATABASE_URL`, `PORT`, `NODE_ENV`, `LOG_LEVEL`.
- `api/src/app.ts` (`buildApp`, `AppDeps`): Fastify application factory; does not listen.
- `api/src/server.ts`: starts the server; graceful shutdown on `SIGTERM`/`SIGINT`.
- `api/src/routes/health.ts`: `GET /health` liveness route with a 2 s database check.
- `api/src/db/client.ts` (`createDb`), `api/src/db/schema.ts` (`Database`), `api/src/db/migrator.ts` (`createMigrator`), `api/src/db/migrate.ts` (CLI `up` / `down`).
- `api/test/helpers/db.ts` (`assertTestDatabase`, `getTestDb`, `resetDb`) and `api/test/helpers/integration-global-setup.ts` (guard and automatic migration of the test database).
- Unit tests: `api/test/unit/config.test.ts`, `api/test/unit/test-db-guard.test.ts`, `api/test/unit/health.test.ts`.
- Integration test: `api/test/integration/health.test.ts`.
- `web/` workspace: React 18 + Vite placeholder app (`<h1>FitHub</h1>`) with one test.
- `docker-compose.yml` and `docker/initdb/01-create-test-db.sql`: local PostgreSQL 16 with a `fithub` dev database and a `fithub_test` database.
- `README.md`: CI badge, "Getting started", "Running tests", "Configuration", "Project layout".

## How it works
- **AC 1 (pull requests):** Opening, updating or reopening a pull request starts workflow `CI`. Steps run in order: Install, Format, Lint, Typecheck, Migrate test DB, Test, Build, Upload coverage. The result is reported as `CI / checks`.
- **AC 2 (main):** A push to `main` runs the same workflow. The README badge shows the result for `main`.
- **AC 3 (failing test):** A failing test stops the `Test` step. `Build` does not run and `CI / checks` is red.
- **AC 4 (format, lint, type errors):** Each class of error fails its own step (`Format`, `Lint`, `Typecheck`) and turns `CI / checks` red.
- **AC 5 (integration tests):**
  - `GET /health` returns `200 {"status":"ok","db":"ok"}` when the database answers `SELECT 1` within 2 seconds.
  - When the database check fails, the route returns `503 {"status":"error","db":"unreachable"}`. The error detail is logged, not returned.
  - Before the first integration test, the test database is migrated to the latest migration automatically.
  - If the database name in `DATABASE_URL` does not end in `_test`, the run stops before connecting with `Refusing to run integration tests against non-test database "<name>"`.
- **AC 6 (no secrets):** The workflow has no `secrets.` references and no `STRIPE_` variables. It declares `permissions: contents: read`.
- **AC 7 (local command):** `npm run ci` runs the CI chain locally and exits non-zero on the first failing step.

## How to test
**Local:** `docker compose up -d db && npm ci && cp .env.example .env && npm run ci`

Checks: `npm run typecheck`, `npm run lint`, `npm run test:unit -w api`, `npm test -w web`, `npm run build`.

- **AC 1:** Open a pull request. **Verify:** `CI / checks` runs all steps and is green.
- **AC 2:** Push to `main`. **Verify:** a `push` run appears and the README badge shows passing.
- **AC 3:** Add a test with `expect(1).toBe(2)`. **Verify:** the `Test` step fails and `Build` is skipped.
- **AC 4:** Use double quotes, an unused variable, or `const n: number = 'x';`. **Verify:** `Format`, `Lint` or `Typecheck` fails respectively.
- **AC 5:** Run `npm run test -w api`. **Verify:** unit and integration health tests pass. Run `DATABASE_URL=postgres://fithub:fithub@localhost:5432/fithub npm run test:integration -w api`. **Verify:** it aborts with `Refusing to run integration tests against non-test database "fithub"`.
- **AC 6:** Search `ci.yml` for `secrets.` and `STRIPE`. **Verify:** no matches; `permissions: contents: read` is present.
- **AC 7:** Follow the README "Running tests" section on a clean clone. **Verify:** tests pass and `npm run ci` exits 0.

## Deployment notes
**Pre-deployment**
- Confirm the repository is on GitHub and that Actions are enabled.
- Run `npm install` once and commit the generated `package-lock.json`. `npm ci` in CI requires it.
- Replace the placeholder `fithub/fithub` in the README CI badge with the real GitHub owner and repository name.
- Run `npm run format` before merge so the CI `Format` step is green. The format check was not run during development.

**Post-deployment**
- Repository admin: add a branch protection rule on `main` that requires the status check `CI / checks`, a pull request before merging, and up-to-date branches.
- Verify with a deliberately failing test pull request that the merge button is blocked.

**Configuration**
- `DATABASE_URL` (required; `.env` locally, workflow `env` in CI), `PORT` (default `3000`), `NODE_ENV` (default `development`; `test` in CI), `LOG_LEVEL` (default `info`). See `.env.example` and the README.
- CI-only: `TZ=UTC`, `JOBS_ENABLED=false`.

## Known limitations
- The integration tests and the automatic migration have not been run against a live PostgreSQL. The first CI run is the first proof.
- No live GitHub Actions run has been observed yet.
- Coverage is reported but not enforced as a gate.
- Out of scope: deployment automation (CD), load testing, end-to-end browser tests, business tables (first migration comes with US-117), dependency update bots and security scanning.
