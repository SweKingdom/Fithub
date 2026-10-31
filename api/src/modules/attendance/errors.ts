import { DomainError } from '../../shared/errors.js';

/** 409, not 403: the member may do this again once the block ends (ADR-008). */
export function bookingBlocked(message: string): DomainError {
  return new DomainError('BOOKING_BLOCKED', message, 409);
}
