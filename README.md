# FitHub

Gym class booking for four clubs: a React SPA (`web/`) on a Fastify JSON API (`api/`) with PostgreSQL.

## Local setup

Needs Node.js 22 and Docker.

```
docker compose up -d db          # PostgreSQL 16 with the databases fithub and fithub_test
cp .env.example .env             # DATABASE_URL and TEST_DATABASE_URL match docker-compose.yml
npm install
npm run db:migrate
npm run db:seed:clubs -w api -- --file seed/clubs.example.json
npm run dev -w api               # API on http://localhost:3000
npm run dev -w web               # web app on http://localhost:5173 (proxies /api to the API)
```

Checks (the same chain as CI): `npm run lint`, `npm run typecheck`, `npm run test:unit -w api`, `npm run test:integration -w api` (needs the database; it only runs on a database whose name ends in `_test`), `npm test -w web`, `npm run build`. `npm run ci` runs all of them.

`GET /health` (outside `/api`, no sign-in) answers `200 {"status":"ok","db":"ok"}`, or `503 {"status":"error","db":"unreachable"}` when the database does not answer.

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string. Required by the API and the operator commands | none |
| `TEST_DATABASE_URL` | Database for the integration tests; the name must end with `_test`. Falls back to `DATABASE_URL` | none |
| `PORT`, `HOST` | Where the API listens | `3000`, `0.0.0.0` |
| `LOG_LEVEL` | Log level of the API | `info` |

Seeding clubs: `api/seed/clubs.example.json` shows the format `[{ "code", "name", "timezone" }]`. Running the command again updates name and time zone of existing codes.

## Configuration

Settings are read from environment variables (`.env` locally, see `.env.example`) and validated at startup in `api/src/config.ts`. An invalid setting stops the API with `Invalid configuration: <VARIABLE>: <reason>`. The message names the variable and never its value.

### Sign-in and sessions

Every `/api` endpoint needs a signed-in user, except `POST /api/auth/login` and `POST /api/auth/logout`. Users sign in with email and password; the API keeps an opaque session in PostgreSQL (only the SHA-256 hash of the token is stored) and sends it in the `fithub_session` cookie (`HttpOnly`, `SameSite=Strict`, `Path=/api`, `Secure` when `SESSION_COOKIE_SECURE=true`). The web app and the API must be served from the same origin (a Vite proxy does this in development).

| Variable | Description | Default | Required when |
|---|---|---|---|
| `APP_ORIGIN` | Origin of the web app (no path, no trailing slash). `POST`/`PUT`/`PATCH`/`DELETE` requests with another `Origin` header get 403 | `http://localhost:5173` | `NODE_ENV=production` |
| `SESSION_COOKIE_SECURE` | Send the session cookie over HTTPS only (`true` or `false`). Must be `true` in production | `true` in production, otherwise `false` | — |
| `SESSION_IDLE_TIMEOUT_MINUTES` | A session ends after this many minutes without activity (integer, at least 5) | `720` (12 hours) | — |
| `SESSION_MAX_AGE_HOURS` | A session ends this many hours after sign-in, whatever the activity (integer, at least 1) | `168` (7 days) | — |
| `AUTH_SCRYPT_COST` | scrypt cost `N` for new password hashes: a power of two, at least 16384. Stored in each hash, so it can be raised later. Tests and CI use `16384` | `131072` | — |
| `LOGIN_RATE_LIMIT_MAX` | Sign-in attempts per email and IP address within the window; the next one gets 429 (integer, at least 1) | `10` | — |
| `LOGIN_RATE_LIMIT_WINDOW_MINUTES` | Length of that window in minutes (integer, at least 1) | `15` | — |
| `TRUST_PROXY` | Set to `true` behind a reverse proxy or load balancer so the limit uses the client's IP address | `false` | — |

Rules:

- The session lifetimes (12 hours idle, 7 days maximum) and the sign-in method (email + password) are assumptions until the product owner confirms them.
- Passwords have at least 12 characters. Wrong password, unknown email and an account without a password all answer `401 INVALID_CREDENTIALS` with the same message.
- Sessions, passwords and tokens are never written to the log. Self-registration, invitations and password reset are not part of this version: operators create accounts (below).

### Creating accounts (operator)

Run from the repository root. They need `DATABASE_URL` in the environment (or in `.env`), the migrations applied (`npm run db:migrate`) and the clubs seeded. The password is read from standard input and is never accepted as an argument, so it stays out of the shell history and the process list.

```
echo "<password, at least 12 characters>" | npm run user:create -w api -- --email anna@example.com --name "Anna Berg" --role instructor --club <CLUB CODE> --password-stdin
echo "<password>" | npm run user:set-password -w api -- --email anna@example.com --password-stdin
```

| Option | Meaning |
|---|---|
| `--email` | Email address; stored trimmed and lower-case. Must be unique ignoring letter case |
| `--name` | Full name, 1–200 characters (`create` only) |
| `--role` | `member`, `instructor` or `club_manager` (`create` only) |
| `--club` | Club code. Required for `instructor` and `club_manager`; optional home club for a member |
| `--member-type` | `regular` or `drop_in`. Required for a member, not allowed for staff |
| `--password-stdin` | Required: read the password from standard input |

Each command prints one line and exits with code 0. These cases print one line, exit with code 1 and change nothing: duplicate email, unknown club code, staff without `--club`, member without `--member-type`, staff with `--member-type`, password shorter than 12 characters, unknown email (`set-password`). `user:set-password` also ends every session of that user.

#### Creating the first staff account

After the first deployment there is nobody who can sign in. Create one club manager per club, then hand over the password through a secure channel:

```
echo "<password>" | npm run user:create -w api -- --email manager@example.com --name "Name" --role club_manager --club <CLUB CODE> --password-stdin
```

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
