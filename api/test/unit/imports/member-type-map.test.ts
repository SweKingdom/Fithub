import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportFileError } from '../../../src/modules/imports/errors.js';
import { loadMemberTypeMap } from '../../../src/modules/imports/member-type-map.js';

describe('loadMemberTypeMap (US-135)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'map-test-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function mapFile(content: string): string {
    const path = join(dir, `${Math.random().toString(16).slice(2)}.json`);
    writeFileSync(path, content, 'utf8');
    return path;
  }

  it('loads a valid mapping with normalised keys', () => {
    const map = loadMemberTypeMap(mapFile('{" Regular ":"regular","Drop-In":"drop_in"}'));
    expect(map.get('regular')).toBe('regular');
    expect(map.get('drop-in')).toBe('drop_in');
    expect(map.size).toBe(2);
  });

  it('rejects a missing file with a hint to copy the example', () => {
    expect(() => loadMemberTypeMap(join(dir, 'missing.json'))).toThrow(/Member type map not found: .*member-type-map\.example\.json/);
  });

  it.each([
    ['invalid JSON', '{nope', 'is not valid JSON'],
    ['an array', '["regular"]', 'must be a non-empty JSON object'],
    ['null', 'null', 'must be a non-empty JSON object'],
    ['an empty object', '{}', 'must be a non-empty JSON object'],
    ['an unknown target value', '{"gold":"premium"}', 'must be "regular" or "drop_in"'],
    ['a non-string target value', '{"gold":1}', 'must be "regular" or "drop_in"'],
    ['two keys equal after normalising', '{"Regular":"regular","regular ":"regular"}', 'equal after trimming'],
    ['an empty key', '{" ":"regular"}', 'empty source value'],
  ])('rejects %s', (_label, content, message) => {
    const path = mapFile(content);
    expect(() => loadMemberTypeMap(path)).toThrow(ImportFileError);
    expect(() => loadMemberTypeMap(path)).toThrow(message);
  });
});
