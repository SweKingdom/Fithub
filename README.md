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
| `PAYMENT_RETRY_BASE_SECONDS` | Base of the exponential backoff when Stripe is unavailable, integer 10–3600. Wait before retry n = base × 2^(n-1): 1, 2, 4, 8 min with the default | `60` | — |
| `PAYMENT_RETRY_MAX_ATTEMPTS` | Total create-intent attempts including the first, integer 1–10. After the last failure the booking is cancelled and the place freed | `5` | — |
| `PAYMENT_HOLD_MINUTES` | How long a `pending_payment` booking keeps its place, counted from booking time and never beyond the class start, integer 5–720 (Stripe idempotency keys live 24 h) | `30` | — |
| `PAYMENT_JOB_INTERVAL_SECONDS` | Interval of the `payment-maintenance` job (retries, hold expiry, intent clean-up), integer 10–600 | `30` | — |

The retry and hold defaults are assumptions pending the PO's confirmation; they are configuration only.

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
