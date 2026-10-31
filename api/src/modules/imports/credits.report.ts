import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCsvFile } from './csv.js';
import type { CreditImportPlan } from './credits.types.js';

export interface CreditImportResult extends CreditImportPlan {
  file: string;
  fileSha256: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
}

/** The counts in `import-summary.json`; no personal data. */
export function creditSummary(result: CreditImportResult) {
  return {
    kind: 'credits' as const,
    file: result.file,
    fileSha256: result.fileSha256,
    dryRun: result.dryRun,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    sourceRows: result.sourceRows,
    loaded: result.loaded,
    unchanged: result.unchanged,
    merged: result.merged,
    zero: result.zero,
    rejected: result.rejected,
    rejectedByReason: result.rejectedByReason,
    sourceCredits: result.sourceCredits,
    creditsLoaded: result.creditsLoaded,
    creditsUnchanged: result.creditsUnchanged,
    creditsRejected: result.creditsRejected,
    balanced: result.balanced,
  };
}

/** Writes `import-summary.json`, `import-rejections.csv` and `import-merges.csv` into `outDir`. */
export function writeCreditReport(outDir: string, result: CreditImportResult): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'import-summary.json'), `${JSON.stringify(creditSummary(result), null, 2)}\n`);
  writeCsvFile(
    join(outDir, 'import-rejections.csv'),
    ['line', 'reason', 'message', 'legacy_member_number', 'email', 'credits'],
    result.rejections.map((r) => ({
      line: r.line,
      reason: r.reason,
      message: r.message,
      legacy_member_number: r.legacyNumber,
      email: r.email,
      credits: r.creditsRaw,
    })),
  );
  writeCsvFile(
    join(outDir, 'import-merges.csv'),
    ['line', 'merged_into_line', 'legacy_member_number', 'email', 'credits'],
    result.merges.map((m) => ({
      line: m.line,
      merged_into_line: m.mergedIntoLine,
      legacy_member_number: m.legacyNumber,
      email: m.email,
      credits: m.credits,
    })),
  );
}

/** Console line: counts only, no personal data. */
export function formatCreditSummaryLine(result: CreditImportResult, outDir: string): string {
  return (
    `Credits import${result.dryRun ? ' (dry run)' : ''}: ${result.sourceRows} rows → ` +
    `${result.loaded} loaded (${result.creditsLoaded} credits), ${result.unchanged} unchanged, ` +
    `${result.merged} merged, ${result.zero} zero, ${result.rejected} rejected ` +
    `(${result.creditsRejected} credits). Reports: ${outDir}`
  );
}
