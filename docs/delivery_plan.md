# FitHub – Delivery Plan

## Summary
- Scope of this batch: 12 items (2 tasks, 10 stories). 10 items are planned and moved to `To Do`. 2 items (US-135, US-136) are **held** because they are in `Requires additional information`; they are shown here as proposed only.
- Planned points: **45** (10 items). Proposed points incl. held items: **53** (US-135 5 + US-136 3 held).
- Sprints: **4** (2 weeks each, capacity 20 pts). Sprint 1 = 10 pts, Sprint 2 = 16 pts, Sprint 3 = 18 pts, Sprint 4 = 8 pts (held items excluded).
- Key risks: prerequisite stories outside this batch (US-117, US-118, US-122, US-125) must be sequenced before the stories that depend on them; Stripe test-environment availability; held import stories lack refinement.
- Project checks: no automated checks are configured yet. TK-119 is the first step to set them up; no check results are claimed in this plan.

## Sprint plan

| Sprint | Stories | Points | Goal |
|---|---|---|---|
| 1 | TK-119, TK-131, US-120 | 10 | Repository and CI skeleton in place; Stripe configuration ready; classes can be created with validation. |
| 2 | US-121, US-123, US-124, US-127 | 16 | Members browse the two-week schedule; members see only their own bookings; cancellation up to 2 h before class; waiting list join/leave. |
| 3 | US-132, US-133, US-134 | 18 | Drop-in payments via Stripe before confirmation, pending/retry when Stripe is down, refunds on cancellation. |
| 4 | US-135*, US-136* (held) | 8 | Member and credit import (only once refinement is complete). |

\* Held: not yet moved to `To Do`; planned into Sprint 4 only after refinement.

## Rank (global build order)

| Rank | Code | Pts | Sprint | Priority | MoSCoW | WSJF | Depends on |
|---|---|---|---|---|---|---|---|
| 1 | TK-119 | 3 | 1 | 1 | Must | 6.67 | – |
| 2 | TK-131 | 2 | 1 | 2 | Must | 8.5 | – |
| 3 | US-120 | 5 | 1 | 1 | Must | 3.4 | TK-119 |
| 4 | US-121 | 5 | 2 | 2 | Must | 3.0 | US-120 |
| 5 | US-123 | 3 | 2 | 1 | Must | 5.67 | US-118 (outside batch) |
| 6 | US-124 | 3 | 2 | 1 | Must | 4.67 | US-122 (outside batch) |
| 7 | US-127 | 5 | 2 | 3 | Should | 2.4 | US-120 |
| 8 | US-132 | 8 | 3 | 1 | Must | 2.875 | TK-131 |
| 9 | US-133 | 5 | 3 | 2 | Must | 3.4 | US-132 |
| 10 | US-134 | 5 | 3 | 1 | Must | 4.0 | US-132, US-124 |
| 11 (held) | US-135 | 5 | 4 (proposed) | 2 (proposed) | Should (proposed) | 3.0 | US-118 (outside batch) |
| 12 (held) | US-136 | 3 | 4 (proposed) | 2 (proposed) | Should (proposed) | 5.0 | US-135, US-125 (outside batch) |

WSJF = (business value + time criticality + risk reduction) / points. Scores are planner estimates for this batch.

## Critical path
1. TK-119 (CI skeleton) → US-120 (create class) → US-121 (schedule view)
2. TK-131 (Stripe config) → US-132 (pay before confirmation) → US-133 (pending/retry) and US-134 (refund, also needs US-124)
3. US-135 (import members) → US-136 (import credits) – held

Longest chain inside this batch: TK-131 → US-132 → US-134 (3 steps, Sprints 1–3).

## Milestones
- **MVP (class booking core):** end of Sprint 2 for schedule, own-bookings and cancellation; requires US-117, US-118, US-122 completed earlier.
- **Payments ready (UAT candidate):** end of Sprint 3.
- **Import complete / UAT:** end of Sprint 4, after refinement of US-135 and US-136.
- **Go-live:** not scheduled; to be set after UAT and release decisions.

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Prerequisites outside this batch (US-117, US-118, US-122, US-125) are not sequenced here | Sprint 2–3 items cannot start | Confirm that those items are planned in Sprint 1–2 with earlier ranks before the sprint starts. |
| US-135 and US-136 in `Requires additional information` | Sprint 4 scope unknown | Requirements to complete refinement; planner to move them to `To Do` only after `Ready for Sprint`. |
| Stripe sandbox or webhook unavailable | Payment stories blocked | Use test keys from TK-131; keep US-133 pending/retry logic to handle outages. |
| US-132 is the largest story (8 pts) | Sprint 3 overrun | Split by happy path and failure path if velocity is below plan. |
| Refund rules tied to class cancellation (US-134) | Incorrect refunds | Cover refund cases with tests before sign-off. |

## Assumptions
- Sprint capacity is 20 points per 2-week sprint (default).
- Points, MoSCoW and priorities are planner estimates based on the backlog text and the refinement notes; they are not confirmed by the customer.
- Stories outside this batch (US-117, US-118, US-122, US-125 and others) are planned separately and must precede the dependants listed above.
- No automated checks are configured yet; this plan does not assume that any tests pass.
