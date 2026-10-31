# US-123 — Test report (iteration 4)
**Verdict:** ❌ Changes requested · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| AC 1 Own upcoming bookings | ❌ | No bookings module on branch |
| AC 2 Past bookings / validation | ❌ | Not implemented |
| AC 3 Other members' bookings hidden | ❌ | access.ts and route missing |
| AC 4 Other members' bookings cannot be changed | ❌ | Cancel route missing |
| AC 5 Staff scope | ❌ | Roster route missing |
| AC 6 Access test matrix | ❌ | bookings.access.test.ts missing |
| AC 7 UI | ❌ | No web workspace |
| Checks gate | ❌ | lint exits 1: Missing script "lint". Typecheck passes. |

## Checks
The branch holds only `api/src/config.ts`, `api/src/server.ts`, `api/test/unit/config.test.ts` and docs. None of the files in the story's Technical Specification exist, so no AC can be met. I did not capture screenshots because there is no feature to show.

## What to do
- Every AC (1–7): the story is not implemented. Rebase or merge the branch onto a base that contains TK-119, US-117, US-118, US-120 and US-122. Then build US-123 as specified.
- Checks gate: add the `lint` script (TK-119 scope), and make `npm run typecheck`, `lint`, `test:unit -w api`, `test -w web` and `build` pass.

## Not tested
None. Every AC failed because the delivery is missing.
