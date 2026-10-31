import { DomainError } from '../../shared/errors.js';

export function noCredits(): DomainError {
  return new DomainError('NO_CREDITS', 'You have no class credits left.', 409);
}
