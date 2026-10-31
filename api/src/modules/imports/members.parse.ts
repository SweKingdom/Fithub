import { z } from 'zod';
import type { CsvRow } from './csv.js';
import type { MemberRejectReason } from './errors.js';
import type { MemberType } from './member-type-map.js';
import { normalizeEmail, normalizeLookupKey, normalizeName } from './normalize.js';

export interface ParseContext {
  typeMap: Map<string, MemberType>;
  /** `club.code` → `club.id` */
  clubsByCode: Map<string, string>;
}

export interface ParsedMember {
  line: number;
  email: string;
  /** Trimmed source values, for the reports. */
  rawEmail: string;
  fullName: string;
  memberType: MemberType;
  clubId: string | null;
  legacyNumber: string | null;
}

export interface Rejection {
  line: number;
  reason: MemberRejectReason;
  message: string;
  /** Trimmed source values (never normalised), for the rejection report. */
  email: string;
  legacyNumber: string;
}

export type ParseResult = { ok: true; member: ParsedMember } | { ok: false; rejection: Rejection };

const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 200;
const MAX_LEGACY_NUMBER_LENGTH = 64;
const emailSchema = z.string().email();

/** Checks one row in the documented order. The first failure is reported. */
export function parseMemberRow(row: CsvRow, ctx: ParseContext): ParseResult {
  const rawEmail = (row.values.email ?? '').trim();
  const legacyRaw = (row.values.legacy_member_number ?? '').trim();
  const reject = (reason: MemberRejectReason, message: string): ParseResult => ({
    ok: false,
    rejection: { line: row.line, reason, message, email: rawEmail, legacyNumber: legacyRaw },
  });

  const email = normalizeEmail(rawEmail);
  if (email === '' || email.length > MAX_EMAIL_LENGTH || !emailSchema.safeParse(email).success) {
    return reject('INVALID_EMAIL', 'Email is missing or invalid.');
  }

  const fullName = normalizeName(row.values.full_name ?? '');
  if (fullName === '' || fullName.length > MAX_NAME_LENGTH) {
    return reject('INVALID_NAME', 'Full name is missing or longer than 200 characters.');
  }

  const typeValue = (row.values.member_type ?? '').trim();
  const memberType = ctx.typeMap.get(normalizeLookupKey(typeValue));
  if (memberType === undefined) {
    return reject('UNMAPPED_MEMBER_TYPE', `Membership type "${typeValue}" is not in the member type map.`);
  }

  if (legacyRaw.length > MAX_LEGACY_NUMBER_LENGTH) {
    return reject('INVALID_LEGACY_NUMBER', 'Legacy member number is longer than 64 characters.');
  }

  const clubCode = (row.values.home_club_code ?? '').trim().toUpperCase();
  let clubId: string | null = null;
  if (clubCode !== '') {
    const found = ctx.clubsByCode.get(clubCode);
    if (found === undefined) {
      return reject('UNKNOWN_CLUB', `Home club code "${clubCode}" does not exist.`);
    }
    clubId = found;
  }

  return {
    ok: true,
    member: {
      line: row.line,
      email,
      rawEmail,
      fullName,
      memberType,
      clubId,
      legacyNumber: legacyRaw === '' ? null : legacyRaw,
    },
  };
}
