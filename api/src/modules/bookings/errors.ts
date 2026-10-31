import { DomainError } from '../../shared/errors.js';

export function classNotFound(): DomainError {
  return new DomainError('CLASS_NOT_FOUND', 'This class does not exist.', 404);
}

export function classNotBookable(): DomainError {
  return new DomainError('CLASS_NOT_BOOKABLE', 'This class can no longer be booked.', 409);
}

export function alreadyBooked(): DomainError {
  return new DomainError('ALREADY_BOOKED', 'You have already booked this class.', 409);
}

export function classFull(): DomainError {
  return new DomainError('CLASS_FULL', 'This class is full. You can join the waiting list.', 409);
}

export function onlyMembersCanBook(): DomainError {
  return new DomainError('FORBIDDEN', 'Only members can book classes.', 403);
}
