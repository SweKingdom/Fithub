import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { ImportFileError } from './errors.js';

export const MAX_DATA_ROWS = 100_000;

export interface CsvRow {
  /** 1-based physical line of the row (the header is line 1). */
  line: number;
  values: Record<string, string>;
}

export interface ReadCsvOptions {
  delimiter: string;
  required: string[];
  optional: string[];
}

interface ParsedRecord {
  record: string[];
  info: { lines: number };
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ImportFileError(`Import file not found: ${path}.`);
    }
    throw new ImportFileError(`Import file cannot be read: ${path}.`);
  }
}

function duplicates(names: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) repeated.add(name);
    seen.add(name);
  }
  return [...repeated];
}

/**
 * Reads a UTF-8 CSV file (BOM allowed). Header names are trimmed and lower-cased, unknown columns are ignored.
 * Any file-level problem throws `ImportFileError`.
 */
export function readCsvFile(path: string, options: ReadCsvOptions): { columns: string[]; rows: CsvRow[] } {
  const content = readText(path);

  let records: ParsedRecord[];
  try {
    records = parse(content, {
      bom: true,
      delimiter: options.delimiter,
      skip_empty_lines: true,
      relax_quotes: false,
      info: true,
    }) as ParsedRecord[];
  } catch (error) {
    throw new ImportFileError(`The import file is not valid CSV: ${(error as Error).message}`);
  }

  if (records.length === 0) throw new ImportFileError('The import file has no data rows.');

  const columns = records[0].record.map((name) => name.trim().toLowerCase());
  const repeated = duplicates(columns.filter((name) => name !== ''));
  if (repeated.length > 0) {
    throw new ImportFileError(`Duplicate column(s): ${repeated.join(', ')}.`);
  }
  const missing = options.required.filter((name) => !columns.includes(name));
  if (missing.length > 0) {
    throw new ImportFileError(`Missing column(s): ${missing.join(', ')}. Required: ${options.required.join(', ')}.`);
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) throw new ImportFileError('The import file has no data rows.');
  if (dataRecords.length > MAX_DATA_ROWS) {
    throw new ImportFileError(`The import file has more than ${MAX_DATA_ROWS} rows; split it.`);
  }

  const wanted = [...options.required, ...options.optional].filter((name) => columns.includes(name));
  const rows = dataRecords.map(({ record, info }): CsvRow => {
    const values: Record<string, string> = {};
    for (const name of wanted) values[name] = record[columns.indexOf(name)] ?? '';
    // `info.lines` is the line where the record ends; quoted fields may span several lines.
    const embeddedNewlines = record.reduce((sum, field) => sum + (field.match(/\n/g)?.length ?? 0), 0);
    return { line: info.lines - embeddedNewlines, values };
  });

  return { columns: wanted, rows };
}

type CsvValue = string | number | null;

/** Prefixes values that a spreadsheet would run as a formula (CSV injection guard). */
function guardFormula(value: CsvValue): CsvValue {
  return typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function writeCsvFile(path: string, columns: string[], records: Array<Record<string, CsvValue>>): void {
  const guarded = records.map((record) => {
    const out: Record<string, CsvValue> = {};
    for (const column of columns) out[column] = guardFormula(record[column] ?? null);
    return out;
  });
  writeFileSync(path, stringify(guarded, { header: true, columns }), 'utf8');
}
