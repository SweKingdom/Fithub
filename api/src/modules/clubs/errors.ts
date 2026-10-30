import { DomainError } from '../../shared/errors.js';

export function clubNotFound(): DomainError {
  return new DomainError('CLUB_NOT_FOUND', 'Club not found.', 404);
}
