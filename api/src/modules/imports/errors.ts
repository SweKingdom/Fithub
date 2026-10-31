/** A file-level problem (missing file, bad header, bad mapping, unbalanced plan). The CLI prints the message and exits 1. */
export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFileError';
  }
}

/** Row-level reason codes of the member import (US-135, ADR-022). */
export type MemberRejectReason =
  | 'INVALID_EMAIL'
  | 'INVALID_NAME'
  | 'UNMAPPED_MEMBER_TYPE'
  | 'INVALID_LEGACY_NUMBER'
  | 'UNKNOWN_CLUB'
  | 'LEGACY_NUMBER_REUSED'
  | 'CONFLICTING_DUPLICATE'
  | 'LEGACY_NUMBER_BELONGS_TO_OTHER_MEMBER'
  | 'EMAIL_USED_BY_STAFF';
