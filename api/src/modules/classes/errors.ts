import { DomainError } from '../../shared/errors.js';

/** Every user-visible message of the create-class flow (US-120). */
export const CLASS_MESSAGES = {
  clubRequired: 'Choose a club.',
  nameRequired: 'A class must have a name.',
  nameTooLong: 'The class name can be at most 100 characters.',
  startInvalid: 'Enter a valid start date and time.',
  startInPast: 'The start time must be in the future.',
  durationInvalid: 'The duration must be a whole number of minutes greater than 0.',
  capacityNotInteger: 'Max places must be a whole number.',
  capacityTooLow: 'A class must have at least one place.',
  instructorInvalid: 'Choose an instructor from this club.',
  instructorMustBeSelf: 'You can only create classes that you lead yourself.',
  roleForbidden: 'Only instructors and club managers can manage classes.',
  ownClubOnly: 'You can only manage classes for your own club.',
} as const;

export function instructorNotInClub(): DomainError {
  return new DomainError('VALIDATION_ERROR', 'Please correct the highlighted fields.', 400, [
    { field: 'instructorId', message: CLASS_MESSAGES.instructorInvalid },
  ]);
}

export function instructorMustBeSelf(): DomainError {
  return new DomainError('VALIDATION_ERROR', 'Please correct the highlighted fields.', 400, [
    { field: 'instructorId', message: CLASS_MESSAGES.instructorMustBeSelf },
  ]);
}
