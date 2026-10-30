# FitHub

[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)

FitHub is a gym class booking app: a React web app (`web/`) backed by a Fastify JSON API (`api/`) and a PostgreSQL 16 database. The requirements are in [docs/project_brief.md](docs/project_brief.md) and the architecture in [docs/solution_design.md](docs/solution_design.md).

> Replace `OWNER/REPO` in the badge above with the owner and name of the GitHub repository.

## Getting started

Prerequisites: Node.js 22 (see `.nvmrc`) and Docker.

```sh
docker compose up -d db
npm ci
cp .env.example .env
npm run db:migrate -w api
npm run dev -w api   # API on http://localhost:3000, try GET /health
npm run dev -w web   # web app on http://localhost:5173, proxies /api to the API
```

## Running tests

Prerequisites: Node 22 and Docker.

1. Start the local database (it also creates the `fithub_test` database on first start): `docker compose up -d db`
2. Install the dependencies: `npm ci`
3. Create your local configuration: `cp .env.example .env`
4. Run the tests: `npm test`
5. Run every check that CI runs (format, lint, typecheck, migrate, test, build): `npm run ci`

Integration tests run only against a PostgreSQL database whose name ends in `_test` (default `fithub_test`) and migrate it automatically before the first test. If `DATABASE_URL` points to any other database, the integration run stops with `Refusing to run integration tests against non-test database "<name>"`. Third parties such as Stripe are always mocked in tests.

If the `fithub_test` database is missing (the database volume was created before the init script existed), run `docker compose down -v` and `docker compose up -d db` to re-create it.

Useful commands:

- `npm run test:unit -w api` runs the API unit tests only.
- `npm run test:integration -w api` runs the API integration tests only.
- `npm run format` fixes formatting; `npm run format:check` only checks it.

## Continuous integration

The GitHub Actions workflow `CI` (`.github/workflows/ci.yml`) runs on every pull request and on every push to `main`. Its single job `checks` runs: install, format, lint, typecheck, migrate the test database, test, build. It uses a throwaway PostgreSQL service container and no secrets. Repository admins should require the status check `CI / checks` in the branch protection rule for `main`.

## Configuration

Variables are read from the environment; locally they come from `.env` (git-ignored, see `.env.example`).

- `DATABASE_URL` (required): PostgreSQL connection URL. Integration tests default to `postgres://fithub:fithub@localhost:5432/fithub_test` when it is unset.
- `PORT` (default `3000`): port the API listens on.
- `NODE_ENV` (default `development`): `development`, `test` or `production`. `test` silences the API logger.
- `LOG_LEVEL` (default `info`): `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.

## Project layout

- `api/`: Fastify API (`src/`), database migrations (`migrations/`), unit and integration tests (`test/`).
- `web/`: React + Vite single-page app and its tests.
- `docker/` and `docker-compose.yml`: local PostgreSQL with the `fithub` and `fithub_test` databases.
- `.github/workflows/ci.yml`: the CI pipeline.
- `docs/`: project brief and solution design.
