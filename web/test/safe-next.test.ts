import { describe, expect, it } from 'vitest';
import { safeNext } from '../src/lib/safe-next';

describe('safeNext (US-118 AC 11)', () => {
  it.each(['/', '/schedule', '/schedule?clubId=1', '/a/b#c'])('keeps the same-site path %s', (path) => {
    expect(safeNext(path)).toBe(path);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['absolute URL', 'https://evil.example/'],
    ['protocol-relative URL', '//evil.example'],
    ['backslash host', '/\\evil.example'],
    ['relative path', 'schedule'],
    ['javascript URL', 'javascript:alert(1)'],
    ['tab inside the path', '/\t/evil.example'],
    ['line break inside the path', '/\n/evil.example'],
  ])('falls back to / for %s', (_name, value) => {
    expect(safeNext(value)).toBe('/');
  });
});
