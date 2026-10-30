/** Client-side checks of the "New class" form. They mirror the server messages; the server stays authoritative. */

export const CLASS_FORM_MESSAGES = {
  nameRequired: 'A class must have a name.',
  nameTooLong: 'The class name can be at most 100 characters.',
  startInvalid: 'Enter a valid start date and time.',
  startInPast: 'The start time must be in the future.',
  durationInvalid: 'The duration must be a whole number of minutes greater than 0.',
  capacityNotInteger: 'Max places must be a whole number.',
  capacityTooLow: 'A class must have at least one place.',
} as const;

/** Form fields in page order. `startAt` is shown under the time input. */
export const CLASS_FORM_FIELDS = ['name', 'startAt', 'durationMinutes', 'capacity', 'instructorId'] as const;
export type ClassFormField = (typeof CLASS_FORM_FIELDS)[number];

export interface ClassFormValues {
  name: string;
  date: string;
  time: string;
  duration: string;
  capacity: string;
}

export type ClassFormErrors = Partial<Record<ClassFormField, string>>;

const WHOLE_NUMBER = /^-?\d+$/;

/**
 * `startAtUtc` is the converted start time (ISO UTC) or `null` when date/time are missing or invalid.
 * Returns one message per field (first failing rule wins).
 */
export function validateClassForm(
  values: ClassFormValues,
  startAtUtc: string | null,
  now: Date,
): ClassFormErrors {
  const errors: ClassFormErrors = {};
  const name = values.name.trim();
  if (name.length === 0) errors.name = CLASS_FORM_MESSAGES.nameRequired;
  else if (name.length > 100) errors.name = CLASS_FORM_MESSAGES.nameTooLong;

  if (startAtUtc === null) errors.startAt = CLASS_FORM_MESSAGES.startInvalid;
  else if (new Date(startAtUtc) <= now) errors.startAt = CLASS_FORM_MESSAGES.startInPast;

  const duration = values.duration.trim();
  if (!WHOLE_NUMBER.test(duration) || Number(duration) < 1) {
    errors.durationMinutes = CLASS_FORM_MESSAGES.durationInvalid;
  }

  const capacity = values.capacity.trim();
  if (!WHOLE_NUMBER.test(capacity)) errors.capacity = CLASS_FORM_MESSAGES.capacityNotInteger;
  else if (Number(capacity) < 1) errors.capacity = CLASS_FORM_MESSAGES.capacityTooLow;

  return errors;
}
