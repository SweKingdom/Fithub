import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCsvFile } from './csv.js';
import type { MemberImportResult } from './members.js';

/** Writes `import-summary.json`, `import-rejections.csv` and `import-merges.csv` into `outDir`. */
export function writeImportReport(outDir: string, result: MemberImportResult): void {
  mkdirSync(outDir, { recursive: true });
  const { plan } = result;

  const summary = {
    kind: 'members',
    file: result.file,
    fileSha256: result.fileSha256,
    dryRun: result.dryRun,
    startedAt: result.startedAt.toISOString(),
    finishedAt: result.finishedAt.toISOString(),
    sourceRows: plan.sourceRows,
    inserted: plan.inserted,
    updated: plan.updated,
    unchanged: plan.unchanged,
    merged: plan.merged,
    rejected: plan.rejected,
    rejectedByReason: plan.rejectedByReason,
    balanced: plan.balanced,
  };
  writeFileSync(join(outDir, 'import-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  writeCsvFile(
    join(outDir, 'import-rejections.csv'),
    ['line', 'reason', 'message', 'email', 'legacy_member_number'],
    plan.rejections.map((r) => ({
      line: r.line,
      reason: r.reason,
      message: r.message,
      email: r.email,
      legacy_member_number: r.legacyNumber,
    })),
  );
  writeCsvFile(
    join(outDir, 'import-merges.csv'),
    ['line', 'merged_into_line', 'email', 'legacy_member_number'],
    plan.merges.map((m) => ({
      line: m.line,
      merged_into_line: m.mergedIntoLine,
      email: m.email,
      legacy_member_number: m.legacyNumber,
    })),
  );
}

/** One console line with counts only (no personal data). */
export function formatSummaryLine(result: MemberImportResult, outDir: string): string {
  const { plan } = result;
  return (
    `Members import${result.dryRun ? ' (dry run)' : ''}: ${plan.sourceRows} rows → ${plan.inserted} inserted, ` +
    `${plan.updated} updated, ${plan.unchanged} unchanged, ${plan.merged} merged, ${plan.rejected} rejected. ` +
    `Reports: ${outDir}`
  );
}
