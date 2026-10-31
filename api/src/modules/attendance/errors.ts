import { DomainError, type FieldError } from '../../shared/errors.js';

export function attendanceNotOpen(): DomainError {
  return new DomainError('ATTENDANCE_NOT_OPEN', 'Attendance can be recorded once the class has started.', 409);
}

export function attendanceClosed(): DomainError {
  return new DomainError(
    'ATTENDANCE_CLOSED',
    'Attendance for this class can no longer be changed. Ask your club manager to correct it.',
    409,
  );
}

export function attendanceValidation(fieldErrors: FieldError[]): DomainError {
  return new DomainError('VALIDATION_ERROR', 'Please correct the highlighted fields.', 400, fieldErrors);
}

export const NOT_ON_LIST_MESSAGE = 'This booking is not on the attendance list for this class.';
