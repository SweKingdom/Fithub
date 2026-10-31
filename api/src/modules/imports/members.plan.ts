import type { CsvRow } from './csv.js';
import type { MemberRejectReason } from './errors.js';
import type { MemberType } from './member-type-map.js';
import { parseMemberRow, type ParseContext, type ParsedMember, type Rejection } from './members.parse.js';

export interface SnapshotUser {
  id: string;
  /** Lower-cased. */
  email: string;
  fullName: string;
  role: string;
  memberType: MemberType | null;
  clubId: string | null;
  legacyMemberId: string | null;
}

export interface MemberSnapshot {
  usersByEmail: Map<string, SnapshotUser>;
  usersById: Map<string, SnapshotUser>;
  /** `import_member_alias.legacy_member_id` → `user_id` */
  aliases: Map<string, string>;
}

export interface NewMemberRow {
  email: string;
  full_name: string;
  role: 'member';
  member_type: MemberType;
  club_id: string | null;
  legacy_member_id: string | null;
  password_hash: null;
}

export interface MemberPatch {
  email?: string;
  full_name?: string;
  member_type?: MemberType;
  club_id?: string | null;
  legacy_member_id?: string;
}

export interface PlannedInsert {
  line: number;
  row: NewMemberRow;
  aliases: string[];
}

export interface PlannedUpdate {
  line: number;
  userId: string;
  patch: MemberPatch;
  newAliases: string[];
}

export interface PlannedMerge {
  line: number;
  mergedIntoLine: number;
  email: string;
  legacyNumber: string;
}

