# US-126 — Test report (iteration 2)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| Checks gate | ❌ | `npm run lint` exit 1: Missing script "lint". Typecheck passes. |
| AC 1–8 | ❌ | Endpoint, service, migration, event cause and integration tests not delivered. |
| AC 9 | ❌ | Only the schedule `canCancel` flag exists. |
| AC 10 | ❌ | UI components and tests not delivered. |

## What to do
- Checks gate: land TK-119 or add the root `lint` script, then re-run `run_checks` until it passes.
- AC 1–8: deliver the migration `gym_class_cancelled_ck`, `cancelClass`, `POST /api/classes/:id/cancel`, `BookingCancelled.cause` and `classes.cancel.test.ts`.
- AC 9: deliver the 409 behaviour on a cancelled class and test it.
- AC 10: deliver `CancelClassButton`, the web `cancelClass` function, the `ConfirmDialog` children slot and `CancelClassButton.test.tsx`.
- Process: the story is Blocked on US-120/121/122/124/127/128 and TK-119. Resequence it after them and resubmit once they are on the branch.

## Not tested
None. Everything above failed as not delivered.
