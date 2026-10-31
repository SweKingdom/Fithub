import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readCsvFile, writeCsvFile } from '../../../src/modules/imports/csv.js';
import { ImportFileError } from '../../../src/modules/imports/errors.js';

const OPTIONS = { delimiter: ',', required: ['email', 'full_name'], optional: ['legacy_member_number'] };

describe('readCsvFile / writeCsvFile (US-135)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'csv-test-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function file(name: string, content: string): string {
    const path = join(dir, name);
    writeFileSync(path, content, 'utf8');
    return path;
  }

  it('reads rows with 1-based line numbers, trimmed lower-cased headers and ignores unknown columns', () => {
    const path = file('a.csv', ' Email , FULL_NAME ,Other\nanna@x.se,Anna,zzz\n\nbo@x.se,Bo,yyy\n');
    const { columns, rows } = readCsvFile(path, OPTIONS);
    expect(columns).toEqual(['email', 'full_name']);
    expect(rows).toEqual([
      { line: 2, values: { email: 'anna@x.se', full_name: 'Anna' } },
      { line: 4, values: { email: 'bo@x.se', full_name: 'Bo' } },
    ]);
  });

  it('accepts a BOM, a quoted comma and a custom delimiter', () => {
    const bom = file('bom.csv', '﻿email,full_name\n"a@x.se","Lind, Anna"\n');
    expect(readCsvFile(bom, OPTIONS).rows[0].values).toEqual({ email: 'a@x.se', full_name: 'Lind, Anna' });
    const semi = file('semi.csv', 'email;full_name\na@x.se;Anna\n');
    expect(readCsvFile(semi, { ...OPTIONS, delimiter: ';' }).rows[0].values.full_name).toBe('Anna');
  });

  it('numbers the line of a row after a quoted multi-line field', () => {
    const path = file('multi.csv', 'email,full_name\na@x.se,"Anna\nLind"\nb@x.se,Bo\n');
    expect(readCsvFile(path, OPTIONS).rows.map((r) => r.line)).toEqual([2, 4]);
  });

  it('leaves an absent optional column out of the values', () => {
    const path = file('opt.csv', 'email,full_name\na@x.se,Anna\n');
    expect(readCsvFile(path, OPTIONS).rows[0].values).not.toHaveProperty('legacy_member_number');
  });

  it('rejects a missing file', () => {
    expect(() => readCsvFile(join(dir, 'nope.csv'), OPTIONS)).toThrow(
      new ImportFileError(`Import file not found: ${join(dir, 'nope.csv')}.`),
    );
  });

  it('rejects a missing required column and names it', () => {
    const path = file('miss.csv', 'full_name\nAnna\n');
    expect(() => readCsvFile(path, OPTIONS)).toThrow('Missing column(s): email. Required: email, full_name.');
  });

  it('rejects a duplicate column', () => {
    const path = file('dup.csv', 'email,Email,full_name\na,b,c\n');
    expect(() => readCsvFile(path, OPTIONS)).toThrow('Duplicate column(s): email.');
  });

  it('rejects a file with only a header, and an empty file', () => {
    expect(() => readCsvFile(file('h.csv', 'email,full_name\n'), OPTIONS)).toThrow(
      'The import file has no data rows.',
    );
    expect(() => readCsvFile(file('e.csv', ''), OPTIONS)).toThrow('The import file has no data rows.');
  });

  it('rejects a CSV syntax error and a row with the wrong number of fields', () => {
    expect(() => readCsvFile(file('q.csv', 'email,full_name\na@x.se,"Anna\n'), OPTIONS)).toThrow(ImportFileError);
    expect(() => readCsvFile(file('r.csv', 'email,full_name\na@x.se\n'), OPTIONS)).toThrow(ImportFileError);
  });

  it('writeCsvFile escapes formula prefixes and quotes commas', () => {
    const path = join(dir, 'out.csv');
    writeCsvFile(path, ['line', 'message'], [
      { line: 2, message: '=HYPERLINK("x")' },
      { line: 3, message: '+1' },
      { line: 4, message: '-1' },
      { line: 5, message: '@sum' },
      { line: 6, message: 'a, b' },
      { line: 7, message: null },
    ]);
    expect(readFileSync(path, 'utf8')).toBe(
      ['line,message', `2,"'=HYPERLINK(""x"")"`, "3,'+1", "4,'-1", "5,'@sum", '6,"a, b"', '7,', ''].join('\n'),
    );
  });
});
