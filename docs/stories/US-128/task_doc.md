# US-128: Automatically give the first free place to the waiting list
**Status:** Ready for UAT · **Category:** development · **Points:** 3 · **Sprint:** n/a

## Summary
When a place in a class becomes free, the first member on the waiting list is booked into it automatically, without any action from that member. Regular members get a confirmed booking; drop-in members get a booking that waits for payment in the app. A maintenance job runs every interval as a safety net and also closes the waiting list at the configured cut-off.

## What was built
- `promoteNext` (`api/src/modules/waitlist/promotion.ts`): promotes at most one member per freed place inside the caller's transaction, under the class row lock.
- `checkPromotionEligibility`: skips members who already hold an active booking on the class (removes their entry). Block and credit checks are added by US-130 and US-125.
- `notifyPromotions`: sends one `waitlist_promoted` event per promotion after commit; errors are logged, not thrown.
- `runWaitlistMaintenance` (`api/src/modules/waitlist/maintenance.ts`, job `waitlist-maintenance`): expires waiting entries after the cut-off and promotes into free places (safety net).
- `Notifier` port and `LogNotifier` (`api/src/notifications/notifier.ts`): default channel writes a structured log line.
- `startIntervalJobs` (`api/src/jobs/runner.ts`): interval runner, one run at a time per job, errors logged.
- `server.ts` starts and stops the jobs when `JOBS_ENABLED=true`. `app.ts` accepts a `notifier` option.
- Config: `WAITLIST_PROMOTION_CUTOFF_MINUTES`, `WAITLIST_JOB_INTERVAL_SECONDS`, `JOBS_ENABLED` (see `.env.example`).
- Provisional migrations `0005_create_waitlist_entry` and `0006_booking_source_and_booked_at` (`IF NOT EXISTS`).
- Test helpers: `FakeNotifier`, `createWaitlistEntry`.

## How it works
- **AC 1 (first in line):** a freed place gives the `waiting` entry with the lowest `queue_seq` a booking with status `confirmed` (regular member), source `waitlist`. The entry becomes `promoted` with `promoted_booking_id` and `ended_at`.
- **AC 2 (ineligible member):** if the first member already has an active booking on the class, the entry becomes `removed` and the next member is tried.
- **AC 3 (no double allocation):** promotion takes the class lock. Parallel cancellations promote different members. A leave racing a promotion ends in exactly one state (`removed` or `promoted`). Active bookings never exceed capacity.
- **AC 4 (notification):** each promotion calls the notifier once, after commit, with `{ type, memberId, bookingId, classId }`. A rollback sends nothing. A notifier failure is logged and the promotion stays.
- **AC 5 (drop-in):** a drop-in member is promoted with status `pending_payment`, source `waitlist`. The place counts as taken.
- **AC 6 (cut-off and expiry):** promotion stops when `now >= start_at − WAITLIST_PROMOTION_CUTOFF_MINUTES`. The maintenance job then sets remaining `waiting` entries to `expired`. Default cut-off is 0.
- **AC 7 (safety net):** the job promotes into any class that has a free place and a waiting member. Running it again changes nothing.
- **AC 8 (no-op):** on a full class or an empty list, nothing changes and the notifier is not called.

## How to test
- Automated: `npm run typecheck && npm run lint && npm run test:unit -w api && npm test -w web && npm run build`.
- Integration (needs PostgreSQL): `docker compose up -d db && npm run db:migrate -w api && npm run test:integration -w api -- waitlist.promotion waitlist.maintenance`.
- AC 1: fill a class, put A then B on the waiting list, cancel one booking. **Verify:** A has a `confirmed` booking with source `waitlist`; A's entry is `promoted`; B is position 1; active bookings = capacity.
- AC 2: give A an active booking, then free a place. **Verify:** A's entry is `removed` and B is promoted.
- AC 3: run the parallel-cancellation tests. **Verify:** A and B are promoted, C stays `waiting`, active bookings = 2.
- AC 4: check the API log after a promotion. **Verify:** one `notification.waitlist_promoted` line with ids only; no call after a rollback; a failing notifier is logged as `notification.failed`.
- AC 5: put a drop-in member first and free a place. **Verify:** booking is `pending_payment` with source `waitlist`.
- AC 6: let a class pass its start time and run the job. **Verify:** entries are `expired` with `ended_at`. With cut-off 30 and a class 20 minutes away, nobody is promoted.
- AC 7: free a place with SQL, then run the job twice. **Verify:** first waiting member is promoted; second run changes nothing.
- AC 8: run `promoteNext` on a full class or empty list. **Verify:** no rows change; notifier not called.

## Deployment notes
- **Pre-deploy (optional):** set `WAITLIST_PROMOTION_CUTOFF_MINUTES` (default 0) and `WAITLIST_JOB_INTERVAL_SECONDS` (default 60, minimum 10). Defaults stand per the product owner's answer.
- **Pre-deploy:** keep `JOBS_ENABLED=true` on API instances (default; `false` under `NODE_ENV=test`).
- **Post-deploy:** run `npm run db:migrate -w api`.
- Migrations 0005 and 0006 are provisional. Drop the duplicates when US-122 and US-127 merge. `allowUnorderedMigrations` is enabled.
- **Release constraint:** drop-in promotion must not go live before US-132 (payment UI).
- Verify: the API log shows `waitlist.expired` once per interval; a freed place with a waiting list produces `waitlist.promoted` and `notification.waitlist_promoted`.

## Known limitations
- `cancelBooking` (US-124) is not on this branch, so promotion is not yet triggered on member cancellation. The maintenance job covers it within one interval until US-124 wires `promoteNext`.
- US-132 and US-133 failure/expiry transactions must call `promoteNext` once they merge; until then the job covers these within one interval.
- Integration tests were written but not run in this pass (no database in `run_checks`). They must run against `fithub_test` before merge.
- Notifications are log-only until a channel is chosen (later story).
- Out of scope: more than one promotion per freed place, offer/accept flow, real email/SMS/push, credit check (US-125), block check (US-130), class-cancellation handling (US-126), capacity changes.
- Assumptions to confirm with the product owner: cut-off default 0, drop-in promotion as `pending_payment`, in-app plus log notification, blocked members keep their queue place.