export interface MemberImportPlan {
  sourceRows: number;
  inserts: PlannedInsert[];
  updates: PlannedUpdate[];
  unchangedLines: number[];
  merges: PlannedMerge[];
  rejections: Rejection[];
  inserted: number;
  updated: number;
  unchanged: number;
  merged: number;
  rejected: number;
  rejectedByReason: Record<string, number>;
  /** True when every source row has exactly one outcome. */
  balanced: boolean;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

/**
 * Plans the member import without touching the database (US-135, ADR-022).
 * The dedup key (normalised email) lives only here.
 */
export function planMemberImport(rows: CsvRow[], ctx: ParseContext, snapshot: MemberSnapshot): MemberImportPlan {
  const rejections: Rejection[] = [];
  const inserts: PlannedInsert[] = [];
  const updates: PlannedUpdate[] = [];
  const unchangedLines: number[] = [];
  const merges: PlannedMerge[] = [];

  const rejectMember = (member: ParsedMember, reason: MemberRejectReason, message: string): void => {
    rejections.push({
      line: member.line,
      reason,
      message,
      email: member.rawEmail,
      legacyNumber: member.legacyNumber ?? '',
    });
  };

  // 1. Parse every row.
  const valid: ParsedMember[] = [];
  for (const row of rows) {
    const result = parseMemberRow(row, ctx);
    if (result.ok) valid.push(result.member);
    else rejections.push(result.rejection);
  }

  // 2. A legacy number used with more than one email rejects all rows that carry it.
  const withNumber = valid.filter((member) => member.legacyNumber !== null);
  const rowsByNumber = groupBy(withNumber, (member) => member.legacyNumber as string);
  const remaining: ParsedMember[] = [];
  for (const member of valid) {
    const sameNumber = member.legacyNumber === null ? undefined : rowsByNumber.get(member.legacyNumber);
    if (sameNumber && new Set(sameNumber.map((m) => m.email)).size > 1) {
      rejectMember(
        member,
        'LEGACY_NUMBER_REUSED',
        `Legacy member number ${member.legacyNumber} is used with different emails on lines ${sameNumber
          .map((m) => m.line)
          .join(', ')}.`,
      );
    } else {
      remaining.push(member);
    }
  }

  // 3. Group by normalised email in file order. Rows of one group must agree.
  for (const group of groupBy(remaining, (member) => member.email).values()) {
    const canonical = group[0];
    const differing: string[] = [];
    if (group.some((m) => m.fullName.toLowerCase() !== canonical.fullName.toLowerCase())) differing.push('full name');
    if (group.some((m) => m.memberType !== canonical.memberType)) differing.push('membership type');
    if (group.some((m) => m.clubId !== canonical.clubId)) differing.push('home club');
    if (differing.length > 0) {
      for (const member of group) {
        const others = group.filter((m) => m !== member).map((m) => m.line);
        rejectMember(
          member,
          'CONFLICTING_DUPLICATE',
          `Same email as line(s) ${others.join(', ')} but different ${differing.join(', ')}.`,
        );
      }
      continue;
    }

    // 4. Match the group against the database.
    const numbers = [...new Set(group.flatMap((m) => (m.legacyNumber === null ? [] : [m.legacyNumber])))];
    const byEmail = snapshot.usersByEmail.get(canonical.email);
    const aliasOwners = new Map<string, string>();
    for (const number of numbers) {
      const userId = snapshot.aliases.get(number);
      if (userId !== undefined) aliasOwners.set(number, userId);
    }
    const ownerIds = new Set(aliasOwners.values());
    const byAliasId = ownerIds.size > 0 ? [...ownerIds][0] : undefined;
    const expectedId = byEmail?.id ?? byAliasId;

    if (ownerIds.size > 1 || (byEmail && byAliasId !== undefined && byAliasId !== byEmail.id)) {
      const offending = [...aliasOwners].find(([, userId]) => userId !== expectedId)?.[0] ?? numbers[0];
      for (const member of group) {
        rejectMember(
          member,
          'LEGACY_NUMBER_BELONGS_TO_OTHER_MEMBER',
          `Legacy member number ${offending} is already linked to a different member.`,
        );
      }
      continue;
    }

    const target = byEmail ?? (byAliasId === undefined ? undefined : snapshot.usersById.get(byAliasId));
    if (target && target.role !== 'member') {
      for (const member of group) {
        rejectMember(member, 'EMAIL_USED_BY_STAFF', 'This email belongs to a staff account.');
      }
      continue;
    }

    if (!target) {
      inserts.push({
        line: canonical.line,
        row: {
          email: canonical.email,
          full_name: canonical.fullName,
          role: 'member',
          member_type: canonical.memberType,
          club_id: canonical.clubId,
          legacy_member_id: numbers[0] ?? null,
          password_hash: null,
        },
        aliases: numbers,
      });
    } else {
      const patch: MemberPatch = {};
      if (!byEmail) patch.email = canonical.email;
      if (target.fullName !== canonical.fullName) patch.full_name = canonical.fullName;
      if (target.memberType !== canonical.memberType) patch.member_type = canonical.memberType;
      if (target.clubId !== canonical.clubId) patch.club_id = canonical.clubId;
      if (target.legacyMemberId === null && numbers.length > 0) patch.legacy_member_id = numbers[0];
      const newAliases = numbers.filter((number) => !snapshot.aliases.has(number));
      if (Object.keys(patch).length > 0 || newAliases.length > 0) {
        updates.push({ line: canonical.line, userId: target.id, patch, newAliases });
      } else {
        unchangedLines.push(canonical.line);
      }
    }

    for (const member of group.slice(1)) {
      merges.push({
        line: member.line,
        mergedIntoLine: canonical.line,
        email: member.rawEmail,
        legacyNumber: member.legacyNumber ?? '',
      });
    }
  }

  // 5. Every source row has exactly one outcome.
  rejections.sort((a, b) => a.line - b.line);
  merges.sort((a, b) => a.line - b.line);
  const rejectedByReason: Record<string, number> = {};
  for (const rejection of rejections) {
    rejectedByReason[rejection.reason] = (rejectedByReason[rejection.reason] ?? 0) + 1;
  }
  const outcomes = inserts.length + updates.length + unchangedLines.length + merges.length + rejections.length;

  return {
    sourceRows: rows.length,
    inserts,
    updates,
    unchangedLines,
    merges,
    rejections,
    inserted: inserts.length,
    updated: updates.length,
    unchanged: unchangedLines.length,
    merged: merges.length,
    rejected: rejections.length,
    rejectedByReason,
    balanced: outcomes === rows.length,
  };
}
