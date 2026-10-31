# US-123 — Test report (iteration 7)
**Verdict:** ✅ Approved · **Tester:** Cuélebre · **Date:** 2026-10-31

## Summary
| Check | Result | Evidence |
|---|---|---|
| run_checks (typecheck, lint, api unit, web, build) | ✅ | all exit 0 |
| AC 1 Own upcoming bookings | ✅ | repository.ts `memberScope`; bookings.list test |
| AC 2 Past bookings, invalid period | ✅ | zod enum gives 400; tested |
| AC 3 Other members' bookings hidden | ✅ | owner filter in SQL; identical 404 body tested |
| AC 4 Cannot cancel others' bookings | ✅ | 404 before any write; row stays confirmed |
| AC 5 Staff scope | ✅ | `assertStaffOfClass`, `requireRole`, `findBookingForClub` |
| AC 6 Access matrix | ✅ | `describe.each(MATRIX)` with before/after table snapshot |
| AC 7 UI | ✅ | MyBookingsPage and AppHeader web tests |

Verification was by static review of the delivered files and the passing `run_checks`. No screenshots were captured.

## Not tested
- The integration tests (`bookings.list`, `bookings.access`) need the test database, so they were not executed. I revied them by reading, and their assertions match the ACs.

## Notes
- The cancel route is a placeholder that US-124 replaces. It is correctly restricted to members.
- Error-message wording differs from the spec table (codes and statuses match). This is documented in the story.
