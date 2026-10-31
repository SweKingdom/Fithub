import { DomainError, forbidden } from '../../shared/errors.js';

export function classNotFound(): DomainError {
  return new DomainError('CLASS_NOT_FOUND', 'This class does not exist.', 404);
}

export function classAlreadyCancelled(): DomainError {
  return new DomainError('CLASS_ALREADY_CANCELLED', 'This class has already been cancelled.', 409);
}

export function classNotCancellable(): DomainError {
  return new DomainError(
    'CLASS_NOT_CANCELLABLE',
    'This class has already started and can no longer be cancelled.',
    409,
  );
}

export function notOwnClub(): DomainError {
  return forbidden('You can only manage classes for your own club.');
}

export function notClassLead(): DomainError {
  return forbidden('You can only cancel classes that you lead.');
}
