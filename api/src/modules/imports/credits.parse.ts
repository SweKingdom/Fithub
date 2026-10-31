import type { CsvRow } from './csv.js';
import { normalizeEmail } from './normalize.js';
import type { CreditRejectReason, CreditRejection, ParsedCreditRow } from './credits.types.js';

const CREDITS_PATTERN = /^[0-9]{1,6}$/;

export const CREDIT_REJECT_MESSAGES: Record<Exclude<CreditRejectReason, 'ALREADY_MIGRATED_DIFFERENT_TOTAL'>, string> = {
  INVALID_CREDITS: 'Credits must be a whole number of 0 or more.',
  MISSING_MEMBER_REFERENCE: 'Row has neither legacy member number nor email.',
  MEMBER_NOT_FOUND: 'No imported member matches this row.',
  AMBIGUOUS_MEMBER: 'Legacy number and email belong to different members.',
  MEMBER_NOT_CREDIT_USER: 'Only regular members can hold credits.',
};

export function isCreditRejection(result: ParsedCreditRow | CreditRejection): result is CreditRejection {
  return 'reason' in result;
}

/** Builds a rejection for a parsed row (used by the plan for the reasons that need the database). */
export function rejectCreditRow(
  row: ParsedCreditRow,
  reason: CreditRejectReason,
  message: string,
  raw: { legacyNumber: string; email: string },
): CreditRejection {
  return {
    line: row.line,
    reason,
    message,
    legacyNumber: raw.legacyNumber,
    email: raw.email,
    creditsRaw: String(row.credits),
    credits: row.credits,
  };
}

/**
 * Pure. Checks one CSV row in the contract order: credits value, then member reference.
 * The first failure wins. Reasons that need the database are decided by the plan.
 */
export function parseCreditRow(row: CsvRow): ParsedCreditRow | CreditRejection {
  const creditsRaw = (row.values.credits ?? '').trim();
  const legacyNumber = (row.values.legacy_member_number ?? '').trim();
  const email = normalizeEmail(row.values.email ?? '');

  if (!CREDITS_PATTERN.test(creditsRaw)) {
    return {
      line: row.line,
      reason: 'INVALID_CREDITS',
      message: CREDIT_REJECT_MESSAGES.INVALID_CREDITS,
      legacyNumber,
      email,
      creditsRaw,
      credits: null,
    };
  }
  const credits = Number(creditsRaw);

  if (legacyNumber === '' && email === '') {
    return {
      line: row.line,
      reason: 'MISSING_MEMBER_REFERENCE',
      message: CREDIT_REJECT_MESSAGES.MISSING_MEMBER_REFERENCE,
      legacyNumber,
      email,
      creditsRaw,
      credits,
    };
  }

  return {
    line: row.line,
    legacyNumber: legacyNumber === '' ? null : legacyNumber,
    email: email === '' ? null : email,
    credits,
  };
}
