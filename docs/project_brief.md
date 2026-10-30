# FitHub – Gym Class Booking: Project Brief

Source: *fithub-requirements.pdf* (customer requirements document, sections 1–7).

## 1. Goal
Replace phone/front-desk booking and the spreadsheet class lists used by FitHub's four clubs with a **web app backed by an API** for booking group classes (spinning, yoga, strength). The goal is to stop overbooking and half-empty classes, track who does not show up, and take payment from drop-in members through Stripe.

## 2. Scope
| Area | In scope | Source |
|---|---|---|
| Class schedule | Instructors/club managers create and cancel classes; members view a 2-week schedule filtered by club; validation of class data | §2.1, §6 |
| Booking | Book a free place, reject double bookings, waiting list with automatic promotion, cancellation up to 2 h before start, no-show booking block | §2.2 |
| Attendance | Record who attended / did not show (needed for the no-show rule and the report) | §1, §2.2, §5 (implied) |
| Payments | Drop-in members pay via Stripe before confirmation; pending + retry when Stripe is unavailable | §3 |
| Data migration | Import existing members and class credits without duplicates | §4 |
| Reporting | Weekly attendance and no-show report per class for club managers | §5 |
| Access | Role-based permissions; members only see/change their own bookings | §6 |

## 3. Personas
| Persona | Description | Main needs |
|---|---|---|
| **Member** | A FitHub member with a membership and (possibly) class credits | See schedule, book/cancel, join waiting list, see own bookings |
| **Drop-in member** | A member who pays per class | Same as Member + pay via Stripe before booking is confirmed |
| **Instructor** | Leads group classes at a club | Create/cancel classes, record attendance (assumed) |
| **Club manager** | Manages one club | Create/cancel classes, weekly attendance/no-show report |
| **Front desk staff** (as-is) | Currently takes bookings by phone/desk | Not a defined role in the new system – to be confirmed |

## 4. Business processes

### 4.1 As-is
1. Member phones or visits the front desk to book a class.
2. Staff writes the member on the class list in a spreadsheet.
3. Capacity is not enforced → classes overbooked or half empty.
4. Attendance/no-shows are not recorded.

### 4.2 To-be: Class scheduling
1. Instructor or club manager signs in and creates a class (club, name, start time, duration, max places).
2. System validates (name required, places > 0) and publishes the class.
3. Members browse the schedule for the next 14 days, filtered by club.
4. Instructor/club manager may cancel a class (effect on bookings: open question).

### 4.3 To-be: Booking (member)
1. Member selects a class with free places and books.
2. System checks: member not blocked, not already booked, place available.
3. Regular member → booking confirmed (credit consumption: open question).
4. Drop-in member → Stripe payment → booking confirmed on success; if Stripe is unavailable the booking is kept `pending_payment`, retried, and the member sees a clear message.
5. If the class is full → member may join the waiting list.
6. When a place frees up → first waiting member gets it automatically.
7. Member may cancel up to 2 hours before start; afterwards cancellation is refused.

### 4.4 To-be: Attendance & no-show policy
1. After/at the class, attendance is recorded per booking (`attended` / `no_show`) — mechanism open question.
2. Members exceeding the no-show threshold within a month are blocked from booking for 7 days (threshold TBD).

### 4.5 To-be: Reporting
1. Club manager opens the weekly report: attendance and no-shows per class for their club.

### 4.6 Data migration (one-off)
1. Extract existing members and class credits from current source.
2. Deduplicate, load, reconcile counts and credit totals.

## 5. Data entities (first cut)
| Entity | Key attributes |
|---|---|
| Club | id, name (4 clubs) |
| User | id, email (unique), full name, role (`member`, `instructor`, `club_manager`), member type (`regular`, `drop_in`), home club |
| Class | id, club, name, start time, duration (min), capacity, status (`scheduled`, `cancelled`), instructor, created by |
| Booking | id, class, member, status (`pending_payment`, `confirmed`, `cancelled`), attendance (`unknown`, `attended`, `no_show`) |
| Waiting list entry | id, class, member, position/joined at, status (`waiting`, `promoted`, `removed`) |
| Payment | id, booking, Stripe PaymentIntent id, amount, currency, status, attempts, next retry |
| Credit balance / ledger | member, balance, transactions |
| Booking block | member, start, end, reason |

## 6. Integrations
| System | Purpose | Notes |
|---|---|---|
| Stripe Payments API | Charge drop-in members per class | PaymentIntents + webhook; retry on unavailability |
| Legacy source (spreadsheet/member data) | One-off import of members and credits | Format unknown – open question |
| Email/notification (assumed) | Waiting-list promotion, class cancellation | Channel not specified – open question |

## 7. Non-functional requirements
- **Consistency:** capacity must never be exceeded, even with concurrent bookings (transactional/locked place allocation).
- **Idempotency:** payment retries and imports must not create duplicate charges or duplicate members.
- **Security:** role-based authorisation on every API endpoint; members can only access their own bookings; Stripe secrets stored outside code.
- **Usability:** clear, human-readable error messages for all rejections (validation, double booking, full class, blocked, cancellation window, payment pending).
- **Time handling:** times stored in UTC, displayed in club local time (assumed single time zone – to confirm).
- **Quality:** the project has no automated checks configured yet – a CI test pipeline is part of the backlog.

## 8. Assumptions (to be confirmed)
- Every class belongs to exactly one club (implied by "filtered by club").
- The class instructor defaults to the user who creates it when that user is an instructor.
- "Coming two weeks" = now until now + 14 days.
- A cancelled booking frees the place immediately and triggers waiting-list promotion.
- Times are stored in UTC.

## 9. Open questions (recorded with ask_human)
No-show threshold and month window · attendance capture · waiting-list promotion rules and notifications · class credits semantics · drop-in price/currency · Stripe retry policy and place hold · refunds on cancellation · class cancellation effects · authentication/account creation · migration source & dedup key · report delivery/week definition · club master data.

## 10. Out of scope
- Personal training sessions
- Mobile app (native)
- Instructor payroll
