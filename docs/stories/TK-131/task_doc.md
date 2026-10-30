# TK-131: Configure Stripe account, API keys and webhook secret
**Status:** Ready for UAT · **Category:** Configuration · **Points:** 2 · **Sprint:** not recorded

## Summary
The API now reads the Stripe and drop-in price settings from environment variables and validates them at startup. Payments stay off unless `PAYMENTS_ENABLED=true`, and live keys are refused unless the environment explicitly allows them. No customer-facing behaviour changes in this story.

## What was built
- `api/src/config.ts`: zod schema for the payment variables, cross-field rules in `superRefine`, and the `config.payments` object (`enabled`, `mode`, Stripe keys, `stripeTimeoutMs`, `dropInPriceAmount`, `dropInCurrency`).
- `api/src/server.ts`: logs `payments.enabled=<bool>` and `mode=<test|live>` once at startup. Key values are never logged. Exits with code 1 on a configuration error.
- `api/test/unit/config.test.ts`: tests for AC 2–4, including the fix for `STRIPE_LIVE_MODE_ALLOWED` handling when payments are off.
- `.env.example`: variable names with placeholder comments only.
- `README.md`: "Payments (Stripe)" configuration table and the local webhook note (`stripe listen --forward-to localhost:3000/webhooks/stripe`).
- `.gitignore`: ignores `.env`.

## How it works
- **AC 1 – Settings documented:** README and `.env.example` list every variable with description, default and "required when". No real key is stored in either file.
- **AC 2 – Fail fast when payments are on:** with `PAYMENTS_ENABLED=true`, a missing required variable stops startup with `Invalid configuration: <VAR>: required when PAYMENTS_ENABLED=true`. A malformed value stops startup with `<VAR>: invalid format`. The message names the variable and never echoes its value.
- **AC 3 – Live-mode guard:** a `sk_live_` or `rk_live_` key without `STRIPE_LIVE_MODE_ALLOWED=true` stops startup with `STRIPE_SECRET_KEY: live keys are not allowed in this environment`. A secret key and publishable key from different modes stop startup with `STRIPE_PUBLISHABLE_KEY: mode does not match STRIPE_SECRET_KEY`.
- **AC 4 – Disabled by default:** with no payment variables, the API starts with `config.payments.enabled = false` and logs `payments.enabled=false`. With `PAYMENTS_ENABLED=false`, all Stripe variables are ignored, including `STRIPE_LIVE_MODE_ALLOWED`. With payments on, it logs `payments.enabled=true mode=test|live`.
- **AC 5 – Webhook registered (manual):** Stripe test-mode dashboard endpoint and signing secret. Not verified in this review (see Known limitations).
- **AC 6 – No secrets in the repository:** `git grep` for live and test key patterns and `whsec_` patterns must return nothing. Test fixtures use `sk_test_fake`, `pk_test_fake`, `whsec_fake`.

## How to test
**Automated:** `npm test -w api -- config` (not yet runnable, see Known limitations).

- AC 1 — Open `README.md` and `.env.example`. **Verify:** all eight variables are listed with description, default and "required when", and no real values appear.
- AC 2 — Start the API with `PAYMENTS_ENABLED=true` and no `STRIPE_SECRET_KEY`. **Verify:** the process exits with `Invalid configuration: STRIPE_SECRET_KEY: required when PAYMENTS_ENABLED=true`.
- AC 3 — Start with `STRIPE_SECRET_KEY=sk_live_fake` (other variables valid, no live flag). **Verify:** startup fails with "live keys are not allowed in this environment".
- AC 4 — Start with no payment variables. **Verify:** the API starts and logs `payments.enabled=false`.
- AC 5 — Open Stripe dashboard → Developers → Webhooks (test mode). **Verify:** the endpoint for the test environment lists the four events.
- AC 6 — Run the `git grep` command from AC 6. **Verify:** no matches.

## Deployment notes
- **Pre-deploy:** none in code. Create restricted test-mode keys and the webhook endpoint in the Stripe dashboard, then store the values in the test environment's secret store (see the manual steps in the story).
- **Configuration:** `PAYMENTS_ENABLED` stays `false` until US-132, US-133 and US-134 are deployed. Before setting it to `true`, `DROP_IN_PRICE_AMOUNT` and `DROP_IN_CURRENCY` need the PO's values.
- **Production only:** `STRIPE_LIVE_MODE_ALLOWED=true`. Do not set it in other environments.
- **Migrations:** none. No new dependency (the `stripe` SDK comes with US-132).

## Known limitations
- No automated checks have been run. The project has no `package.json`, zod or vitest on the branch until TK-119 is merged. AC 1–4 and 6 were checked by static review only.
- AC 5 (Stripe dashboard) is manual and needs access to FitHub's Stripe account. The account owner is still to be confirmed with the PO.
- Open questions for the PO: the drop-in price and currency values, and whether Stripe receipts are sent to customers.
- Out of scope: Stripe Connect or one account per club, Stripe API calls and webhook handling (US-132–US-134), automated provisioning of Stripe settings.
- When TK-119 merges, `payments` should be folded into its existing config and server entry point.
