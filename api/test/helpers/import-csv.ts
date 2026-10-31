import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Writes an import file into `dir` (a temp folder) and returns its path. Values are written as given. */
export function writeImportCsv(dir: string, header: string[], rows: string[][]): string {
  const path = join(dir, `${randomUUID()}.csv`);
  const lines = [header.join(','), ...rows.map((row) => row.join(','))];
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}
