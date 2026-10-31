import type { CsvRow } from './csv.js';
import { CREDIT_REJECT_MESSAGES, isCreditRejection, parseCreditRow, rejectCreditRow } from './credits.parse.js';
import type {
  CreditImportPlan,
  CreditLoad,
  CreditMerge,
  CreditRejectReason,
  CreditRejection,
  CreditSnapshot,
  ParsedCreditRow,
} from './credits.types.js';

interface ResolvedRow {
  row: ParsedCreditRow;
  userId: string;
}

/**
 * Pure. Decides the outcome of every source row; nothing is written here.
 * Every row ends as exactly one of loaded, unchanged, merged, zero or rejected, and every valid
 * credit value ends in creditsLoaded, creditsUnchanged or creditsRejected.
 */
export function planCreditImport(rows: CsvRow[], snapshot: CreditSnapshot): CreditImportPlan {
  const rejections: CreditRejection[] = [];
  const merges: CreditMerge[] = [];
  const loads: CreditLoad[] = [];
  const groups = new Map<string, ResolvedRow[]>();

  let sourceCredits = 0;
  let creditsLoaded = 0;
  let creditsUnchanged = 0;
  let creditsRejected = 0;
  let loaded = 0;
  let unchanged = 0;
  let zero = 0;

  const reject = (row: ParsedCreditRow, reason: CreditRejectReason, message: string): void => {
    rejections.push(
      rejectCreditRow(row, reason, message, { legacyNumber: row.legacyNumber ?? '', email: row.email ?? '' }),
    );
    creditsRejected += row.credits;
  };

  // Steps 1 and 2: parse, then resolve the member.
  for (const csvRow of rows) {
    const parsed = parseCreditRow(csvRow);
    if (isCreditRejection(parsed)) {
      rejections.push(parsed);
      if (parsed.credits !== null) {
        sourceCredits += parsed.credits;
        creditsRejected += parsed.credits;
      }
      continue;
    }
    sourceCredits += parsed.credits;

    const byNumber = parsed.legacyNumber === null ? undefined : snapshot.aliases.get(parsed.legacyNumber);
    const byEmail = parsed.email === null ? undefined : snapshot.usersByEmail.get(parsed.email);
    if (byNumber !== undefined && byEmail !== undefined && byNumber !== byEmail) {
      reject(parsed, 'AMBIGUOUS_MEMBER', CREDIT_REJECT_MESSAGES.AMBIGUOUS_MEMBER);
      continue;
    }
    const userId = byNumber ?? byEmail;
    if (userId === undefined) {
      reject(parsed, 'MEMBER_NOT_FOUND', CREDIT_REJECT_MESSAGES.MEMBER_NOT_FOUND);
      continue;
    }
    const user = snapshot.usersById.get(userId);
    if (user === undefined) {
      reject(parsed, 'MEMBER_NOT_FOUND', CREDIT_REJECT_MESSAGES.MEMBER_NOT_FOUND);
      continue;
    }
    if (user.role !== 'member' || user.memberType !== 'regular') {
      reject(parsed, 'MEMBER_NOT_CREDIT_USER', CREDIT_REJECT_MESSAGES.MEMBER_NOT_CREDIT_USER);
      continue;
    }

    const group = groups.get(userId);
    if (group === undefined) groups.set(userId, [{ row: parsed, userId }]);
    else group.push({ row: parsed, userId });
  }

  // Steps 3 and 4: one outcome per member group, rows in file order.
  let merged = 0;
  for (const [userId, group] of groups) {
    const total = group.reduce((sum, item) => sum + item.row.credits, 0);
    const canonical = group[0].row;
    const existing = snapshot.migrated.get(userId);

    if (existing !== undefined && existing !== total && total > 0) {
      const message = `Member already has migrated credits (${existing}) that differ from this file (${total}). Correct manually.`;
      for (const item of group) reject(item.row, 'ALREADY_MIGRATED_DIFFERENT_TOTAL', message);
      continue;
    }

    for (const item of group.slice(1)) {
      merged += 1;
      merges.push({
        line: item.row.line,
        mergedIntoLine: canonical.line,
        legacyNumber: item.row.legacyNumber ?? '',
        email: item.row.email ?? '',
        credits: item.row.credits,
      });
    }

    if (total === 0) {
      zero += 1;
    } else if (existing === total) {
      unchanged += 1;
      creditsUnchanged += total;
    } else {
      loaded += 1;
      creditsLoaded += total;
      loads.push({ userId, line: canonical.line, total });
    }
  }

  rejections.sort((a, b) => a.line - b.line);
  merges.sort((a, b) => a.line - b.line);

  const rejectedByReason: Partial<Record<CreditRejectReason, number>> = {};
  for (const rejection of rejections) {
    rejectedByReason[rejection.reason] = (rejectedByReason[rejection.reason] ?? 0) + 1;
  }

  const rejected = rejections.length;
  const balanced =
    loaded + unchanged + merged + zero + rejected === rows.length &&
    sourceCredits === creditsLoaded + creditsUnchanged + creditsRejected;

  return {
    sourceRows: rows.length,
    sourceCredits,
    loaded,
    unchanged,
    merged,
    zero,
    rejected,
    rejectedByReason,
    creditsLoaded,
    creditsUnchanged,
    creditsRejected,
    balanced,
    loads,
    rejections,
    merges,
  };
}
