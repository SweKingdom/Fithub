# FitHub

[![CI](https://github.com/fithub/fithub/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/fithub/fithub/actions/workflows/ci.yml)

FitHub is a gym class booking app for four clubs: a React web app (`web/`) backed by a Fastify JSON API (`api/`) and a PostgreSQL 16 database. The requirements are in [docs/project_brief.md](docs/project_brief.md) and the architecture in [docs/solution_design.md](docs/solution_design.md).

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

Settings are read from environment variables (`.env` locally, see `.env.example`) and validated at startup in `api/src/config.ts`. An invalid setting stops the API with `Invalid configuration: <VARIABLE>: <reason>`. The message names the variable and never its value.

- `DATABASE_URL` (required): PostgreSQL connection URL. Integration tests default to `postgres://fithub:fithub@localhost:5432/fithub_test` when it is unset.
- `PORT` (default `3000`): port the API listens on.
- `NODE_ENV` (default `development`): `development`, `test` or `production`. `test` silences the API logger.
- `LOG_LEVEL` (default `info`): `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.

### Payments (Stripe)

Payments are off unless `PAYMENTS_ENABLED=true`. When they are off, all other variables in this table are ignored and the startup log says `payments.enabled=false`. When they are on, the log says `payments.enabled=true mode=test` (or `live`), never a key.

| Variable | Description | Default | Required when |
|---|---|---|---|
| `PAYMENTS_ENABLED` | Feature switch for drop-in payments (`true` or `false`). Set to `true` only after US-132, US-133 and US-134 are deployed | `false` | — |
| `STRIPE_SECRET_KEY` | **Secret.** Stripe API key `sk_` or `rk_` + `test` or `live` (restricted key recommended: PaymentIntents Write, Refunds Write, Charges Read). Mode is derived from the prefix | none | `PAYMENTS_ENABLED=true` |
| `STRIPE_PUBLISHABLE_KEY` | Not secret. `pk_test_…` or `pk_live_…`, same mode as the secret key. Returned to the SPA | none | `PAYMENTS_ENABLED=true` |
| `STRIPE_WEBHOOK_SECRET` | **Secret.** `whsec_…` signing secret of this environment's webhook endpoint | none | `PAYMENTS_ENABLED=true` |
| `STRIPE_LIVE_MODE_ALLOWED` | Must be `true` to accept live keys. Set in production only | `false` | — |
| `STRIPE_TIMEOUT_MS` | Per-request timeout for Stripe calls, integer 1000–30000 | `10000` | — |
| `DROP_IN_PRICE_AMOUNT` | Drop-in price in minor units (e.g. cents), integer 1–99999999. Same price for every class and club. Value from the PO | none | `PAYMENTS_ENABLED=true` |
| `DROP_IN_CURRENCY` | ISO 4217 code, 3 letters, normalised to lower case. Value from the PO | none | `PAYMENTS_ENABLED=true` |

Rules:

- Keep `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the host's secret store (or the git-ignored `.env` locally). Never put them in code, tests, logs or CI.
- Use test-mode keys in every non-production environment. Live keys are accepted only where `STRIPE_LIVE_MODE_ALLOWED=true` (production).
- The secret and publishable key must be from the same mode.
- There is one Stripe account for all four clubs.

### Stripe webhook per environment

Register `https://{api-host}/webhooks/stripe` in the Stripe dashboard (test mode for non-production) with exactly these events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.refund.updated`. Use the same API version as the one pinned in `api/src/modules/payments/stripe-gateway.ts`. Store the endpoint's signing secret as `STRIPE_WEBHOOK_SECRET`.

### Testing Stripe webhooks locally

```
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Put the `whsec_…` value it prints in your local `.env` as `STRIPE_WEBHOOK_SECRET`.

## Importing legacy members

An operator-only command line tool loads the existing members once, without duplicates (US-135). There is no HTTP route and no screen. It needs `DATABASE_URL` in the environment, the migrations applied (`npm run db:migrate`) and the clubs seeded.

### Import file

Convert FitHub's export to this layout first. UTF-8 CSV (BOM allowed), one header row, delimiter `,` (use `--delimiter ";"` for Excel exports). Header names are case-insensitive; unknown columns are ignored.

| Column | Required | Rule |
|---|---|---|
| `email` | yes | Trimmed and lower-cased; must be a valid address. Two rows with the same email are the same member |
| `full_name` | yes | Trimmed, inner spaces collapsed; 1–200 characters |
| `member_type` | yes | Looked up in the mapping file (below); a value that is not in it is rejected, there is no default |
| `legacy_member_number` | no | 1–64 characters. Kept on the member and as an alias for every number of a merged member (used by the credit import) |
| `home_club_code` | no | Must be an existing club code (upper-cased); empty = no home club |

### Mapping file

`api/seed/member-type-map.json` is a JSON object `{ "<source value>": "regular" | "drop_in" }`, compared ignoring case and spaces. Copy `api/seed/member-type-map.example.json` and fill in the values confirmed by the product owner. It holds no personal data and is reviewed by pull request. Use `--type-map <path>` for another file.

### Commands

Run from the repository root. Keep the files in `api/import-data/` and the reports in `api/import-output/`; both are git-ignored.

```
npm run import:members -w api -- --file import-data/members.csv --dry-run
npm run import:members -w api -- --file import-data/members.csv
```

| Option | Meaning |
|---|---|
| `--file <path>` | Import file (required) |
| `--type-map <path>` | Mapping file, default `seed/member-type-map.json` |
| `--delimiter <char>` | One character, default `,` (`\t` for tab) |
| `--dry-run` | Same reports, nothing is written |
| `--out-dir <dir>` | Report folder, default `import-output/members-<UTC timestamp>` |

Rules:

- The whole file is written in one transaction. Any file error, mapping error, database error or unbalanced count leaves the database unchanged and exits with code 1. Rejected rows are not a failure (exit 0).
- Same email with the same name, membership type and home club: merged into one member (listed in `import-merges.csv`). Same email with different data: all those rows are rejected. An email of a staff account is never changed.
- Re-running the same file changes nothing. A corrected file updates the matched members in place.
- Imported members get role `member` and no password; they cannot sign in until the onboarding question (US-118) is answered.

### Reports

| File | Content |
|---|---|
| `import-summary.json` | Counts, `rejectedByReason`, file hash, `dryRun`, `balanced`. `sourceRows` = `inserted` + `updated` + `unchanged` + `merged` + `rejected`. No personal data |
| `import-rejections.csv` | `line,reason,message,email,legacy_member_number` |
| `import-merges.csv` | `line,merged_into_line,email,legacy_member_number` |

Rejection reasons: `INVALID_EMAIL`, `INVALID_NAME`, `UNMAPPED_MEMBER_TYPE`, `INVALID_LEGACY_NUMBER`, `UNKNOWN_CLUB`, `LEGACY_NUMBER_REUSED`, `CONFLICTING_DUPLICATE`, `LEGACY_NUMBER_BELONGS_TO_OTHER_MEMBER`, `EMAIL_USED_BY_STAFF`.

### Clean-up

The import file, the rejection report and the merge report contain personal data. After sign-off, delete `api/import-data/` and `api/import-output/` except the `import-summary.json` you keep as the sign-off record.

## Project layout

- `api/`: Fastify API (`src/`), database migrations (`migrations/`), unit and integration tests (`test/`).
- `web/`: React + Vite single-page app and its tests.
- `docker/` and `docker-compose.yml`: local PostgreSQL with the `fithub` and `fithub_test` databases.
- `.github/workflows/ci.yml`: the CI pipeline.
- `docs/`: project brief and solution design.
