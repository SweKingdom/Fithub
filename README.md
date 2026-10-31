# FitHub

Gym class booking for four clubs: a React SPA (`web/`) on a Fastify JSON API (`api/`) with PostgreSQL.

## Configuration

Settings are read from environment variables (`.env` locally, see `.env.example`) and validated at startup in `api/src/config.ts`. An invalid setting stops the API with `Invalid configuration: <VARIABLE>: <reason>`. The message names the variable and never its value.

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

Operator-only commands, run on a trusted machine with `DATABASE_URL` set. There is no HTTP route. The import files and the reports contain personal data: keep them in `api/import-data/` and `api/import-output/` (both git-ignored) and delete them after sign-off.

Run order: migrations (including the credit tables, US-125) → member import (US-135) → credit import (US-136). Run the credit import **before** members get access.

### Importing class credits (US-136)

```
npm run import:credits -w api -- --file import-data/credits.csv --dry-run
npm run import:credits -w api -- --file import-data/credits.csv
```

Options: `--file <path>` (required), `--delimiter ","` (one character, `\t` accepted), `--dry-run` (same reports, nothing written), `--out-dir <dir>` (default `import-output/credits-{UTC timestamp}`).

The credits file is UTF-8 CSV (BOM allowed) with a header row. Convert the credit extract from FitHub to this layout first (at most 100,000 rows):

| Column | Required | Rule |
|---|---|---|
| `credits` | column and value | Whole number 0–999,999 |
| `legacy_member_number` | optional column | Resolved through the member import, so merged members work |
| `email` | optional column | Trimmed and lower-cased; used when a row has no number |

At least one of `legacy_member_number` and `email` must be a column, and each row needs a number or an email.

Rules:

- Credits of rows that resolve to the same member are summed into one `migration` ledger row (the later lines are listed in `import-merges.csv`).
- Only regular members can hold credits. Rows for drop-in members and staff are rejected.
- Re-running the same file changes nothing. A member who already has a different migrated total is rejected with `ALREADY_MIGRATED_DIFFERENT_TOTAL` and must be corrected manually.
- A value of 0 writes nothing. Negative, decimal and non-numeric values are rejected.
- Credit expiry dates in the source are ignored.

Reports in the output folder: `import-summary.json` (counts and totals, `balanced` must be `true`), `import-rejections.csv` and `import-merges.csv`. Exit code 0 means the run completed (rejections are not a failure); exit code 1 means a file or database error or totals that do not add up, and nothing was written.
