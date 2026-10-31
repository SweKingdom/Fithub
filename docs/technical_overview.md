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

## Class schedule (US-121)

**Endpoint:** `GET /api/classes` (sign-in required; 401 `UNAUTHENTICATED` otherwise, checked before query validation).

**Query:** `clubId` (optional UUID; non-UUID → 400 `VALIDATION_ERROR` on `clubId`), `from` / `to` (optional ISO 8601 date-times with offset; clamped to the window; `from` ≥ `to` → 400 on `to`).

**Window:** `SCHEDULE_WINDOW_DAYS` = 14, computed in `schedule-window.ts` (`computeWindow`): now < `startAt` ≤ now + 14 days. Started classes are never returned.

**Free places:** max(0, capacity − count of bookings with status `confirmed` or `pending_payment`). Computed in one statement in `repository.ts` (`findSchedule`).

**Member status:** `myBookingStatus`, `myBooking` (`{ id, status }`) are filled only for a signed-in member's own booking. Staff get `none` / `null`. `myWaitlist` is `null` until US-127.

**Unknown club:** 404 `CLUB_NOT_FOUND` (`clubs/errors.ts`).

**Response:** `items` sorted by `startAt`, then name, then id. Header `Cache-Control: no-store`. Fields never include `instructorId`, `createdBy`, `memberId` or other members' ids.

**Web:** `SchedulePage` (club selector, `?clubId` sync), `ClassCard`, `lib/time.ts` (`formatClubTime`, `clubDateKey`, `formatClubDay`; uses `club.timezone`), `api/classes.ts`, `api/clubs.ts` (`GET /api/clubs`).

**Deployment:** no migration and no configuration. `classRoutes({ db, clock })` must be registered in the `/api` scope by `buildApp`. The `/schedule` route, the `/` redirect and the header link must be added at merge with US-118/US-120.

**Status:** implemented but not compiled or tested; no project checks are configured.
