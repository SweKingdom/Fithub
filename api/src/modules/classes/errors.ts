import { DomainError } from '../../shared/errors.js';

export function classNotFound(): DomainError {
  return new DomainError('CLASS_NOT_FOUND', 'This class does not exist.', 404);
}

export function classCancelled(): DomainError {
  return new DomainError('CLASS_CANCELLED', 'This class has been cancelled.', 409);
}
