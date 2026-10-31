/** Trim and lower-case: the dedup key of a member (US-135). */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Trim and collapse every run of whitespace to one space. */
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/** Trim and lower-case: used to compare mapping keys and source values. */
export function normalizeLookupKey(value: string): string {
  return value.trim().toLowerCase();
}
