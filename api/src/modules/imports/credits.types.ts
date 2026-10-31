/** Row-level reasons a credit row is not loaded (US-136). */
export type CreditRejectReason =
  | 'INVALID_CREDITS'
  | 'MISSING_MEMBER_REFERENCE'
  | 'MEMBER_NOT_FOUND'
  | 'AMBIGUOUS_MEMBER'
  | 'MEMBER_NOT_CREDIT_USER'
  | 'ALREADY_MIGRATED_DIFFERENT_TOTAL';

/** A credit row that passed parsing. `credits` is an integer 0–999,999. */
export interface ParsedCreditRow {
  line: number;
  legacyNumber: string | null;
  /** Normalised (trim + lower-case); null when empty. */
  email: string | null;
  credits: number;
}

export interface CreditRejection {
  line: number;
  reason: CreditRejectReason;
  message: string;
  legacyNumber: string;
  email: string;
  /** Raw trimmed value from the file, for the report. */
  creditsRaw: string;
  /** The credit value when it was valid (counted in `creditsRejected`); null for `INVALID_CREDITS`. */
  credits: number | null;
}

export interface CreditMerge {
  line: number;
  mergedIntoLine: number;
  legacyNumber: string;
  email: string;
  credits: number;
}

export interface CreditSnapshotUser {
  id: string;
  role: string;
  memberType: string | null;
}

/** What the plan needs to know about the database. */
export interface CreditSnapshot {
  /** `import_member_alias`: legacy number → user id. */
  aliases: Map<string, string>;
  usersById: Map<string, CreditSnapshotUser>;
  /** lower(email) → user id. */
  usersByEmail: Map<string, string>;
  /** user id → sum of `credit_transaction.delta` where `reason = 'migration'`. */
  migrated: Map<string, number>;
}

/** One member to load: the sum of all that member's resolved rows. */
export interface CreditLoad {
  userId: string;
  /** Canonical (first) line of the member's group. */
  line: number;
  total: number;
}

export interface CreditImportPlan {
  sourceRows: number;
  sourceCredits: number;
  loaded: number;
  unchanged: number;
  merged: number;
  zero: number;
  rejected: number;
  rejectedByReason: Partial<Record<CreditRejectReason, number>>;
  creditsLoaded: number;
  creditsUnchanged: number;
  creditsRejected: number;
  balanced: boolean;
  loads: CreditLoad[];
  rejections: CreditRejection[];
  merges: CreditMerge[];
}
