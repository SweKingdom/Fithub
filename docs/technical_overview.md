# Technical overview

## Configuration: payments (Stripe)

Payment settings are read from environment variables in `api/src/config.ts` (zod schema, validated at startup). Payments are off by default.

| Variable | Format | Default | Required when |
|---|---|---|---|
| `PAYMENTS_ENABLED` | `true` \| `false` | `false` | — |
| `STRIPE_SECRET_KEY` | `sk_`/`rk_` + `test`/`live` + key | none | `PAYMENTS_ENABLED=true` |
| `STRIPE_PUBLISHABLE_KEY` | `pk_` + `test`/`live` + key | none | `PAYMENTS_ENABLED=true` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_` + value | none | `PAYMENTS_ENABLED=true` |
| `STRIPE_LIVE_MODE_ALLOWED` | `true` \| `false` | `false` | — |
| `STRIPE_TIMEOUT_MS` | integer 1000–30000 | `10000` | — |
| `DROP_IN_PRICE_AMOUNT` | integer 1–99999999 (minor units) | none | `PAYMENTS_ENABLED=true` |
| `DROP_IN_CURRENCY` | ISO 4217 (3 letters), stored lower case | none | `PAYMENTS_ENABLED=true` |

Rules:
- `PAYMENTS_ENABLED` not `true`: all other payment variables are ignored and not validated. `config.payments.enabled = false`, Stripe fields are `null`.
- Secret and publishable key must be the same mode (`test` or `live`).
- Live keys are accepted only when `STRIPE_LIVE_MODE_ALLOWED=true`. Set this only in production.
- All issues are reported together in one startup error: `Invalid configuration: <VAR>: <reason>`. Values are never echoed.
- `server.ts` logs `payments.enabled=<bool>` and, when enabled, `mode=<test|live>` once at startup.
- Secrets live in the host's secret store or a git-ignored `.env` locally. CI has no `STRIPE_*` variables.
- Stripe webhook endpoint: `/webhooks/stripe` (unprefixed route), events `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.refund.updated`. Local testing: `stripe listen --forward-to localhost:3000/webhooks/stripe`.
- No database migration. Stripe SDK and gateway are added by US-132.
