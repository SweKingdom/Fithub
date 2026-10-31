# Changelog

## Unreleased

- {2026-10-31} — US-124 Cancel my booking up to 2 hours before the class: members can cancel their own booking until the configurable cut-off (`BOOKING_CANCEL_CUTOFF_MINUTES`, default 120); the place is freed and a `BookingCancelled` event is raised once. Requires migration 0022.
